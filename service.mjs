import { randomUUID, createHash } from "node:crypto";
import { RemoteError } from "./cloudflare.mjs";
import {PublicationAccess,accessConfig,accessHash} from "./access.mjs";

const active=["prepared","queued","creating","protecting","uploading","deploying","verifying","removing","rolling-back","unknown"];
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
  return {artifacts,error,connection:await this.connectionState(),accessSetup:await this.accessSetupState(),publications:pubs.map(p=>({...p,identity:undefined,access_fingerprint:undefined,access_attempt:undefined,access_app:undefined,access_delete_attempt:undefined,access_emails:JSON.parse(p.access_emails),accessPending:!!p.access_attempt,hasProject:!!p.identity,latestVersion:artifacts.find(a=>a.id===p.artifact_id)?.liveVersion||null,history:this.db.prepare("SELECT * FROM deployments WHERE publication_id=? ORDER BY created_at DESC").all(p.id),operations:this.db.prepare("SELECT id,action,version,status,error,updated_at FROM operations WHERE publication_id=? ORDER BY created_at DESC LIMIT 20").all(p.id)}))};
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
  let result={status:"ready",checkedAt:now(),message:"Account access verified. Publishing requires Pages Edit permission."};
  try {await this.remote(c.account,c.token).checkConnection();}
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
 async prepare({artifactId,version,action="publish",publicationId,deployment,projectName,access}) {
  if(!["publish","remove","rollback","access"].includes(action))throw new RemoteError("Choose publish, remove, rollback or access.",400);
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
  if((action==="publish"||action==="access") && p.identity && project) snapshot={canonical:project.canonical_deployment?.id,identity:identity(project),domains:[...(project.domains||[])].sort()};
  if(action==="remove" && project) {
   const deployments=await cf.deployments(p.project);
   snapshot={identity:identity(project),domains:[...(project.domains||[])].sort(),deployments:deployments.map(d=>d.id).sort()};
   const external=deployments.filter(d=>!String(d.deployment_trigger?.metadata?.commit_message||"").startsWith("picode:"));
   notes=` Removes ${deployments.length} deployments and their preview URLs.`;
   const domains=(project.domains||[]).filter(d=>!d.endsWith(".pages.dev"));if(domains.length)notes+=" Custom domains: "+domains.join(", ")+".";
   if(external.length)notes+=" Includes "+external.length+" deployments created outside this extension.";
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
  if(action==='publish'&&p.status==='published'&&p.digest===bundle.digest&&p.access_mode===config.mode&&p.access_emails===JSON.stringify(config.emails)&&project&&identity(project)===p.identity&&project.canonical_deployment?.id===p.deployment){
   if(config.mode==='restricted')await this.access.verify(p,config,project);return {unchanged:true,publication:{...p,identity:undefined,access_app:undefined,access_fingerprint:undefined,access_attempt:undefined,access_delete_attempt:undefined}};
  }
  const coverage=config.mode==='restricted'?` Covered hostnames: ${[p.project+'.pages.dev','*.'+p.project+'.pages.dev',...(project?.domains||[])].join(', ')}.`:'';
  const id=randomUUID(),audience=config.mode==='public'?'Anyone can access this site and its previous deployment URLs.':'Only these email addresses may sign in: '+config.emails.join(', ')+'. Production and preview URLs will require an email code.';
  const confirmation={title:action==='access'?'Change site access?':action==='remove'?'Remove this site?':action==='rollback'?'Restore this publication?':'Publish this artifact version?',message:action==='remove'?`Remove ${p.project} from Cloudflare account ${p.account_id}.${notes} The local artifact stays. Managed access protection is cleaned up only after site removal.`:action==='access'?`Change access for “${p.title}” in Cloudflare account ${p.account_id}. ${audience}${coverage}`:`Publish “${p.title}”, version ${version}, to ${p.project} in Cloudflare account ${p.account_id}. ${audience}${coverage}`,confirmLabel:action==='access'?'Change access':action==='remove'?'Remove site':action==='rollback'?'Restore':'Publish',danger:action==='remove'||(p.access_mode==='restricted'&&config.mode==='public')};
  if(confirmation.message.length>2000)throw new RemoteError("The reader list or project changes are too large for one confirmation. Reduce the reader list or review Cloudflare.",409);
  const revision=digest({id,confirmation,version,digest:bundle?.digest||null,snapshot,deployment:deployment||null,access:config,accessSnapshot});confirmation.revision=revision;
  this.db.prepare("INSERT INTO operations(id,publication_id,action,version,digest,deployment,status,confirmation,revision,snapshot,access_config,access_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?,'prepared',?,?,?,?,?,?,?)").run(id,p.id,action,version||null,bundle?.digest||null,deployment||null,JSON.stringify(confirmation),revision,snapshot?JSON.stringify(snapshot):null,JSON.stringify(config),accessSnapshot?JSON.stringify(accessSnapshot):null,now(),now());
  await this.event();return this.operation(id);
 }
 operation(id) {const op=this.op(id);if(!op)throw new RemoteError("The operation was not found.",404);const {access_snapshot,access_config,snapshot,...visible}=op;return {...visible,confirmation:JSON.parse(op.confirmation)};}
 async confirm(id,revision) {
  const op=this.op(id);if(!op || op.revision!==revision || op.status!=="prepared")throw new RemoteError("The operation changed. Prepare it again.",409);
  this.set(id,"queued");this.launch(id,false);return {id,status:"queued"};
 }
 cancel(id) {const op=this.op(id);if(!op)throw new RemoteError("The operation was not found.",404);if(op.status!=="prepared")throw new RemoteError("This operation may have changed Cloudflare. Check its result first.",409);this.set(id,"cancelled");return {cancelled:true};}
 reconcile(id) {const op=this.op(id);if(!op || op.status==="prepared")throw new RemoteError("The operation has not been confirmed.",409);if(["failed","published","removed","cancelled"].includes(op.status))return this.operation(id);this.launch(id,true);return {id,status:op.status};}
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
  let op=this.op(id),p=this.pub(op.publication_id),phase=op.remote_phase||op.status,effect=recovery && ["creating","protecting","deploying","verifying","removing","rolling-back","unknown"].includes(op.status);
  try {
   const cf=await this.cloud(p);let project=await this.checkProject(cf,p);
   if(op.action==="remove") {
    if(!project){if(p.access_app||p.access_attempt){this.set(id,"protecting");effect=true;}await this.access.remove(p,op.access_snapshot?JSON.parse(op.access_snapshot):null,recovery);this.db.prepare("UPDATE publications SET status='removed' WHERE id=?").run(p.id);this.set(id,"removed");return;}
    if(recovery && ["removing","unknown"].includes(op.status)){this.set(id,"unknown",{error:"Removal has not been confirmed. Check Cloudflare again; this extension will not repeat an uncertain delete."});return;}
    const snapshot={identity:identity(project),domains:[...(project.domains||[])].sort(),deployments:(await cf.deployments(p.project)).map(d=>d.id).sort()};
    if(JSON.stringify(snapshot)!==op.snapshot){this.set(id,"failed",{error:"The project changed after review. Prepare removal again."});return;}
    if(op.access_snapshot&&accessHash(await this.access.snapshot(p))!==accessHash(JSON.parse(op.access_snapshot)))throw new RemoteError("The Access policy changed after review.",409);
    this.set(id,"removing");effect=true;await cf.remove(p.project);
    if(await cf.getProject(p.project)){this.set(id,"unknown",{error:"Cloudflare still reports this project. Check again."});return;}
    if(p.access_app||p.access_attempt)this.set(id,"protecting");
    await this.access.remove(p,op.access_snapshot?JSON.parse(op.access_snapshot):null,false);
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
   this.set(id,"uploading");effect=false;
   const form=await cf.deploy(p.project,bundle,`picode:${id}:${op.digest}`,()=>void this.event());
   if(op.snapshot) { const reviewed=JSON.parse(op.snapshot);const current=await this.checkProject(cf,p);if(current?.canonical_deployment?.id!==reviewed.canonical)throw new RemoteError("The production version changed after review. Prepare publication again.",409); }
   this.set(id,"deploying");effect=true;
   const d=await cf.createDeployment(p.project,form);
   if(!d?.id)throw new RemoteError("Cloudflare did not identify the deployment.");
   this.set(id,"verifying",{deployment:d.id});op=this.op(id);await this.finish(cf,p,op,d.id);
  }catch(e){this.set(id,effect && (recovery || !(e instanceof RemoteError && [400,401,403,404,409,422].includes(e.status) && this.op(id).remote_phase!=="protecting"))?"unknown":"failed",{error:e instanceof RemoteError?e.message:"The operation could not complete. Check its result."});}
 }
 async tick() {if(this.closing)return;for(const op of this.db.prepare("SELECT id FROM operations WHERE status='verifying'").all())this.launch(op.id,true);}
}
