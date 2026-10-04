import {createHash,randomUUID} from 'node:crypto';
import {RemoteError} from './cloudflare.mjs';

export function accessConfig(value={mode:'public',emails:[]}) {
 if(!value||!['public','restricted'].includes(value.mode))throw new RemoteError('Choose Public or Restricted access.',400);
 if(value.mode==='public')return {mode:'public',emails:[]};
 if(!Array.isArray(value.emails)||!value.emails.length||value.emails.length>50)throw new RemoteError('Enter between 1 and 50 allowed email addresses.',400);
 const emails=[...new Set(value.emails.map(e=>typeof e==='string'?e.trim().toLowerCase():''))].sort();
 if(emails.some(e=>e.length>254||! /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(e)))throw new RemoteError('Enter valid email addresses, separated by commas.',400);
 return {mode:'restricted',emails};
}
export const accessHash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function accessHosts(p,project) {
 const root=p.project+'.pages.dev';
 if(project?.subdomain&&project.subdomain!==root)throw new RemoteError('The project hostname changed. Review Cloudflare.',409);
 const hosts=[root,'*.'+root,...(project?.domains||[])];
 if(hosts.some(h=>typeof h!=='string'||! /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(h)||h.length>253||/\.localhost$/i.test(h)))throw new RemoteError('The project has an unsupported hostname. Review Cloudflare.',409);
 return [...new Set(hosts.map(h=>h.toLowerCase()))].sort();
}
function appShape(app,policies) {
 return {session:app.session_duration,legacy:[...(app.self_hosted_domains||[])].sort(),id:app.id,name:app.name,type:app.type,domain:app.domain,hosts:(app.destinations||[]).map(d=>({type:d.type,uri:d.uri,overrides:d.overrides||[]})).sort((a,b)=>(a.uri<b.uri?-1:a.uri>b.uri?1:0)),idps:[...(app.allowed_idps||[])].sort(),warp:!!app.allow_authenticate_via_warp,preflight:!!app.options_preflight_bypass,skip:!!app.skip_interstitial,service:app.read_service_tokens_from_header||'',policies:policies.map(p=>({id:p.id,name:p.name,decision:p.decision,include:p.include,exclude:p.exclude||[],require:p.require||[]})).sort((a,b)=>String(a.id).localeCompare(String(b.id)))};
}
function appHostnames(app) {return [app.domain,...(app.destinations||[]).map(d=>d.uri),...(app.self_hosted_domains||[])].filter(x=>typeof x==='string').map(x=>x.split('/')[0].toLowerCase());}
function overlaps(a,b){const plain=x=>x.replace(/^\*\./,'');return a===b||(a.startsWith('*.')&&(plain(b)===plain(a)||plain(b).endsWith('.'+plain(a))))||(b.startsWith('*.')&&(plain(a)===plain(b)||plain(a).endsWith('.'+plain(b))));}

