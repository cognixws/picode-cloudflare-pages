import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {PagesService} from "./service.mjs";
import {Cloudflare,RemoteError,assetHash} from "./cloudflare.mjs";

function fixture(t) {
 const db=new DatabaseSync(":memory:");for(const file of readdirSync(new URL("./migrations/",import.meta.url)).sort())db.exec(readFileSync(new URL("./migrations/"+file,import.meta.url),"utf8"));t.after(()=>db.close());
 const projects=new Map(),deployments=new Map();let next=0;
 const calls=[];const remote={
  getProject:async name=>projects.get(name)||null,
  createProject:async name=>{calls.push("create");const p={id:"p1",name,created_on:new Date().toISOString(),production_branch:"main",subdomain:name+".pages.dev",domains:[]};projects.set(name,p);return p;},
  deploy:async(name,bundle,marker)=>({marker}),
  createDeployment:async(name,form)=>{calls.push("deploy");const d={id:"d"+(++next),environment:"production",latest_stage:{status:"success"},url:"https://d"+next+"."+name+".pages.dev",deployment_trigger:{metadata:{commit_message:form.marker}}};deployments.set(d.id,d);projects.get(name).canonical_deployment=d;return d;},
  deployments:async()=>[...deployments.values()],deployment:async(name,id)=>{const d=deployments.get(id);if(!d)throw new RemoteError("missing",404);return d;},
  rollback:async(name,id)=>{calls.push("rollback");projects.get(name).canonical_deployment=deployments.get(id);},
  remove:async name=>{calls.push("remove");projects.delete(name);deployments.clear();}
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
 return {service,remote,projects,deployments,calls,settle,confirm,setAccount:v=>account=v,setAvailable:v=>available=v,bundles};
}

test("publish, unchanged, update and rollback keep exact version/deployment history",async t=>{
 const f=fixture(t),s=f.service;
 const op=await s.prepare({artifactId:"a1",version:1});assert.equal(f.calls.length,0);
 await assert.rejects(s.confirm(op.id,"0".repeat(64)),/changed/);
 await assert.rejects(s.prepare({artifactId:"a1",version:2}),/current operation/);
 assert.equal((await f.confirm(op)).status,"published");
 const p=s.pub(op.publication_id);assert.equal(p.version,1);assert.match(p.url,/pages.dev/);
 assert.equal((await s.prepare({artifactId:"a1",version:1})).unchanged,true);
 const update=await s.prepare({artifactId:"a1",version:2});await f.confirm(update);assert.equal(s.pub(p.id).version,2);
 const rollback=await s.prepare({action:"rollback",publicationId:p.id,deployment:p.deployment});await f.confirm(rollback);assert.equal(s.pub(p.id).version,1);
 assert.equal((await s.state()).publications[0].history.length,2);
});
test("decline cancels a prepared operation and creates nothing remotely",async t=>{
 const f=fixture(t),op=await f.service.prepare({artifactId:"a1",version:1});f.service.cancel(op.id);
 assert.equal(f.service.op(op.id).status,"cancelled");assert.equal(f.calls.length,0);
 await assert.rejects(f.service.confirm(op.id,op.revision),/changed/);
});
test("a lost deployment response is reconciled by marker without repeating the effect",async t=>{
 const f=fixture(t),orig=f.remote.createDeployment;
 f.remote.createDeployment=async(...args)=>{await orig(...args);throw new RemoteError("response lost");};
 const op=await f.service.prepare({artifactId:"a1",version:1});await f.confirm(op);assert.equal(f.service.op(op.id).status,"unknown");
 await assert.rejects(f.service.prepare({artifactId:"a1",version:2}),/current operation/);
 f.service.reconcile(op.id);await f.settle();assert.equal(f.service.op(op.id).status,"published");assert.equal(f.calls.filter(c=>c==="deploy").length,1);
});
test("restart settles project creation before resuming upload",async t=>{
 const f=fixture(t),orig=f.remote.createProject;
 f.remote.createProject=async(...args)=>{await orig(...args);throw new RemoteError("response lost");};
 const op=await f.service.prepare({artifactId:"a1",version:1});await f.confirm(op);assert.equal(f.service.op(op.id).status,"unknown");
 await f.service.recover();await f.settle();assert.equal(f.service.op(op.id).status,"published");assert.equal(f.calls.filter(c=>c==="create").length,1);
});
test("uncertain absent deployment is held and never uploaded twice",async t=>{
 const f=fixture(t);f.remote.createDeployment=async()=>{f.calls.push("deploy");throw new RemoteError("request timed out");};
 const op=await f.service.prepare({artifactId:"a1",version:1});await f.confirm(op);f.service.reconcile(op.id);await f.settle();
 assert.equal(f.service.op(op.id).status,"unknown");assert.equal(f.calls.filter(c=>c==="deploy").length,1);
});
test("failed update retains previous publication",async t=>{
 const f=fixture(t),op=await f.service.prepare({artifactId:"a1",version:1});await f.confirm(op);const p=f.service.pub(op.publication_id);
 f.remote.deploy=async()=>{throw new RemoteError("asset upload failed",400);};
 const update=await f.service.prepare({artifactId:"a1",version:2});await f.confirm(update);
 assert.equal(f.service.op(update.id).status,"failed");assert.equal(f.service.pub(p.id).deployment,p.deployment);assert.equal(f.service.pub(p.id).version,1);
});
test("remove reviews custom domains and deployments; changes after review refuse deletion",async t=>{
 const f=fixture(t),op=await f.service.prepare({artifactId:"a1",version:1});await f.confirm(op);const p=f.service.pub(op.publication_id);
 f.projects.get(p.project).domains=["report.example.com"];
 const remove=await f.service.prepare({action:"remove",publicationId:p.id});assert.match(remove.confirmation.message,/report.example.com/);
 f.projects.get(p.project).domains.push("changed.example.com");await f.confirm(remove);
 assert.equal(f.service.op(remove.id).status,"failed");assert.ok(f.projects.has(p.project));assert.equal(f.calls.includes("remove"),false);
 const again=await f.service.prepare({action:"remove",publicationId:p.id});f.setAvailable(false);await f.confirm(again);
 assert.equal(f.service.op(again.id).status,"removed");assert.equal(f.projects.size,0);assert.equal(f.deployments.size,0);
});
test("lost delete response is reconciled with an absent project",async t=>{
 const f=fixture(t),op=await f.service.prepare({artifactId:"a1",version:1});await f.confirm(op);const p=f.service.pub(op.publication_id),orig=f.remote.remove;
 f.remote.remove=async(...args)=>{await orig(...args);throw new RemoteError("response lost");};
 const remove=await f.service.prepare({action:"remove",publicationId:p.id});await f.confirm(remove);assert.equal(f.service.op(remove.id).status,"unknown");
 f.service.reconcile(remove.id);await f.settle();assert.equal(f.service.op(remove.id).status,"removed");assert.equal(f.calls.filter(c=>c==="remove").length,1);
});
test("account change, missing source, changed identity and preview rollback are refused",async t=>{
 const f=fixture(t),op=await f.service.prepare({artifactId:"a1",version:1});await f.confirm(op);const p=f.service.pub(op.publication_id);
 f.setAccount("b".repeat(32));await assert.rejects(f.service.prepare({action:"remove",publicationId:p.id}),/another Cloudflare account/);f.setAccount("a".repeat(32));
 f.deployments.get(p.deployment).environment="preview";await assert.rejects(f.service.prepare({action:"rollback",publicationId:p.id,deployment:p.deployment}),/successful production/);f.deployments.get(p.deployment).environment="production";
 f.projects.get(p.project).id="replacement";await assert.rejects(f.service.prepare({action:"remove",publicationId:p.id}),/identity changed/);f.projects.get(p.project).id="p1";
 f.setAvailable(false);await assert.rejects(f.service.prepare({artifactId:"a1",version:2}),/missing/);
 assert.equal(f.service.pub(p.id).version,1);
});
test("removal permits a later fresh publication of the artifact",async t=>{
 const f=fixture(t),op=await f.service.prepare({artifactId:"a1",version:1});await f.confirm(op);const old=f.service.pub(op.publication_id);
 await f.confirm(await f.service.prepare({action:"remove",publicationId:old.id}));
 await f.confirm(await f.service.prepare({artifactId:"a1",version:2}));
 assert.equal(f.service.pub(old.id).status,"published");assert.notEqual(f.service.pub(old.id).project,old.project);
});
test("Cloudflare adapter uses JWT assets and manifest; token errors are redacted",async()=>{
 const calls=[];const replies=[{jwt:"upload-token"},["key"],{},{}];
 const file={path:"index.html",mime:"text/html",data:Buffer.from("<h1>hi</h1>").toString("base64")};const key=assetHash(file);replies[1]=[key];
 const transport=async(url,opts)=>{calls.push([url,opts]);return new Response(JSON.stringify({success:true,result:replies.shift()}),{status:200});};
 const cf=new Cloudflare("a".repeat(32),"private-token",transport);
 const form=await cf.deploy("report",{files:[file,{path:"_headers",data:Buffer.from("/*\n X-Test: yes").toString("base64")}]},"marker");
 assert.deepEqual(JSON.parse(form.get("manifest")),{"/index.html":key});assert.equal(form.get("commit_message"),"marker");
 assert.equal(calls[0][1].headers.Authorization,"Bearer private-token");assert.equal(calls[1][1].headers.Authorization,"Bearer upload-token");assert.equal(calls[2][1].redirect,"error");
 cf.transport=async()=>new Response(JSON.stringify({success:false,errors:[{message:"private-token"}]}),{status:403});
 await assert.rejects(cf.getProject("report"),e=>e.status===403&&!e.message.includes("private-token"));
});

test("recovery authorization failures preserve an uncertain remote effect",async t=>{
 const f=fixture(t);f.remote.createDeployment=async()=>{f.calls.push("deploy");throw new RemoteError("response lost");};
 const op=await f.service.prepare({artifactId:"a1",version:1});await f.confirm(op);
 f.remote.getProject=async()=>{throw new RemoteError("Access denied",401);};
 f.service.reconcile(op.id);await f.settle();assert.equal(f.service.op(op.id).status,"unknown");
 await assert.rejects(f.service.prepare({artifactId:"a1",version:2}),/current operation/);
 assert.equal(f.calls.filter(c=>c==="deploy").length,1);
});

test("a chosen project name is never adopted after a lost creation response",async t=>{
 const f=fixture(t),original=f.remote.createProject;
 f.remote.createProject=async(...args)=>{await original(...args);throw new RemoteError("response lost");};
 const op=await f.service.prepare({artifactId:"a1",version:1,projectName:"chosen-report"});await f.confirm(op);
 await f.service.recover();await f.settle();assert.equal(f.service.op(op.id).status,"unknown");
 assert.match(f.service.op(op.id).error,/no project was adopted/);assert.deepEqual(f.calls,["create"]);
});
