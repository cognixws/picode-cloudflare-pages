import {test} from "node:test";
import assert from "node:assert/strict";
import {RemoteError} from "../cloudflare.mjs";
import {fixture} from "./fixture.mjs";

async function published(f,analytics=true){
 const op=await f.service.prepare({artifactId:"a1",version:1,analytics});await f.confirm(op);
 return f.service.pub(op.publication_id);
}
test("a rename publishes the current version to the new address and removes the old project",async t=>{
 const f=fixture(t),s=f.service,p=await published(f);
 const change=await s.prepare({action:"rename",publicationId:p.id,projectName:"renamed-report"});
 assert.match(change.confirmation.message,/renamed-report\.pages\.dev/);
 assert.match(change.confirmation.message,new RegExp(p.project.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\.pages\\.dev"));
 assert.equal(change.confirmation.danger,true);
 await f.confirm(change);
 assert.equal(s.op(change.id).status,"renamed");
 const after=s.pub(p.id);
 assert.equal(after.project,"renamed-report");
 assert.match(after.url,/renamed-report\.pages\.dev/);
 assert.equal(after.version,1);
 assert.ok(after.analytics_tag);
 assert.equal(f.projects.has("renamed-report"),true);
 assert.equal(f.projects.has(p.project),false);
 assert.equal(f.projects.get("renamed-report").build_config.web_analytics_tag,after.analytics_tag);
 assert.equal(f.rumSites.size,1);
 assert.ok(f.rumSites.has("renamed-report.pages.dev"));
 assert.equal((await s.state()).publications[0].history.length,2);
});
test("restricted sites and names already in use are refused before any effect",async t=>{
 const f=fixture(t),s=f.service,p=await published(f);
 s.db.prepare("UPDATE publications SET access_mode='restricted' WHERE id=?").run(p.id);
 await assert.rejects(s.prepare({action:"rename",publicationId:p.id,projectName:"renamed-report"}),/restricted/i);
 s.db.prepare("UPDATE publications SET access_mode='public' WHERE id=?").run(p.id);
 await assert.rejects(s.prepare({action:"rename",publicationId:p.id,projectName:"picode-Report"}),/lowercase/);
 await assert.rejects(s.prepare({action:"rename",publicationId:p.id,projectName:p.project}),/different/);
 f.projects.set("taken",{id:"other",name:"taken",created_on:new Date().toISOString(),production_branch:"main",subdomain:"taken.pages.dev",domains:[],build_config:{}});
 await assert.rejects(s.prepare({action:"rename",publicationId:p.id,projectName:"taken"}),/already in use/);
 assert.equal(s.pub(p.id).project,p.project);
});
test("a lost creation response adopts the fresh project and completes",async t=>{
 const f=fixture(t),s=f.service,p=await published(f),orig=f.remote.createProject;
 f.remote.createProject=async name=>{await orig(name);throw new RemoteError("response lost");};
 const change=await s.prepare({action:"rename",publicationId:p.id,projectName:"renamed-report"});
 await f.confirm(change);
 assert.equal(s.op(change.id).status,"unknown");
 await s.recover();await f.settle();
 assert.equal(s.op(change.id).status,"renamed");
 assert.equal(s.pub(p.id).project,"renamed-report");
 // One create from the first publish, one from the rename attempt.
 assert.equal(f.calls.filter(c=>c==="create").length,2);
});
test("an uncertain old-project delete is held and never repeated",async t=>{
 const f=fixture(t),s=f.service,p=await published(f),orig=f.remote.remove;
 let lost=true;
 f.remote.remove=async name=>{await orig(name);if(lost){lost=false;throw new RemoteError("response lost");}};
 const change=await s.prepare({action:"rename",publicationId:p.id,projectName:"renamed-report"});
 await f.confirm(change);
 assert.equal(s.op(change.id).status,"unknown");
 assert.equal(s.pub(p.id).project,"renamed-report");
 assert.equal(f.projects.has(p.project),false);
 f.service.reconcile(change.id);await f.settle();
 assert.equal(s.op(change.id).status,"renamed");
 assert.equal(f.calls.filter(c=>c==="remove").length,1);
});
test("a failing old-project delete is held with the old site in place",async t=>{
 const f=fixture(t),s=f.service,p=await published(f);
 f.remote.remove=async()=>{throw new RemoteError("Cloudflare refused the request (HTTP 500).");};
 const change=await s.prepare({action:"rename",publicationId:p.id,projectName:"renamed-report"});
 await f.confirm(change);
 assert.equal(s.op(change.id).status,"unknown");
 f.service.reconcile(change.id);await f.settle();
 assert.equal(s.op(change.id).status,"unknown");
 assert.match(s.op(change.id).error,/not been confirmed removed/);
 assert.equal(f.projects.has(p.project),true);
 // A held delete is never repeated; removal done elsewhere settles by absence.
 f.projects.delete(p.project);
 f.service.reconcile(change.id);await f.settle();
 assert.equal(s.op(change.id).status,"renamed");
 assert.equal(f.projects.has(p.project),false);
 assert.equal(f.calls.filter(c=>c==="remove").length,0);
});
test("a failed new deployment retains the old site",async t=>{
 const f=fixture(t),s=f.service,p=await published(f);
 const change=await s.prepare({action:"rename",publicationId:p.id,projectName:"renamed-report"});
 f.remote.createDeployment=async()=>{throw new RemoteError("boom",500);};
 await f.confirm(change);
 assert.equal(s.op(change.id).status,"unknown");
 assert.equal(s.pub(p.id).project,p.project);
 assert.equal(f.projects.has("renamed-report"),true);
});
test("a production version change after review refuses the address change",async t=>{
 const f=fixture(t),s=f.service,p=await published(f);
 const change=await s.prepare({action:"rename",publicationId:p.id,projectName:"renamed-report"});
 f.projects.get(p.project).canonical_deployment={id:"moved"};
 await f.confirm(change);
 assert.equal(s.op(change.id).status,"failed");
 assert.match(s.op(change.id).error,/changed after review/);
 assert.equal(s.pub(p.id).project,p.project);
});
test("a rename whose new deployment activates late waits in verifying and completes via tick",async t=>{
 const f=fixture(t),s=f.service,p=await published(f);
 const orig=f.remote.createDeployment;
 f.remote.createDeployment=async(name,form)=>{
  const d=await orig(name,form);
  f.deployments.get(d.id).latest_stage={status:"queued"};
  return d;
 };
 const change=await s.prepare({action:"rename",publicationId:p.id,projectName:"renamed-report"});
 await f.confirm(change);
 assert.equal(s.op(change.id).status,"verifying");
 assert.equal(s.pub(p.id).project,p.project);
 const d=[...f.deployments.values()].find(x=>x.name==="renamed-report"||x.url.includes("renamed-report"));
 d.latest_stage={status:"success"};
 s.tick();await f.settle();
 assert.equal(s.op(change.id).status,"renamed");
 assert.equal(s.pub(p.id).project,"renamed-report");
 assert.equal(f.projects.has(p.project),false);
});