// Resource ownership and lost-response holds are durable. Access uses its own
// encrypted token, never the Pages upload token. No public site is auto-adopted.
export class PublicationAccess {
 constructor({db,remote,configuration}) {this.db=db;this.remote=remote;this.configuration=configuration;}
 async client(p) {
  const c=await this.configuration();
  if(c.account!==p.account_id)throw new RemoteError('This site belongs to another Cloudflare account.',409);
  if(!c.accessToken)throw new RemoteError('Configure the Access API token in Connection settings to use Restricted access.',409);
  return this.remote(c.account,c.accessToken);
 }
 async setup(p) {
  const cf=await this.client(p);let org;try{org=(await cf.call(`/accounts/${p.account_id}/access/organizations`)).result;}catch(e){if(e.status===404)throw new RemoteError('Set up Cloudflare Zero Trust before using Restricted access.',409);throw e;}
  if(!org?.auth_domain||! /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(org.auth_domain))throw new RemoteError('Set up Cloudflare Zero Trust before using Restricted access.',409);
  const providers=(await cf.call(`/accounts/${p.account_id}/access/identity_providers`)).result;
  if(!Array.isArray(providers))throw new RemoteError('Cloudflare returned an invalid login-method list.');
  const otp=providers.find(p=>p.type==='onetimepin'&&p.id);
  if(!otp)throw new RemoteError('Enable One-time PIN in Cloudflare Zero Trust, then check restricted access again.',409);
  return {cf,authDomain:org.auth_domain,otp:otp.id};
 }
 path(p,id=p.access_app){return `/accounts/${p.account_id}/access/apps`+(id?'/'+encodeURIComponent(id):'');}
 async list(cf,p){const all=[];for(let page=1;page<=100;page++){const r=await cf.call(this.path(p,null)+`?per_page=100&page=${page}`);if(!Array.isArray(r.result))throw new RemoteError('Cloudflare returned an invalid Access application list.');all.push(...r.result);if(r.result.length<100||r.result_info?.total_pages&&page>=r.result_info.total_pages)return all;}throw new RemoteError('Too many Access applications to review safely.',409);}
 async read(cf,p){if(!p.access_app)return null;let app;try{app=(await cf.call(this.path(p))).result;}catch(e){if(e.status===404)return null;throw e;}
  const r=await cf.call(this.path(p)+'/policies?per_page=100');
  if(app?.id!==p.access_app||!Array.isArray(r.result)||r.result.length>=100)throw new RemoteError('Cloudflare returned an invalid Access policy.');
  return {app,policies:r.result,shape:appShape(app,r.result)};
 }
 name(p){return 'PiCode Pages '+p.id;}
 async snapshot(p) {
  if(!p.access_app&&!p.access_attempt)return null;
  const cf=await this.client(p),r=await this.read(cf,p);
  if(!r||r.app.name!==this.name(p)||!p.access_fingerprint||accessHash(r.shape)!==p.access_fingerprint)throw new RemoteError('The managed Access policy changed or is missing. Review Cloudflare before continuing.',409);
  return r.shape;
 }
 body(p,hosts,otp){return {name:this.name(p),type:'self_hosted',domain:p.project+'.pages.dev',destinations:hosts.map(uri=>({type:'public',uri})),allowed_idps:[otp],session_duration:'24h',allow_authenticate_via_warp:false,options_preflight_bypass:false,skip_interstitial:false,app_launcher_visible:false};}
 policy(config){return {name:'PiCode allowed readers',decision:'allow',include:config.emails.map(email=>({email:{email}})),exclude:[],require:[]};}
 matches(r,p,config,hosts,otp){const expected=this.body(p,hosts,otp),shape=r?.shape;
  if(!shape||shape.id!==p.access_app||shape.session!=='24h'||shape.legacy.some(h=>!hosts.includes(h))||shape.name!==expected.name||shape.type!=='self_hosted'||shape.domain!==expected.domain||shape.warp||shape.preflight||shape.skip||shape.service||JSON.stringify(shape.idps)!==JSON.stringify([otp])||JSON.stringify(shape.hosts)!==JSON.stringify(hosts.map(uri=>({type:'public',uri,overrides:[]})))||shape.policies.length!==1)return false;
  const policy=shape.policies[0],want=this.policy(config);
  return policy.decision==='allow'&&policy.name===want.name&&!policy.exclude.length&&!policy.require.length&&JSON.stringify([...policy.include].sort((a,b)=>(JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0)))===JSON.stringify(want.include);
 }
 async conflicts(cf,p,hosts){const list=await this.list(cf,p);if(list.some(app=>app.id!==p.access_app&&appHostnames(app).some(a=>hosts.some(b=>overlaps(a,b)))))throw new RemoteError('Another Access application covers this site. Review Cloudflare; existing policies will not be replaced.',409);}
 async anonymous(cf,hostname,authDomain){const target=hostname.startsWith('*.')?randomUUID().replaceAll('-','')+'.'+hostname.slice(2):hostname;
  let res;try{res=await cf.transport('https://'+target+'/',{method:'GET',redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(15_000)});}catch{throw new RemoteError('Access protection could not be verified. Check the result before publishing.');}
  let location;try{location=new URL(res.headers.get('location'));}catch{}
  if(![302,303,307,308].includes(res.status)||location?.protocol!=='https:'||location?.hostname!==authDomain||!/^\/cdn-cgi\/access\/login(?:\/|$)/.test(location.pathname)||location.username||location.password)throw new RemoteError('Access protection is not active on '+target+'. Check the result after Cloudflare has applied the policy.',409);
 }
 async ensure(p,config,project,reviewed,recovery=false) {
  const {cf,authDomain,otp}=await this.setup(p),hosts=accessHosts(p,project);await this.conflicts(cf,p,hosts);
  let r=await this.read(cf,p);
  if(r&&reviewed&&!recovery&&accessHash(r.shape)!==accessHash(reviewed))throw new RemoteError('The Access policy changed after review. Prepare again.',409);
  if(r&&!this.matches(r,p,config,hosts,otp)){
   if(!reviewed||accessHash(r.shape)!==accessHash(reviewed))throw new RemoteError('The Access policy changed after review. Prepare the access change again.',409);
   // Update only the owned policy and app. Reconciliation never repeats an
   // uncertain write; it reads the desired configuration instead.
   if(recovery)throw new RemoteError('Access change is uncertain. Review Cloudflare; no write was repeated.',409);
   await cf.call(this.path(p)+'/policies/'+encodeURIComponent(r.policies[0].id),{method:'PUT',body:this.policy(config)});
   await cf.call(this.path(p),{method:'PUT',body:this.body(p,hosts,otp)});
   r=await this.read(cf,p);
  }else if(!r){
   if(p.access_app||p.access_attempt)throw new RemoteError('Access creation is uncertain or its managed application is missing. Review Cloudflare; no application was recreated.',409);
   this.db.prepare('UPDATE publications SET access_attempt=? WHERE id=?').run(randomUUID(),p.id);
   const app=(await cf.call(this.path(p,null),{method:'POST',body:{...this.body(p,hosts,otp),policies:[this.policy(config)]}})).result;
   if(!app?.id)throw new RemoteError('Cloudflare did not identify the Access application.');
   this.db.prepare('UPDATE publications SET access_app=?,access_attempt=NULL WHERE id=?').run(app.id,p.id);p={...p,access_app:app.id};r=await this.read(cf,p);
  }
  if(!this.matches(r,p,config,hosts,otp))throw new RemoteError('Cloudflare has not confirmed the requested restricted policy. Check the result.',409);
  // Revocation is idempotent and closes sessions of removed readers. Retrying
  // it only reduces access, unlike recreating an uncertain resource.
  if(reviewed&&JSON.stringify(reviewed.policies)!==JSON.stringify(r.shape.policies))await cf.call(this.path(p)+'/revoke_tokens',{method:'POST'});
  this.db.prepare('UPDATE publications SET access_fingerprint=? WHERE id=?').run(accessHash(r.shape),p.id);
  for(const hostname of hosts)await this.anonymous(cf,hostname,authDomain);
  return {hosts,authDomain};
 }
 async verify(p,config,project,urls=[]) {
  const {cf,authDomain,otp}=await this.setup(p),hosts=accessHosts(p,project),r=await this.read(cf,p);
  await this.conflicts(cf,p,hosts);
  if(!this.matches(r,p,config,hosts,otp)||!p.access_fingerprint||accessHash(r.shape)!==p.access_fingerprint)throw new RemoteError('Restricted access changed or is missing. Review Cloudflare before continuing.',409);
  const extra=urls.map(raw=>{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||!hosts.some(h=>overlaps(h,u.hostname)))throw new RemoteError('Cloudflare returned an unexpected deployment URL.',409);return u.hostname});
  for(const hostname of [...new Set([...hosts,...extra])])await this.anonymous(cf,hostname,authDomain);
 }
 async verifyPublic(cf,p,project){
  const hosts=accessHosts(p,project).filter(h=>!h.startsWith('*.'));
  for(const d of await cf.deployments(p.project)){const u=new URL(d.url);if(u.protocol!=='https:'||u.username||u.password||!accessHosts(p,project).some(h=>overlaps(h,u.hostname)))throw new RemoteError('Unexpected deployment URL.',409);hosts.push(u.hostname);}
  for(const hostname of new Set(hosts)){let r;try{r=await cf.transport('https://'+hostname+'/',{method:'GET',redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(15_000)});}catch{throw new RemoteError('Public access could not be verified. Check the result.');}if(r.status!==200)throw new RemoteError('Public access is not confirmed on '+hostname+'. Check the result after Cloudflare applies the change.',409);}
 }
 async remove(p,reviewed,recovery=false){if(!p.access_app){if(p.access_attempt)throw new RemoteError('An uncertain Access application needs manual review.',409);return;}
  const cf=await this.client(p),r=await this.read(cf,p);if(r){if(!reviewed||accessHash(r.shape)!==accessHash(reviewed)||r.app.name!==this.name(p))throw new RemoteError('The Access policy changed after review; it was not removed.',409);if(p.access_delete_attempt)throw new RemoteError('Access removal is uncertain. Review Cloudflare; no delete was repeated.',409);this.db.prepare('UPDATE publications SET access_delete_attempt=1 WHERE id=?').run(p.id);await cf.call(this.path(p),{method:'DELETE'});if(await this.read(cf,p))throw new RemoteError('Access removal has not been confirmed.',409);}
  this.db.prepare('UPDATE publications SET access_app=NULL,access_attempt=NULL,access_fingerprint=NULL,access_verified_at=NULL,access_delete_attempt=0 WHERE id=?').run(p.id);
 }
}
