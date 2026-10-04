import { randomUUID, createHash } from "node:crypto";
import { RemoteError } from "./cloudflare.mjs";
import {PublicationAccess,accessConfig,accessHash} from "./access.mjs";
import {PublicationAnalytics,analyticsURL} from "./analytics.mjs";

const active=["prepared","queued","creating","protecting","analytics","uploading","deploying","verifying","removing","rolling-back","unknown"];
const now=()=>new Date().toISOString();
const digest=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const slug=s=>s.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,30)||"artifact";
function identity(p) {return JSON.stringify({id:p.id,created:p.created_on,name:p.name,branch:p.production_branch,source:p.source||null});}
function publicURL(raw) {
 try{const u=new URL(raw);if(u.protocol==="https:" && u.hostname.endsWith(".pages.dev") && !u.username && !u.password)return u.href;}catch{}
 throw new RemoteError("Cloudflare did not return a Pages URL.");
}

export class PagesService {
 constructor({db,host,remote,emit=async()=>{}}) {
  this.db=db;this.host=host;this.remote=remote;this.emit=emit;this.running=new Set();this.closing=false;this.connectionCheck=null;this.checkGeneration=0;this.accessSetupCheck=null;this.accessCheckGeneration=0;
  this.access=new PublicationAccess({db,remote,configuration:()=>this.configuration()});
  this.analytics=new PublicationAnalytics({db});
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
 }
 pub(id) {return this.db.prepare("SELECT * FROM publications WHERE id=?").get(id);}
 op(id) {return this.db.prepare("SELECT * FROM operations WHERE id=?").get(id);}
 event() {return this.emit("changed",{}).catch(()=>{});}
 set(id,status,extra={}) {
  if(!["unknown","failed"].includes(status))extra={...extra,remote_phase:status};
  const entries=Object.entries(extra);this.db.prepare(`UPDATE operations SET status=?,updated_at=?${entries.map(([k])=>", "+k+"=?").join("")} WHERE id=?`).run(status,now(),...entries.map(([,v])=>v),id);void this.event();
 }
 async state() {
  let artifacts=[],error="";try{artifacts=(await this.host("/artifacts")).artifacts||[];}catch{error="Artifacts could not be loaded. Retry.";}
  const pubs=this.db.prepare("SELECT * FROM publications ORDER BY created_at DESC").all();
  return {artifacts,error,connection:await this.connectionState(),accessSetup:await this.accessSetupState(),publications:pubs.map(p=>({...p,identity:undefined,access_fingerprint:undefined,access_attempt:undefined,access_app:undefined,access_delete_attempt:undefined,access_emails:JSON.parse(p.access_emails),accessPending:!!p.access_attempt,analytics:p.analytics_tag?{url:analyticsURL(p.account_id,p.analytics_tag)}:null,hasProject:!!p.identity,latestVersion:artifacts.find(a=>a.id===p.artifact_id)?.liveVersion||null,history:this.db.prepare("SELECT * FROM deployments WHERE publication_id=? ORDER BY created_at DESC").all(p.id),operations:this.db.prepare("SELECT id,action,version,status,error,updated_at,progress FROM operations WHERE publication_id=? ORDER BY created_at DESC LIMIT 20").all(p.id).map(o=>({...o,progress:o.progress?JSON.parse(o.progress):null}))}))};
 }
 async configuration() {const r=await this.host("/settings");return {account:r.values?.account_id,token:r.secrets?.api_token,accessToken:r.secrets?.access_api_token};}
 // A read-only account check never proves write permission or publishes a site.
 async connectionState() {
  const c=await this.configuration();
  if(!c.account||!c.token)return {status:"not-configured"};
  if(this.connectionCheck?.fingerprint===digest(c))return {...this.connectionCheck,fingerprint:undefined};
  return {status:"unchecked"};
 }
 async checkConnection() {
  const c=await this.configuration(),generation=++this.checkGeneration;
  if(!c.account||!c.token)throw new RemoteError("Configure the Cloudflare account and API token.",409);
  const cf=this.remote(c.account,c.token);
  let result={status:"ready",checkedAt:now(),analytics:"ready",message:"Account access verified. Publishing requires Pages Edit permission."};
  try {
   await cf.checkConnection();
   try {await cf.rumSites();}
   catch(e) {
    if(!(e instanceof RemoteError && [401,403].includes(e.status)))throw e;
    result.analytics="unavailable";result.message+=" Web Analytics needs Account Settings Read and Write on the token.";
   }
  }
  catch(e) {result={status:"error",checkedAt:now(),retryable:![400,401,403,409].includes(e.status),message:e instanceof RemoteError?e.message:"Cloudflare could not be reached. Check the connection again."};}
  if(generation===this.checkGeneration)this.connectionCheck={...result,fingerprint:digest(c)};
  await this.event();return this.connectionState();
 }
 async accessSetupState() {
  const c=await this.configuration();if(!c.accessToken)return {status:'not-configured'};
  if(this.accessSetupCheck?.fingerprint===digest(c))return {...this.accessSetupCheck,fingerprint:undefined};return {status:'unchecked'};
 }
 async checkAccessSetup(){const c=await this.configuration(),generation=++this.accessCheckGeneration;let result;
  try{const {cf}=await this.access.setup({account_id:c.account});await this.access.list(cf,{account_id:c.account});result={status:'ready',message:'Email-code login configured. Access write permission is required.'};}
  catch(e){result={status:'error',settingsRequired:[401,403].includes(e.status),message:e instanceof RemoteError?e.message:'Restricted access could not be checked.'};}
  if(generation===this.accessCheckGeneration)this.accessSetupCheck={...result,fingerprint:digest(c)};await this.event();return this.accessSetupState();
 }
 async checkAccess(id){const p=this.pub(id);if(!p||p.access_mode!=='restricted')throw new RemoteError('Choose a restricted site.',400);const cf=await this.cloud(p),project=await this.checkProject(cf,p);if(!project)throw new RemoteError('The project is missing.',409);
  await this.access.verify(p,accessConfig({mode:p.access_mode,emails:JSON.parse(p.access_emails)}),project,(await cf.deployments(p.project)).map(d=>d.url));
  this.db.prepare('UPDATE publications SET access_verified_at=? WHERE id=?').run(now(),p.id);await this.event();return {verified:true};
 }
 async finishAccess(p,op,project,recovery){const config=op.access_config?JSON.parse(op.access_config):accessConfig();
  if(config.mode==='restricted')await this.access.ensure(p,config,project,op.access_snapshot?JSON.parse(op.access_snapshot):null,recovery);
  else if(p.access_app||p.access_attempt)await this.access.remove(p,op.access_snapshot?JSON.parse(op.access_snapshot):null,recovery);
  if(config.mode==='public'&&JSON.parse(op.access_snapshot||'null'))await this.access.verifyPublic(await this.cloud(p),p,project);
  this.db.prepare('UPDATE publications SET access_mode=?,access_emails=?,access_verified_at=? WHERE id=?').run(config.mode,JSON.stringify(config.emails),config.mode==='restricted'?now():null,p.id);
 }
 async cloud(p) {
  const c=await this.configuration();if(c.account!==p.account_id)throw new RemoteError("This publication belongs to another Cloudflare account. Restore its account in settings.",409);
  return this.remote(c.account,c.token);
 }
 async source(id) {return this.host("/artifacts/"+encodeURIComponent(id));}
 // JSON base64 expands the core's 128 MiB raw package; leave metadata headroom.
 async bundle(id,version) {return this.host("/artifacts/"+encodeURIComponent(id)+"/versions/"+version+"/site",192<<20);}
 async prepare({artifactId,version,action="publish",publicationId,deployment,projectName,access,analytics}) {
  if(!["publish","remove","rollback","access","analytics","rename"].includes(action))throw new RemoteError("Choose publish, remove, rollback, access, analytics or rename.",400);
  if(analytics!==undefined&&typeof analytics!=="boolean")throw new RemoteError("Choose whether Web Analytics is on or off.",400);
  let p=publicationId?this.pub(publicationId):null,bundle;
  if(action==="publish") {
   if(projectName!==undefined && (typeof projectName!=="string" || !/^[a-z0-9][a-z0-9-]{0,57}$/.test(projectName)))throw new RemoteError("Use a project name with lowercase letters, numbers and dashes (up to 58 characters).",400);
   if(typeof artifactId!=="string" || !Number.isSafeInteger(version)||version<1)throw new RemoteError("Choose an artifact version.",400);
   const src=await this.source(artifactId);bundle=await this.bundle(artifactId,version);
   if(!p)p=this.db.prepare("SELECT * FROM publications WHERE artifact_id=?").get(artifactId);
   if(!p) {
    const c=await this.configuration();this.remote(c.account,c.token);const id=randomUUID();
    p={id,artifact_id:artifactId,title:src.artifact.title,account_id:c.account,project:projectName||"picode-"+slug(src.artifact.title)+"-"+id.replaceAll("-", "").slice(0,16),created_at:now()};
    this.db.prepare("INSERT INTO publications(id,artifact_id,title,account_id,project,created_at,generated_name) VALUES(?,?,?,?,?,?,?)").run(p.id,p.artifact_id,p.title,p.account_id,p.project,p.created_at,projectName?0:1);
    p=this.pub(p.id);
   }
   if(p.status==="removed") { const project=projectName||"picode-"+slug(p.title)+"-"+randomUUID().replaceAll("-", "").slice(0,16);this.db.prepare("UPDATE publications SET identity=NULL,project=?,generated_name=?,status='draft',version=NULL,digest=NULL,deployment=NULL,url=NULL WHERE id=?").run(project,projectName?0:1,p.id);p=this.pub(p.id); }
   if(projectName && projectName!==p.project){
    if(p.identity || this.db.prepare(`SELECT id FROM operations WHERE publication_id=? AND status IN (${active.map(()=>"?").join(",")})`).get(p.id,...active))throw new RemoteError("Keep the existing site's project name when updating it.",409);
    this.db.prepare("UPDATE publications SET project=?,generated_name=0 WHERE id=?").run(projectName,p.id);p=this.pub(p.id);
   }
   if(p.artifact_id!==artifactId)throw new RemoteError("This publication belongs to another artifact.",409);

  }
  if(action==="rename") {
   if(typeof projectName!=="string"||!/^[a-z0-9][a-z0-9-]{0,57}$/.test(projectName))throw new RemoteError("Use a project name with lowercase letters, numbers and dashes (up to 58 characters).",400);
   if(!p)throw new RemoteError("The publication was not found.",404);
   if(p.status!=="published"||!p.identity||!p.version||!p.digest)throw new RemoteError("Only a published site can change its address.",409);
   if(p.access_mode==='restricted'||p.access_app||p.access_attempt)throw new RemoteError('A restricted site cannot change address. Remove it and publish again under the new name.',409);
   if(projectName===p.project)throw new RemoteError("Choose a different project name.",400);
   bundle={digest:p.digest};version=p.version;
  }
  if(action==="analytics") {
   if(!p)throw new RemoteError("The publication was not found.",404);
   if(p.status!=="published"||!p.identity)throw new RemoteError("Only a published site can change Web Analytics.",409);
   if(analytics===undefined)throw new RemoteError("Choose whether Web Analytics is on or off.",400);
   if(!!p.analytics_tag===analytics)return {unchanged:true,action,publication:{...p,identity:undefined,access_fingerprint:undefined,access_attempt:undefined,access_app:undefined,access_delete_attempt:undefined}};
  }
  if(!p)throw new RemoteError("The publication was not found.",404);
  if(this.db.prepare(`SELECT id FROM operations WHERE publication_id=? AND status IN (${active.map(()=>"?").join(",")})`).get(p.id,...active))throw new RemoteError("Finish or cancel the current operation first.",409);
  const config=accessConfig(access===undefined?{mode:p.access_mode,emails:JSON.parse(p.access_emails)}:access);
  if(action!=="publish"&&action!=="access"&&access!==undefined)throw new RemoteError("Change access separately from restore or removal.",400);
  const cf=await this.cloud(p);let snapshot=null,notes="";
  const project=await cf.getProject(p.project);
  if(p.identity) {
   if(project && identity(project)!==p.identity)throw new RemoteError("The remote project identity changed. Review it in Cloudflare.",409);
   if(!project && action!=="remove")throw new RemoteError("The remote project is missing. Remove the publication record before publishing again.",409);
  }else if(project)throw new RemoteError("The project name is already in use. Review it in Cloudflare.",409);
  if(action!=="publish" && !p.identity)throw new RemoteError("This site has not been created yet.",409);
  if((action==="publish"||action==="access"||action==="analytics") && p.identity && project) snapshot={canonical:project.canonical_deployment?.id,identity:identity(project),domains:[...(project.domains||[])].sort()};
  if(action==="remove" && project) {
   const deployments=await cf.deployments(p.project);
   snapshot={identity:identity(project),domains:[...(project.domains||[])].sort(),deployments:deployments.map(d=>d.id).sort()};
   const external=deployments.filter(d=>!String(d.deployment_trigger?.metadata?.commit_message||"").startsWith("picode:"));
   notes=` Removes ${deployments.length} deployments and their preview URLs.`;
   const domains=(project.domains||[]).filter(d=>!d.endsWith(".pages.dev"));if(domains.length)notes+=" Custom domains: "+domains.join(", ")+".";
   if(external.length)notes+=" Includes "+external.length+" deployments created outside this extension.";
  }
  if(action==="rename") {
   if(await cf.getProject(projectName))throw new RemoteError("The new project name is already in use. Choose another name.",409);
   const deployments=await cf.deployments(p.project);
   snapshot={canonical:project.canonical_deployment?.id,identity:identity(project),domains:[...(project.domains||[])].sort(),newName:projectName,oldTag:p.analytics_tag||null};
   notes=` The current address ${p.project}.pages.dev and its ${deployments.length} deployment URL${deployments.length===1?"":"s"} stop working. Version history moves to the new address.`;
  }
  if(action==="rollback") {
   const target=this.db.prepare("SELECT * FROM deployments WHERE publication_id=? AND id=?").get(p.id,deployment);
   if(!target || target.project!==p.project)throw new RemoteError("Choose a publication from this site's history.",400);
   const d=await cf.deployment(p.project,deployment);
   if(d.environment!=="production"||d.latest_stage?.status!=="success")throw new RemoteError("Only successful production publications can be restored.",409);
   version=target.version;bundle={digest:target.digest};snapshot={canonical:project.canonical_deployment?.id,identity:identity(project),domains:[...(project.domains||[])].sort()};
  }
  const accessSnapshot=await this.access.snapshot(p);
  if(config.mode==='restricted'&&action!=='remove'){
   const {cf:ac}=await this.access.setup(p);await this.access.conflicts(ac,p,project?[p.project+'.pages.dev','*.'+p.project+'.pages.dev',...(project.domains||[])]:[p.project+'.pages.dev','*.'+p.project+'.pages.dev']);
  }
  const opAnalytics=action==="publish"?(analytics===undefined?!!p.analytics_tag:analytics):action==="analytics"?analytics:0;
  if(action==='publish'&&p.status==='published'&&p.digest===bundle.digest&&p.access_mode===config.mode&&p.access_emails===JSON.stringify(config.emails)&&!!p.analytics_tag===!!opAnalytics&&project&&identity(project)===p.identity&&project.canonical_deployment?.id===p.deployment){
   if(config.mode==='restricted')await this.access.verify(p,config,project);return {unchanged:true,action,publication:{...p,identity:undefined,access_app:undefined,access_fingerprint:undefined,access_attempt:undefined,access_delete_attempt:undefined}};
  }
  const coverage=config.mode==='restricted'?` Covered hostnames: ${[p.project+'.pages.dev','*.'+p.project+'.pages.dev',...(project?.domains||[])].join(', ')}.`:'';
  const id=randomUUID(),audience=config.mode==='public'?'Anyone can access this site and its previous deployment URLs.':'Only these email addresses may sign in: '+config.emails.join(', ')+'. Production and preview URLs will require an email code.';
  const confirmation={title:action==='access'?'Change site access?':action==='remove'?'Remove this site?':action==='rollback'?'Restore this publication?':action==='analytics'?(analytics?'Enable Web Analytics?':'Disable Web Analytics?'):action==='rename'?'Change the site address?':'Publish this artifact version?',message:action==='remove'?`Remove ${p.project} from Cloudflare account ${p.account_id}.${notes} The local artifact stays. Managed access protection is cleaned up only after site removal.`:action==='access'?`Change access for “${p.title}” in Cloudflare account ${p.account_id}. ${audience}${coverage}`:action==='analytics'?(analytics?`Enable Web Analytics for “${p.title}” (${p.project}.pages.dev)? Cloudflare adds its privacy-first beacon automatically from the next publication; the current publication counts after it is published again.`:`Disable Web Analytics for “${p.title}”? Publications stop reporting from the next one; the current publication keeps counting until it is published again. Analytics already collected remain in Cloudflare.`):action==='rename'?`Publish “${p.title}”, version ${version}, to ${projectName}.pages.dev and remove ${p.project}.pages.dev in Cloudflare account ${p.account_id}.${notes} ${audience}`:`Publish “${p.title}”, version ${version}, to ${p.project} in Cloudflare account ${p.account_id}. ${audience}${coverage}`,confirmLabel:action==='access'?'Change access':action==='remove'?'Remove site':action==='rollback'?'Restore':action==='analytics'?(analytics?'Enable analytics':'Disable analytics'):action==='rename'?'Change address':'Publish',danger:action==='remove'||action==='rename'||(p.access_mode==='restricted'&&config.mode==='public')};
  if(confirmation.message.length>2000)throw new RemoteError("The reader list or project changes are too large for one confirmation. Reduce the reader list or review Cloudflare.",409);
  const revision=digest({id,confirmation,version,digest:bundle?.digest||null,snapshot,deployment:deployment||null,access:config,accessSnapshot});
  confirmation.revision=revision;
  this.db.prepare("INSERT INTO operations(id,publication_id,action,version,digest,deployment,status,confirmation,revision,snapshot,access_config,access_snapshot,analytics,created_at,updated_at) VALUES(?,?,?,?,?,?,'prepared',?,?,?,?,?,?,?,?)").run(id,p.id,action,version||null,bundle?.digest||null,deployment||null,JSON.stringify(confirmation),revision,snapshot?JSON.stringify(snapshot):null,JSON.stringify(config),accessSnapshot?JSON.stringify(accessSnapshot):null,opAnalytics?1:0,now(),now());
  await this.event();return this.operation(id);
 }
 operation(id) {const op=this.op(id);if(!op)throw new RemoteError("The operation was not found.",404);const {access_snapshot,access_config,snapshot,...visible}=op;return {...visible,confirmation:JSON.parse(op.confirmation)};}
 async confirm(id,revision) {
  const op=this.op(id);if(!op || op.revision!==revision || op.status!=="prepared")throw new RemoteError("The operation changed. Prepare it again.",409);
  this.set(id,"queued");this.launch(id,false);return {id,status:"queued"};
 }
 cancel(id) {const op=this.op(id);if(!op)throw new RemoteError("The operation was not found.",404);if(op.status!=="prepared")throw new RemoteError("This operation may have changed Cloudflare. Check its result first.",409);this.set(id,"cancelled");return {cancelled:true};}
 reconcile(id) {const op=this.op(id);if(!op || op.status==="prepared")throw new RemoteError("The operation has not been confirmed.",409);if(["failed","published","removed","renamed","cancelled"].includes(op.status))return this.operation(id);this.launch(id,true);return {id,status:op.status};}
 launch(id,recovery) {if(this.running.has(id)||this.closing)return;this.running.add(id);queueMicrotask(()=>this.execute(id,recovery).catch(()=>{}).finally(()=>this.running.delete(id)));}
 async recover() {for(const op of this.db.prepare(`SELECT id FROM operations WHERE status IN (${active.slice(1).map(()=>"?").join(",")})`).all(...active.slice(1)))this.launch(op.id,true);}
 async checkProject(cf,p) {const project=await cf.getProject(p.project);if(project && p.identity && identity(project)!==p.identity)throw new RemoteError("The remote project identity changed. Review it in Cloudflare.",409);return project;}
 async finish(cf,p,op,deployment) {
  const d=await cf.deployment(p.project,deployment);const status=d.latest_stage?.status;
  if(["failure","failed","canceled","cancelled"].includes(status)){this.set(op.id,"failed",{error:"Cloudflare could not publish this version. The previous publication is retained."});return;}
  if(status!=="success"){this.set(op.id,"verifying",{deployment});return;}
  const project=await this.checkProject(cf,p);
  if(!project || project.canonical_deployment?.id!==deployment){this.set(op.id,"unknown",{error:"The production publication differs from this operation. Review Cloudflare before continuing."});return;}
  const config=op.access_config?JSON.parse(op.access_config):accessConfig();
  if(config.mode==='restricted')await this.access.verify(this.pub(p.id),config,project,(await cf.deployments(p.project)).map(d=>d.url));
  const url=publicURL("https://"+project.subdomain);
  this.db.exec("BEGIN IMMEDIATE");try {
   this.db.prepare("UPDATE publications SET status='published',version=?,digest=?,deployment=?,url=? WHERE id=?").run(op.version,op.digest,deployment,url,p.id);
   this.db.prepare("INSERT OR IGNORE INTO deployments(id,publication_id,operation_id,version,digest,url,created_at,project) VALUES(?,?,?,?,?,?,?,?)").run(deployment,p.id,op.id,op.version,op.digest,publicURL(d.url),now(),p.project);
   this.db.prepare("UPDATE operations SET status='published',deployment=?,error=NULL,updated_at=? WHERE id=?").run(deployment,now(),op.id);this.db.exec("COMMIT");
  }catch(e){this.db.exec("ROLLBACK");throw e;}await this.event();
 }
 async execute(id,recovery) {
  let op=this.op(id),p=this.pub(op.publication_id),phase=op.remote_phase||op.status,effect=recovery && ["creating","protecting","analytics","deploying","verifying","removing","rolling-back","unknown"].includes(op.status);
  try {
   const cf=await this.cloud(p);let project=await this.checkProject(cf,p);
   if(op.action==="remove") {
    if(!project){if(p.access_app||p.access_attempt){this.set(id,"protecting");effect=true;}await this.access.remove(p,op.access_snapshot?JSON.parse(op.access_snapshot):null,recovery);await this.analytics.dispose(cf,p);this.db.prepare("UPDATE publications SET status='removed' WHERE id=?").run(p.id);this.set(id,"removed");return;}
    if(recovery && ["removing","unknown"].includes(op.status)){this.set(id,"unknown",{error:"Removal has not been confirmed. Check Cloudflare again; this extension will not repeat an uncertain delete."});return;}
    const snapshot={identity:identity(project),domains:[...(project.domains||[])].sort(),deployments:(await cf.deployments(p.project)).map(d=>d.id).sort()};
    if(JSON.stringify(snapshot)!==op.snapshot){this.set(id,"failed",{error:"The project changed after review. Prepare removal again."});return;}
    if(op.access_snapshot&&accessHash(await this.access.snapshot(p))!==accessHash(JSON.parse(op.access_snapshot)))throw new RemoteError("The Access policy changed after review.",409);
    this.set(id,"removing");effect=true;await cf.remove(p.project);
    if(await cf.getProject(p.project)){this.set(id,"unknown",{error:"Cloudflare still reports this project. Check again."});return;}
    if(p.access_app||p.access_attempt)this.set(id,"protecting");
    await this.access.remove(p,op.access_snapshot?JSON.parse(op.access_snapshot):null,false);
    await this.analytics.dispose(cf,p);
    this.db.prepare("UPDATE publications SET status='removed' WHERE id=?").run(p.id);this.set(id,"removed");return;
   }
   if(op.action==='access'){
    if(!project)throw new RemoteError('The project is missing.',409);
    const reviewed=JSON.parse(op.snapshot);if(project.canonical_deployment?.id!==reviewed.canonical||JSON.stringify([...(project.domains||[])].sort())!==JSON.stringify(reviewed.domains||[]))throw new RemoteError('The production version changed after review.',409);
    this.set(id,'protecting');effect=true;await this.finishAccess(p,op,project,recovery);if(JSON.parse(op.access_config).mode==='restricted')await this.access.verify(this.pub(p.id),JSON.parse(op.access_config),project,(await cf.deployments(p.project)).map(d=>d.url));this.set(id,'published');return;
   }
   if(op.action==="rollback") {
    if(!project)throw new RemoteError("The remote project is missing.",409);
    if(recovery){await this.finish(cf,p,op,op.deployment);return;}
    const snapshot=JSON.parse(op.snapshot);
    if(project.canonical_deployment?.id!==snapshot.canonical){this.set(id,"failed",{error:"The production version changed after review. Prepare restore again."});return;}
    if(p.access_mode==='restricted')await this.access.verify(p,accessConfig({mode:p.access_mode,emails:JSON.parse(p.access_emails)}),project);
    this.set(id,"rolling-back");effect=true;await cf.rollback(p.project,op.deployment);await this.finish(cf,p,op,op.deployment);return;
   }
   if(op.action==='analytics'){
    if(!project)throw new RemoteError('The project is missing.',409);
    const reviewed=JSON.parse(op.snapshot);if(project.canonical_deployment?.id!==reviewed.canonical||JSON.stringify([...(project.domains||[])].sort())!==JSON.stringify(reviewed.domains||[]))throw new RemoteError('The production version changed after review.',409);
    this.set(id,'analytics');effect=true;
    if(op.analytics)await this.analytics.ensure(cf,this.pub(p.id),project);else await this.analytics.clear(cf,this.pub(p.id),project);
    this.set(id,'published');return;
   }
   if(op.action==="rename") {
    const reviewed=JSON.parse(op.snapshot),progress0=op.progress?JSON.parse(op.progress):null;
    if(progress0?.swapped){/* The new address is confirmed; only the old project teardown remains. */}
    else {
     if(!project)throw new RemoteError("The remote project is missing.",409);
     if(project.canonical_deployment?.id!==reviewed.canonical)throw new RemoteError("The production version changed after review. Prepare the address change again.",409);
     if(op.deployment){if(!await this.finishRename(cf,p,op,op.deployment))return;}
     else if(phase==="deploying"){
      const found=(await cf.deployments(reviewed.newName)).filter(d=>d.deployment_trigger?.metadata?.commit_message===`picode:${id}:${op.digest}`);
      if(found.length===1){this.set(id,"verifying",{deployment:found[0].id});op=this.op(id);if(!await this.finishRename(cf,p,op,found[0].id))return;}
      else {this.set(id,"unknown",{error:"The new deployment result is uncertain. Check again; no second deployment was created."});return;}
     }else {
      let fresh=null;
      if(["creating","analytics","uploading","deploying"].includes(phase)) {
       fresh=await cf.getProject(reviewed.newName);
       if(fresh&&(Date.parse(fresh.created_on)<Date.parse(op.created_at)-5000||fresh.source||fresh.production_branch!=="main"))throw new RemoteError("The new project could not be identified as this operation's project.",409);
      }
      if(!fresh) {
       if(await cf.getProject(reviewed.newName))throw new RemoteError("The new project name is already in use. Prepare the address change with another name.",409);
       this.set(id,"creating");effect=true;fresh=await cf.createProject(reviewed.newName);
      }
      if(!fresh?.id||!fresh.created_on)throw new RemoteError("Cloudflare did not return the new project's identity.");
      this.set(id,"analytics");effect=true;
      const newTag=await this.analytics.ensure(cf,{...p,project:reviewed.newName},fresh,false);
      this.db.prepare("UPDATE operations SET progress=? WHERE id=?").run(JSON.stringify({oldName:p.project,newName:reviewed.newName,newIdentity:identity(fresh),newTag,oldTag:reviewed.oldTag||null}),id);op=this.op(id);
      this.set(id,"uploading");effect=false;
      const bundle=await this.bundle(p.artifact_id,op.version);
      if(bundle.digest!==op.digest)throw new RemoteError("The prepared package changed. Prepare the address change again.",409);
      const form=await cf.deploy(reviewed.newName,bundle,`picode:${id}:${op.digest}`,(()=>{let n=0;const total=bundle.files.length;return()=>{n++;this.db.prepare("UPDATE operations SET progress=? WHERE id=?").run(JSON.stringify({uploaded:n,total}),id);void this.event();};})());
      const current=await this.checkProject(cf,p);
      if(current?.canonical_deployment?.id!==reviewed.canonical)throw new RemoteError("The production version changed after review. Prepare the address change again.",409);
      this.set(id,"deploying");effect=true;
      const d=await cf.createDeployment(reviewed.newName,form);
      if(!d?.id)throw new RemoteError("Cloudflare did not identify the new deployment.");
      this.set(id,"verifying",{deployment:d.id});op=this.op(id);
      if(!await this.finishRename(cf,p,op,d.id))return;
     }
    }
    // A delete is only uncertain when a previous run may have issued it: a
    // crash after the swap. The run that performs the swap owns its delete.
    const swappedBefore=!!progress0?.swapped;
    const progress=JSON.parse(this.op(id).progress||"null");
    if(!progress?.newName||!progress?.swapped)throw new RemoteError("The address change is not confirmed. Check the result.",409);
    this.set(id,"removing");effect=true;
    if(await cf.getProject(progress.oldName)) {
     if(recovery&&swappedBefore) {this.set(id,"unknown",{error:"The old site has not been confirmed removed. Check Cloudflare again; this extension will not repeat an uncertain delete."});return;}
     await cf.remove(progress.oldName);
     if(await cf.getProject(progress.oldName)) {this.set(id,"unknown",{error:"Cloudflare still reports the old project. Check again."});return;}
    }
    if(progress.oldTag&&progress.oldTag!==this.pub(p.id).analytics_tag)await this.analytics.dispose(cf,{...p,analytics_tag:progress.oldTag});
    this.set(id,"renamed");return;
   }
   if(recovery && ["deploying","verifying","unknown"].includes(phase) && p.identity) {
    if(op.deployment){await this.finish(cf,p,op,op.deployment);return;}
    const found=(await cf.deployments(p.project)).filter(d=>d.deployment_trigger?.metadata?.commit_message===`picode:${id}:${op.digest}`);
    if(found.length===1){this.set(id,"verifying",{deployment:found[0].id});await this.finish(cf,p,op,found[0].id);return;}
    this.set(id,"unknown",{error:"The deployment result is uncertain. Check again; no second deployment was created."});return;
   }
   const bundle=await this.bundle(p.artifact_id,op.version);
   if(bundle.digest!==op.digest)throw new RemoteError("The prepared package changed. Prepare publication again.",409);
   if(!p.identity) {
    if(recovery && phase==="creating") {
     if(!p.generated_name){this.set(id,"unknown",{error:"Project creation for a chosen name cannot be identified after interruption. Review Cloudflare; no project was adopted or created again."});return;}
     if(!project){this.set(id,"unknown",{error:"Project creation is uncertain. Check Cloudflare again before retrying."});return;}
     // Random project names are allocated before creation. A project that
     // predates the operation can never be adopted during reconciliation.
     if(Date.parse(project.created_on)<Date.parse(op.created_at)-5000 || project.source || project.production_branch!=="main")throw new RemoteError("The project could not be identified as this operation's project.",409);
    }else {
     if(project)throw new RemoteError("The project name is already in use.",409);
     this.set(id,"creating");effect=true;project=await cf.createProject(p.project);
    }
    if(!project?.id || !project.created_on)throw new RemoteError("Cloudflare did not return the project's identity.");
    this.db.prepare("UPDATE publications SET identity=? WHERE id=?").run(identity(project),p.id);p=this.pub(p.id);
   }else if(!project)throw new RemoteError("The remote project is missing.",409);
   if(op.snapshot){const reviewed=JSON.parse(op.snapshot);if(project.canonical_deployment?.id!==reviewed.canonical||(reviewed.domains&&JSON.stringify([...(project.domains||[])].sort())!==JSON.stringify(reviewed.domains)))throw new RemoteError('The project changed after review. Prepare publication again.',409);}
   const config=op.access_config?JSON.parse(op.access_config):accessConfig();
   if(config.mode==='restricted'||p.access_app||p.access_attempt){this.set(id,'protecting');effect=true;await this.finishAccess(p,op,project,recovery);p=this.pub(p.id);}
   if(op.analytics){this.set(id,"analytics");effect=true;await this.analytics.ensure(cf,p,project);p=this.pub(p.id);}
   else if(p.analytics_tag){this.set(id,"analytics");effect=true;await this.analytics.clear(cf,p,project);p=this.pub(p.id);}
   this.set(id,"uploading");effect=false;
   let uploaded=0;const total=bundle.files.length,onUpload=()=>{uploaded++;this.db.prepare("UPDATE operations SET progress=? WHERE id=?").run(JSON.stringify({uploaded,total}),id);void this.event();};
   const form=await cf.deploy(p.project,bundle,`picode:${id}:${op.digest}`,onUpload);
   if(op.snapshot) { const reviewed=JSON.parse(op.snapshot);const current=await this.checkProject(cf,p);if(current?.canonical_deployment?.id!==reviewed.canonical)throw new RemoteError("The production version changed after review. Prepare publication again.",409); }
   this.set(id,"deploying");effect=true;
   const d=await cf.createDeployment(p.project,form);
   if(!d?.id)throw new RemoteError("Cloudflare did not identify the deployment.");
   this.set(id,"verifying",{deployment:d.id});op=this.op(id);await this.finish(cf,p,op,d.id);
  }catch(e){this.set(id,effect && (recovery || !(e instanceof RemoteError && [400,401,403,404,409,422].includes(e.status) && this.op(id).remote_phase!=="protecting"))?"unknown":"failed",{error:e instanceof RemoteError?e.message:"The operation could not complete. Check its result."});}
 }
 async tick() {if(this.closing)return;for(const op of this.db.prepare("SELECT id FROM operations WHERE status='verifying'").all())this.launch(op.id,true);}
 // Confirms the new address deployment and swaps the publication row onto it.
 // A failure here retains the old site; only the swap is committed locally.
 // Returns false while the deployment is still activating or its result is
 // held — the rename flow must stop and let tick/reconcile resume it.
 async finishRename(cf,p,op,deployment) {
  const progress=op.progress?JSON.parse(op.progress):null;
  if(!progress?.newName||!progress.newIdentity)throw new RemoteError("The address change lost its progress record. Check the result.",409);
  const d=await cf.deployment(progress.newName,deployment),status=d.latest_stage?.status;
  if(["failure","failed","canceled","cancelled"].includes(status)){this.set(op.id,"failed",{error:"Cloudflare could not publish to the new address. The current site is unchanged."});return false;}
  if(status!=="success"){this.set(op.id,"verifying",{deployment});return false;}
  const fresh=await cf.getProject(progress.newName);
  if(!fresh||identity(fresh)!==progress.newIdentity||fresh.canonical_deployment?.id!==deployment){this.set(op.id,"unknown",{error:"The new address does not show this publication. Review Cloudflare before continuing."});return false;}
  if(this.pub(p.id).project!==progress.newName) {
   this.db.exec("BEGIN IMMEDIATE");try {
    this.db.prepare("UPDATE publications SET project=?,identity=?,deployment=?,url=?,analytics_tag=? WHERE id=?").run(progress.newName,progress.newIdentity,deployment,publicURL("https://"+fresh.subdomain),progress.newTag||p.analytics_tag,p.id);
    this.db.prepare("INSERT OR IGNORE INTO deployments(id,publication_id,operation_id,version,digest,url,created_at,project) VALUES(?,?,?,?,?,?,?,?)").run(deployment,p.id,op.id,op.version,op.digest,publicURL(d.url),now(),progress.newName);
    this.db.prepare("UPDATE operations SET progress=?,deployment=?,error=NULL,updated_at=? WHERE id=?").run(JSON.stringify({...progress,swapped:true}),deployment,now(),op.id);
    this.db.exec("COMMIT");
   }catch(e){this.db.exec("ROLLBACK");throw e;}
  }
  await this.event();return true;
 }
}
