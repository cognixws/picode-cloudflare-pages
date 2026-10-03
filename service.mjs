import { randomUUID, createHash } from "node:crypto";
import { RemoteError } from "./cloudflare.mjs";

const active=["prepared","queued","creating","uploading","deploying","verifying","removing","rolling-back","unknown"];
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
  this.db=db;this.host=host;this.remote=remote;this.emit=emit;this.running=new Set();this.closing=false;
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
 }
 pub(id) {return this.db.prepare("SELECT * FROM publications WHERE id=?").get(id);}
 op(id) {return this.db.prepare("SELECT * FROM operations WHERE id=?").get(id);}
 event() {return this.emit("changed",{}).catch(()=>{});}
 set(id,status,extra={}) {
  const entries=Object.entries(extra);this.db.prepare(`UPDATE operations SET status=?,updated_at=?${entries.map(([k])=>", "+k+"=?").join("")} WHERE id=?`).run(status,now(),...entries.map(([,v])=>v),id);void this.event();
 }
 async state() {
  let artifacts=[],error="";try{artifacts=(await this.host("/artifacts")).artifacts||[];}catch{error="Artifacts could not be loaded. Retry.";}
  const pubs=this.db.prepare("SELECT * FROM publications ORDER BY created_at DESC").all();
  return {artifacts,error,publications:pubs.map(p=>({...p,identity:undefined,hasProject:!!p.identity,latestVersion:artifacts.find(a=>a.id===p.artifact_id)?.liveVersion||null,history:this.db.prepare("SELECT * FROM deployments WHERE publication_id=? ORDER BY created_at DESC").all(p.id),operations:this.db.prepare("SELECT id,action,version,status,error,updated_at FROM operations WHERE publication_id=? ORDER BY created_at DESC LIMIT 20").all(p.id)}))};
 }
 async configuration() {const r=await this.host("/settings");return {account:r.values?.account_id,token:r.secrets?.api_token};}
 async cloud(p) {
  const c=await this.configuration();if(c.account!==p.account_id)throw new RemoteError("This publication belongs to another Cloudflare account. Restore its account in settings.",409);
  return this.remote(c.account,c.token);
 }
 async source(id) {return this.host("/artifacts/"+encodeURIComponent(id));}
 // JSON base64 expands the core's 128 MiB raw package; leave metadata headroom.
 async bundle(id,version) {return this.host("/artifacts/"+encodeURIComponent(id)+"/versions/"+version+"/site",192<<20);}
 async prepare({artifactId,version,action="publish",publicationId,deployment,projectName}) {
  if(!["publish","remove","rollback"].includes(action))throw new RemoteError("Choose publish, remove or rollback.",400);
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
   if(p.status==="published" && p.digest===bundle.digest) {
    const cf=await this.cloud(p),project=await cf.getProject(p.project);
    if(project && identity(project)===p.identity && project.canonical_deployment?.id===p.deployment)return {unchanged:true,publication:p};
   }
  }
  if(!p)throw new RemoteError("The publication was not found.",404);
  if(this.db.prepare(`SELECT id FROM operations WHERE publication_id=? AND status IN (${active.map(()=>"?").join(",")})`).get(p.id,...active))throw new RemoteError("Finish or cancel the current operation first.",409);
  const cf=await this.cloud(p);let snapshot=null,notes="";
  const project=await cf.getProject(p.project);
  if(p.identity) {
   if(project && identity(project)!==p.identity)throw new RemoteError("The remote project identity changed. Review it in Cloudflare.",409);
   if(!project && action!=="remove")throw new RemoteError("The remote project is missing. Remove the publication record before publishing again.",409);
  }else if(project)throw new RemoteError("The project name is already in use. Review it in Cloudflare.",409);
  if(action!=="publish" && !p.identity)throw new RemoteError("This site has not been created yet.",409);
  if(action==="publish" && p.identity && project) snapshot={canonical:project.canonical_deployment?.id,identity:identity(project)};
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
   version=target.version;bundle={digest:target.digest};snapshot={canonical:project.canonical_deployment?.id,identity:identity(project)};
  }
  const id=randomUUID();const confirmation={title:action==="remove"?"Remove this public site?":action==="rollback"?"Restore this publication?":"Publish this artifact version?",message:action==="remove"?`Remove ${p.project} from Cloudflare account ${p.account_id}.${notes} The local artifact stays.`:`Publish “${p.title}”, version ${version}, to ${p.project} in Cloudflare account ${p.account_id}. The site will be public.`,confirmLabel:action==="remove"?"Remove site":action==="rollback"?"Restore":"Publish",danger:action==="remove"};
  if(confirmation.message.length>2000)throw new RemoteError("Too many project changes to confirm here. Review the project in Cloudflare.",409);
  const revision=digest({id,confirmation,version,digest:bundle?.digest||null,snapshot,deployment:deployment||null});confirmation.revision=revision;
  this.db.prepare("INSERT INTO operations(id,publication_id,action,version,digest,deployment,status,confirmation,revision,snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?,'prepared',?,?,?,?,?)").run(id,p.id,action,version||null,bundle?.digest||null,deployment||null,JSON.stringify(confirmation),revision,snapshot?JSON.stringify(snapshot):null,now(),now());
  await this.event();return this.operation(id);
 }
 operation(id) {const op=this.op(id);if(!op)throw new RemoteError("The operation was not found.",404);return {...op,confirmation:JSON.parse(op.confirmation)};}
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
  const url=publicURL("https://"+project.subdomain);
  this.db.exec("BEGIN IMMEDIATE");try {
   this.db.prepare("UPDATE publications SET status='published',version=?,digest=?,deployment=?,url=? WHERE id=?").run(op.version,op.digest,deployment,url,p.id);
   this.db.prepare("INSERT OR IGNORE INTO deployments(id,publication_id,operation_id,version,digest,url,created_at,project) VALUES(?,?,?,?,?,?,?,?)").run(deployment,p.id,op.id,op.version,op.digest,publicURL(d.url),now(),p.project);
   this.db.prepare("UPDATE operations SET status='published',deployment=?,error=NULL,updated_at=? WHERE id=?").run(deployment,now(),op.id);this.db.exec("COMMIT");
  }catch(e){this.db.exec("ROLLBACK");throw e;}await this.event();
 }
 async execute(id,recovery) {
  let op=this.op(id),p=this.pub(op.publication_id),effect=recovery && ["creating","deploying","verifying","removing","rolling-back","unknown"].includes(op.status);
  try {
   const cf=await this.cloud(p);let project=await this.checkProject(cf,p);
   if(op.action==="remove") {
    if(!project){this.db.prepare("UPDATE publications SET status='removed' WHERE id=?").run(p.id);this.set(id,"removed");return;}
    if(recovery && ["removing","unknown"].includes(op.status)){this.set(id,"unknown",{error:"Removal has not been confirmed. Check Cloudflare again; this extension will not repeat an uncertain delete."});return;}
    const snapshot={identity:identity(project),domains:[...(project.domains||[])].sort(),deployments:(await cf.deployments(p.project)).map(d=>d.id).sort()};
    if(JSON.stringify(snapshot)!==op.snapshot){this.set(id,"failed",{error:"The project changed after review. Prepare removal again."});return;}
    this.set(id,"removing");effect=true;await cf.remove(p.project);
    if(await cf.getProject(p.project)){this.set(id,"unknown",{error:"Cloudflare still reports this project. Check again."});return;}
    this.db.prepare("UPDATE publications SET status='removed' WHERE id=?").run(p.id);this.set(id,"removed");return;
   }
   if(op.action==="rollback") {
    if(!project)throw new RemoteError("The remote project is missing.",409);
    if(recovery){await this.finish(cf,p,op,op.deployment);return;}
    const snapshot=JSON.parse(op.snapshot);
    if(project.canonical_deployment?.id!==snapshot.canonical){this.set(id,"failed",{error:"The production version changed after review. Prepare restore again."});return;}
    this.set(id,"rolling-back");effect=true;await cf.rollback(p.project,op.deployment);await this.finish(cf,p,op,op.deployment);return;
   }
   if(recovery && ["deploying","verifying","unknown"].includes(op.status) && p.identity) {
    if(op.deployment){await this.finish(cf,p,op,op.deployment);return;}
    const found=(await cf.deployments(p.project)).filter(d=>d.deployment_trigger?.metadata?.commit_message===`picode:${id}:${op.digest}`);
    if(found.length===1){this.set(id,"verifying",{deployment:found[0].id});await this.finish(cf,p,op,found[0].id);return;}
    this.set(id,"unknown",{error:"The deployment result is uncertain. Check again; no second deployment was created."});return;
   }
   const bundle=await this.bundle(p.artifact_id,op.version);
   if(bundle.digest!==op.digest)throw new RemoteError("The prepared package changed. Prepare publication again.",409);
   if(!p.identity) {
    if(recovery && ["creating","unknown"].includes(op.status)) {
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
   this.set(id,"uploading");effect=false;
   const form=await cf.deploy(p.project,bundle,`picode:${id}:${op.digest}`,()=>void this.event());
   if(op.snapshot) { const reviewed=JSON.parse(op.snapshot);const current=await this.checkProject(cf,p);if(current?.canonical_deployment?.id!==reviewed.canonical)throw new RemoteError("The production version changed after review. Prepare publication again.",409); }
   this.set(id,"deploying");effect=true;
   const d=await cf.createDeployment(p.project,form);
   if(!d?.id)throw new RemoteError("Cloudflare did not identify the deployment.");
   this.set(id,"verifying",{deployment:d.id});op=this.op(id);await this.finish(cf,p,op,d.id);
  }catch(e){this.set(id,effect && (recovery || !(e instanceof RemoteError && [400,401,403,404,409,422].includes(e.status)))?"unknown":"failed",{error:e instanceof RemoteError?e.message:"The operation could not complete. Check its result."});}
 }
 async tick() {if(this.closing)return;for(const op of this.db.prepare("SELECT id FROM operations WHERE status='verifying'").all())this.launch(op.id,true);}
}
