import {test} from "node:test";
import assert from "node:assert/strict";
import {Cloudflare,RemoteError,assetHash} from "./cloudflare.mjs";

import {fixture} from "./test/fixture.mjs";

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
