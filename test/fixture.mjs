import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {PagesService} from "../service.mjs";
import {RemoteError} from "../cloudflare.mjs";

export function fixture(t) {
 const db=new DatabaseSync(":memory:");for(const file of readdirSync(new URL("../migrations/",import.meta.url)).sort())db.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));t.after(()=>db.close());
 const projects=new Map(),deployments=new Map(),rumSites=new Map();let next=0,rumNext=0;
 const calls=[];const remote={
  getProject:async name=>projects.get(name)||null,
  createProject:async name=>{calls.push("create");const p={id:"p1",name,created_on:new Date().toISOString(),production_branch:"main",subdomain:name+".pages.dev",domains:[],build_config:{}};projects.set(name,p);return p;},
  deploy:async(name,bundle,marker)=>({marker}),
  createDeployment:async(name,form)=>{calls.push("deploy");const d={id:"d"+(++next),environment:"production",latest_stage:{status:"success"},url:"https://d"+next+"."+name+".pages.dev",deployment_trigger:{metadata:{commit_message:form.marker}}};deployments.set(d.id,d);projects.get(name).canonical_deployment=d;return d;},
  deployments:async()=>[...deployments.values()],deployment:async(name,id)=>{const d=deployments.get(id);if(!d)throw new RemoteError("missing",404);return d;},
  rollback:async(name,id)=>{calls.push("rollback");projects.get(name).canonical_deployment=deployments.get(id);},
  remove:async name=>{calls.push("remove");projects.delete(name);deployments.clear();},
  rumSites:async()=>[...rumSites.values()],
  createRumSite:async host=>{calls.push("rum-create");const s={site_tag:"tag"+(++rumNext),site_token:"token"+rumNext,host};rumSites.set(host,s);return s;},
  deleteRumSite:async tag=>{calls.push("rum-delete");for(const [host,site] of rumSites)if(site.site_tag===tag){rumSites.delete(host);return;}},
  setAnalytics:async(name,build_config)=>{calls.push("analytics-patch");const p=projects.get(name);if(!p)throw new RemoteError("missing",404);p.build_config=build_config;return p;}
 };
 let account="a".repeat(32),available=true;
 const bundles=new Map([[1,{artifactId:"a1",version:1,digest:"1".repeat(64),files:[]}],[2,{artifactId:"a1",version:2,digest:"2".repeat(64),files:[]}]]);
 const host=async path=>{
  if(path==="/settings")return {values:{account_id:account},secrets:{api_token:"private-token"}};
  if(path==="/artifacts")return {artifacts:available?[{id:"a1",title:"Report",kind:"page",liveVersion:2}]:[]};
  if(!available)throw new RemoteError("The artifact is missing.",404);
  if(path==="/artifacts/a1")return {artifact:{id:"a1",title:"Report",liveVersion:2},versions:[{n:2},{n:1}]};
  return structuredClone(bundles.get(Number(path.split("/")[4])));
 };
 const service=new PagesService({db,host,remote:()=>remote});
 const settle=async()=>{for(let i=0;i<500 && service.running.size;i++)await new Promise(r=>setTimeout(r,1));assert.equal(service.running.size,0);};
 const confirm=async op=>{await service.confirm(op.id,op.revision);await settle();return service.op(op.id);};
 return {service,remote,projects,deployments,rumSites,calls,settle,confirm,setAccount:v=>account=v,setAvailable:v=>available=v,bundles};
}
