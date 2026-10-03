import { createRequire } from "node:module";
import { extname } from "node:path";
const require = createRequire(import.meta.url);
const { hash } = require("./vendor/blake3-wasm/dist/node/index.js");

export class RemoteError extends Error {
 constructor(message, status = 502) { super(message); this.status = status; }
}
export function assetHash(file) {
 return hash(file.data + extname(file.path).substring(1)).toString("hex").slice(0,32);
}

// Transport is injected only in tests. Production fixes HTTPS/API origin and
// refuses redirects, so a credential never follows a different destination.
export class Cloudflare {
 constructor(account, token, transport = fetch) {
  if (!/^[a-fA-F0-9]{32}$/.test(account) || !token) throw new RemoteError("Configure the Cloudflare account and API token.",409);
  this.account=account;this.token=token;this.transport=transport;
 }
 projectPath(project) { return `/accounts/${this.account}/pages/projects/${encodeURIComponent(project)}`; }
 async call(path, {method="GET",body,token=this.token}={}) {
  const headers={Authorization:"Bearer "+token};
  if(body && !(body instanceof FormData)) headers["Content-Type"]="application/json";
  let res;
  try { res=await this.transport("https://api.cloudflare.com/client/v4"+path,{method,body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body),headers,redirect:"error",signal:AbortSignal.timeout(30_000)}); }
  catch { throw new RemoteError("Cloudflare did not confirm the request. Check the operation before retrying."); }
  let data;try{data=await res.json();}catch{throw new RemoteError("Cloudflare returned an unreadable response.");}
  if(!res.ok || data.success===false) {
   // Do not reflect provider messages: they may echo request data or tokens.
   const message=res.status===401||res.status===403?"Cloudflare refused the token. Check its account and Pages Edit permission.":res.status===429?"Cloudflare is busy. Check the operation again shortly.":res.status===404?"The Cloudflare resource was not found.":"Cloudflare refused the request (HTTP "+res.status+").";
   throw new RemoteError(message,res.status);
  }
  return data;
 }
 async getProject(name) { try{return (await this.call(this.projectPath(name))).result;}catch(e){if(e.status===404)return null;throw e;} }
 async createProject(name) {return (await this.call(`/accounts/${this.account}/pages/projects`,{method:"POST",body:{name,production_branch:"main"}})).result;}
 async deployments(name) {
  const all=[];
  for(let page=1;page<=100;page++) {
   const r=await this.call(this.projectPath(name)+`/deployments?per_page=100&page=${page}`);
   const list=r.result||[];all.push(...list);
   if(list.length<100 || (r.result_info?.total_pages && page>=r.result_info.total_pages))return all;
  }
  throw new RemoteError("Too many deployments to review safely. Open Cloudflare to review this project.",409);
 }
 async deployment(name,id) {return (await this.call(this.projectPath(name)+"/deployments/"+encodeURIComponent(id))).result;}
 async deploy(name,bundle,marker,onProgress=()=>{}) {
  const jwt=(await this.call(this.projectPath(name)+"/upload-token")).result?.jwt;
  if(!jwt)throw new RemoteError("Cloudflare did not issue an upload token.");
  const files=bundle.files.filter(f=>f.path!=="_headers");
  const hashes=new Map(files.map(f=>[assetHash(f),f]));
  const missing=(await this.call("/pages/assets/check-missing",{method:"POST",token:jwt,body:{hashes:[...hashes.keys()]}})).result;
  if(!Array.isArray(missing))throw new RemoteError("Cloudflare returned an invalid asset list.");
  for(const key of missing) {
   const f=hashes.get(key);if(!f)throw new RemoteError("Cloudflare requested an unknown asset.");
   await this.call("/pages/assets/upload",{method:"POST",token:jwt,body:[{key,value:f.data,metadata:{contentType:f.mime},base64:true}]});
   onProgress();
  }
  await this.call("/pages/assets/upsert-hashes",{method:"POST",token:jwt,body:{hashes:[...hashes.keys()]}});
  const form=new FormData();form.set("branch","main");form.set("commit_message",marker);
  form.set("manifest",JSON.stringify(Object.fromEntries(files.map(f=>["/"+f.path,assetHash(f)]))));
  const headers=bundle.files.find(f=>f.path==="_headers");
  if(headers)form.set("_headers",new Blob([Buffer.from(headers.data,"base64")]),"_headers");
  return form;
 }
 async createDeployment(name,form) {return (await this.call(this.projectPath(name)+"/deployments",{method:"POST",body:form})).result;}
 async rollback(name,id) {return (await this.call(this.projectPath(name)+"/deployments/"+encodeURIComponent(id)+"/rollback",{method:"POST"})).result;}
 async remove(name) {await this.call(this.projectPath(name),{method:"DELETE"});}
}
