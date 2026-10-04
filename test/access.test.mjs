import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {accessConfig,accessHosts} from '../access.mjs';
import {RemoteError} from '../cloudflare.mjs';

const restricted={mode:'restricted',emails:['owner@example.com']};
function setup(t){
 const f=fixture(t),s=f.service,apps=new Map(),api=[],probes=[];let token='access-secret',otp=true,org=true,protectedEdge=true;
 const host=s.host;s.host=async(path,...args)=>{const r=await host(path,...args);if(path==='/settings')r.secrets.access_api_token=token;return r};
 const upload=f.remote.deploy;f.remote.deploy=async(...args)=>{api.push('UPLOAD');return upload(...args)};
 f.remote.call=async(path,options={})=>{
  const method=options.method||'GET';api.push(method+' '+path);
  if(path.endsWith('/organizations'))return {result:org?{auth_domain:'team.cloudflareaccess.com'}:{}};
  if(path.endsWith('/identity_providers'))return {result:otp?[{type:'onetimepin',id:'otp-id'}]:[]};
  const suffix=path.split('/access/apps')[1],id=suffix.split('/')[1],app=apps.get(id);
  if(suffix.startsWith('?'))return {result:[...apps.values()].map(a=>structuredClone(a))};
  if(method==='POST'&&suffix===''){const a={...structuredClone(options.body),id:'app-'+(apps.size+1)};a.policies=a.policies.map((p,i)=>({...p,id:'policy-'+i}));apps.set(a.id,a);return {result:structuredClone(a)}}
  if(!app)throw new RemoteError('Not found',404);
  if(suffix.endsWith('/revoke_tokens'))return {result:{}};
  if(suffix.includes('/policies/')){app.policies=[{...structuredClone(options.body),id:app.policies[0].id}];return {result:app.policies[0]}}
  if(suffix.includes('/policies?'))return {result:structuredClone(app.policies)};
  if(method==='PUT'){Object.assign(app,structuredClone(options.body));return {result:structuredClone(app)}}
  if(method==='DELETE'){apps.delete(id);return {result:{}}}
  return {result:structuredClone(app)};
 };
 f.remote.transport=async(url,opts)=>{probes.push({url,opts});const covered=[...apps.values()].some(a=>a.destinations.some(d=>new URL(url).hostname===d.uri||d.uri.startsWith('*.')&&new URL(url).hostname.endsWith(d.uri.slice(1))));return protectedEdge&&covered?new Response(null,{status:302,headers:{location:'https://team.cloudflareaccess.com/cdn-cgi/access/login/site'}}):new Response('page',{status:200})};
 return {...f,s,apps,api,probes,setToken:x=>token=x,setOTP:x=>otp=x,setOrg:x=>org=x,setEdge:x=>protectedEdge=x};
}
async function publish(f,access=restricted){const op=await f.s.prepare({artifactId:'a1',version:1,access});assert.equal((await f.confirm(op)).status,'published');return f.s.pub(op.publication_id)}

test('access configuration normalizes exact emails and rejects empty/malformed/oversized lists',()=>{
 assert.deepEqual(accessConfig({mode:'restricted',emails:[' A@Example.com ','a@example.com']}),{mode:'restricted',emails:['a@example.com']});
 for(const emails of [[],['everyone'],['a@b.c,other@b.c'],Array(51).fill('a@b.c')])assert.throws(()=>accessConfig({mode:'restricted',emails}));
 assert.throws(()=>accessConfig({mode:'link-only'}));assert.deepEqual(accessConfig(),{mode:'public',emails:[]});
 assert.deepEqual(accessHosts({project:'report'},{domains:['custom.example.com','report.pages.dev']}),['*.report.pages.dev','custom.example.com','report.pages.dev']);
 assert.throws(()=>accessHosts({project:'report'},{subdomain:'other.pages.dev'}));
});
for(const condition of ['token','OTP','organization'])test('missing '+condition+' refuses Restricted before a remote write',async t=>{
 const f=setup(t);if(condition==='token')f.setToken(null);if(condition==='OTP')f.setOTP(false);if(condition==='organization')f.setOrg(false);
 await assert.rejects(f.s.prepare({artifactId:'a1',version:1,access:restricted}));assert.equal(f.calls.length,0);assert.ok(f.api.every(c=>c.startsWith('GET')));
});
test('Access setup is read-only and does not claim write permission; state omits both secrets',async t=>{
 const f=setup(t);assert.equal((await f.s.checkAccessSetup()).status,'ready');assert.match((await f.s.state()).accessSetup.message,/write permission is required/);assert.ok(f.api.every(c=>c.startsWith('GET')));assert.doesNotMatch(JSON.stringify(await f.s.state()),/access-secret|private-token/);
 f.setToken('rotated');assert.equal((await f.s.state()).accessSetup.status,'unchecked');
});
test('restricted application and anonymous root/wildcard checks precede every upload; old URLs remain checked',async t=>{
 const f=setup(t),p=await publish(f);assert.equal(p.access_mode,'restricted');assert.ok(p.access_verified_at);assert.equal(f.apps.size,1);
 assert.ok(f.api.findIndex(c=>c.startsWith('POST')&&c.endsWith('/access/apps'))<f.api.indexOf('UPLOAD'));
 assert.ok(f.probes.some(x=>new URL(x.url).hostname===p.project+'.pages.dev'));assert.ok(f.probes.some(x=>new URL(x.url).hostname==='d1.'+p.project+'.pages.dev'));
 assert.ok(f.probes.every(x=>x.opts.credentials==='omit'&&!x.opts.headers&&x.opts.redirect==='manual'));
 const update=await f.s.prepare({artifactId:'a1',version:2});await f.confirm(update);assert.equal(f.s.pub(p.id).access_mode,'restricted');assert.equal(f.apps.size,1);
 const restore=await f.s.prepare({action:'rollback',publicationId:p.id,deployment:p.deployment});await f.confirm(restore);assert.equal(f.s.pub(p.id).version,1);assert.equal(f.s.pub(p.id).access_emails,p.access_emails);
});
test('custom domains require explicit coverage and anonymous verification',async t=>{
 const f=setup(t),p=await publish(f,{mode:'public'});f.projects.get(p.project).domains=['custom.example.com'];
 const op=await f.s.prepare({action:'access',publicationId:p.id,access:restricted});assert.match(op.confirmation.message,/custom.example.com/);await f.confirm(op);
 assert.equal(f.s.op(op.id).status,'published');assert.ok([...f.apps.values()][0].destinations.some(d=>d.uri==='custom.example.com'));assert.ok(f.probes.some(x=>x.url==='https://custom.example.com/'));
});
for(const code of [200,404,403])test('anonymous HTTP '+code+' does not certify Restricted or permit upload',async t=>{
 const f=setup(t);f.remote.transport=async()=>new Response(null,{status:code});const op=await f.s.prepare({artifactId:'a1',version:1,access:restricted});await f.confirm(op);
 assert.equal(f.s.op(op.id).status,'unknown');assert.equal(f.api.includes('UPLOAD'),false);assert.equal(f.s.pub(op.publication_id).access_mode,'public');
});
test('existing overlapping/path Access applications are never adopted or overwritten',async t=>{
 const f=setup(t),p=await publish(f,{mode:'public'});f.apps.set('external',{id:'external',domain:p.project+'.pages.dev/private',destinations:[]});
 await assert.rejects(f.s.prepare({action:'access',publicationId:p.id,access:restricted}),/Another Access application/);assert.equal(f.api.filter(c=>c.startsWith('POST')).length,0);
});
test('external bypass, missing app and policy drift refuse update and restore',async t=>{
 const f=setup(t),p=await publish(f),app=f.apps.get(p.access_app);app.policies.push({id:'bypass',decision:'bypass',include:[{everyone:{}}]});
 await assert.rejects(f.s.prepare({artifactId:'a1',version:2}),/changed or is missing/);await assert.rejects(f.s.prepare({action:'rollback',publicationId:p.id,deployment:p.deployment}),/changed or is missing/);
 app.policies.pop();app.destinations[0].overrides=[{uri:'public'}];await assert.rejects(f.s.checkAccess(p.id),/changed or is missing/);
 f.apps.delete(p.access_app);await assert.rejects(f.s.prepare({artifactId:'a1',version:2}),/changed or is missing/);
});
test('changing readers revokes sessions, keeps artifact version and remains independent of restore',async t=>{
 const f=setup(t),p=await publish(f),config={mode:'restricted',emails:['new@example.com']};const op=await f.s.prepare({action:'access',publicationId:p.id,access:config});await f.confirm(op);
 assert.equal(f.s.op(op.id).status,'published');assert.equal(f.s.pub(p.id).version,p.version);assert.equal(f.s.pub(p.id).access_emails,JSON.stringify(config.emails));assert.ok(f.api.some(c=>c.endsWith('/revoke_tokens')));
 await f.confirm(await f.s.prepare({action:'rollback',publicationId:p.id,deployment:p.deployment}));assert.equal(f.s.pub(p.id).access_emails,JSON.stringify(config.emails));
});
test('Public change requires danger confirmation and checks old URLs without deploying',async t=>{
 const f=setup(t),p=await publish(f),n=f.calls.filter(c=>c==='deploy').length;const op=await f.s.prepare({action:'access',publicationId:p.id,access:{mode:'public'}});
 assert.equal(op.confirmation.danger,true);assert.match(op.confirmation.message,/previous deployment URLs/);await f.confirm(op);
 assert.equal(f.s.op(op.id).status,'published');assert.equal(f.s.pub(p.id).access_mode,'public');assert.equal(f.apps.size,0);assert.equal(f.calls.filter(c=>c==='deploy').length,n);
});
test('lost Access creation response holds the site without upload or duplicate application',async t=>{
 const f=setup(t),call=f.remote.call;f.remote.call=async(path,options)=>{const r=await call(path,options);if(options?.method==='POST'&&path.endsWith('/access/apps'))throw new RemoteError('response lost');return r};
 const op=await f.s.prepare({artifactId:'a1',version:1,access:restricted});await f.confirm(op);assert.equal(f.s.op(op.id).status,'unknown');assert.ok(f.s.pub(op.publication_id).access_attempt);
 f.s.reconcile(op.id);await f.settle();assert.equal(f.s.op(op.id).status,'unknown');assert.equal(f.apps.size,1);assert.equal(f.api.includes('UPLOAD'),false);assert.equal(f.api.filter(c=>c.startsWith('POST')&&c.endsWith('/access/apps')).length,1);
});
test('lost reader-update response is read and reconciled without repeating the policy write',async t=>{
 const f=setup(t),p=await publish(f),call=f.remote.call;f.remote.call=async(path,options)=>{const r=await call(path,options);if(options?.method==='PUT'&&path.includes('/policies/'))throw new RemoteError('response lost');return r};
 const op=await f.s.prepare({action:'access',publicationId:p.id,access:{mode:'restricted',emails:['new@example.com']}});await f.confirm(op);assert.equal(f.s.op(op.id).status,'unknown');
 f.s.reconcile(op.id);await f.settle();assert.equal(f.s.op(op.id).status,'published');assert.equal(f.api.filter(c=>c.startsWith('PUT')&&c.includes('/policies/')).length,1);
});
test('lost Pages deletion response still cleans owned Access only after the project is absent',async t=>{
 const f=setup(t),p=await publish(f),remove=f.remote.remove;f.remote.remove=async name=>{await remove(name);throw new RemoteError('response lost')};
 const call=f.remote.call;f.remote.call=async(path,opts)=>{if(opts?.method==='DELETE')assert.equal(f.projects.size,0);return call(path,opts)};
 const op=await f.s.prepare({action:'remove',publicationId:p.id});await f.confirm(op);assert.equal(f.apps.size,1);f.s.reconcile(op.id);await f.settle();assert.equal(f.s.op(op.id).status,'removed');assert.equal(f.apps.size,0);assert.equal(f.calls.filter(c=>c==='remove').length,1);
});
test('lost Access delete response settles absence without a repeated delete',async t=>{
 const f=setup(t),p=await publish(f),call=f.remote.call;f.remote.call=async(path,options)=>{const r=await call(path,options);if(options?.method==='DELETE')throw new RemoteError('response lost');return r};
 const op=await f.s.prepare({action:'access',publicationId:p.id,access:{mode:'public'}});await f.confirm(op);assert.equal(f.s.op(op.id).status,'unknown');f.s.reconcile(op.id);await f.settle();assert.equal(f.s.op(op.id).status,'published');assert.equal(f.api.filter(c=>c.startsWith('DELETE')).length,1);
});
test('changed custom-domain snapshot after review refuses Access mutation',async t=>{
 const f=setup(t),p=await publish(f,{mode:'public'}),op=await f.s.prepare({action:'access',publicationId:p.id,access:restricted});f.projects.get(p.project).domains=['unexpected.example.com'];await f.confirm(op);assert.equal(f.s.op(op.id).status,'failed');assert.equal(f.apps.size,0);
});
test('policy drift between review and execution refuses changes even with the same readers',async t=>{
 const f=setup(t),p=await publish(f),op=await f.s.prepare({artifactId:'a1',version:2});f.apps.get(p.access_app).policies[0].id='replaced-policy';await f.confirm(op);assert.equal(f.s.op(op.id).status,'unknown');assert.equal(f.calls.filter(c=>c==='deploy').length,1);
});
test('revocation failure holds the result until sessions can be revoked',async t=>{
 const f=setup(t),p=await publish(f),call=f.remote.call;let fail=true;f.remote.call=async(path,opts)=>{if(fail&&path.endsWith('/revoke_tokens'))throw new RemoteError('response lost');return call(path,opts)};
 const op=await f.s.prepare({action:'access',publicationId:p.id,access:{mode:'restricted',emails:['new@example.com']}});await f.confirm(op);assert.equal(f.s.op(op.id).status,'unknown');assert.equal(f.s.pub(p.id).access_emails,p.access_emails);fail=false;f.s.reconcile(op.id);await f.settle();assert.equal(f.s.op(op.id).status,'published');assert.ok(f.api.some(c=>c.endsWith('/revoke_tokens')));
});
test('an uncertain Access delete that leaves the app present is never repeated',async t=>{
 const f=setup(t),p=await publish(f),call=f.remote.call;let deletes=0;f.remote.call=async(path,opts)=>{if(opts?.method==='DELETE'){deletes++;throw new RemoteError('response lost')}return call(path,opts)};
 const op=await f.s.prepare({action:'access',publicationId:p.id,access:{mode:'public'}});await f.confirm(op);f.s.reconcile(op.id);await f.settle();assert.equal(f.s.op(op.id).status,'unknown');assert.equal(deletes,1);assert.equal(f.s.pub(p.id).access_mode,'restricted');
});
test('a redirect to another Access organization cannot prove protection',async t=>{
 const f=setup(t);f.remote.transport=async()=>new Response(null,{status:302,headers:{location:'https://other.cloudflareaccess.com/cdn-cgi/access/login'}});const op=await f.s.prepare({artifactId:'a1',version:1,access:restricted});await f.confirm(op);assert.equal(f.s.op(op.id).status,'unknown');assert.equal(f.api.includes('UPLOAD'),false);
});
test('public installations without the optional token keep publishing and default to Public',async t=>{
 const f=setup(t);f.setToken(null);const p=await publish(f,{mode:'public'});assert.equal(p.access_mode,'public');assert.deepEqual(JSON.parse(p.access_emails),[]);assert.equal(f.api.filter(c=>c.includes('/access/')).length,0);
});
test('an unexpected credential-bearing deployment URL is rejected during verification',async t=>{
 const f=setup(t),p=await publish(f);f.deployments.get(p.deployment).url='https://user:password@d1.'+p.project+'.pages.dev/';await assert.rejects(f.s.checkAccess(p.id),/unexpected deployment URL/);
});
test('owner-facing operation responses do not expose policy snapshots or managed resource IDs',async t=>{
 const f=setup(t),p=await publish(f),op=await f.s.prepare({action:'access',publicationId:p.id,access:{mode:'restricted',emails:['new@example.com']}});
 assert.equal(op.access_snapshot,undefined);assert.equal(op.access_config,undefined);assert.equal(op.snapshot,undefined);assert.doesNotMatch(JSON.stringify(await f.s.state()),/access_fingerprint|access_attempt|access_app|access_delete_attempt/);assert.equal(op.confirmation.revision,op.revision);
});
test('an Access check completing after credential rotation cannot certify the new token',async t=>{
 const f=setup(t),call=f.remote.call;let release;const pause=new Promise(r=>release=r);let started;const entered=new Promise(r=>started=r);
 f.remote.call=async(path,options)=>{if(path.endsWith('/organizations')){started();await pause}return call(path,options)};
 const checking=f.s.checkAccessSetup();await entered;f.setToken('replacement-token');release();assert.equal((await checking).status,'unchecked');assert.equal((await f.s.state()).accessSetup.status,'unchecked');
});
test('Access authorization failure after Pages removal stays held until cleanup is verified',async t=>{
 const f=setup(t),p=await publish(f),op=await f.s.prepare({action:'remove',publicationId:p.id}),call=f.remote.call;let fail=true;
 f.remote.call=async(path,opts)=>{if(fail&&f.projects.size===0)throw new RemoteError('Access denied',403);return call(path,opts)};
 await f.confirm(op);assert.equal(f.projects.size,0);assert.equal(f.s.op(op.id).status,'unknown');assert.equal(f.apps.size,1);await assert.rejects(f.s.prepare({artifactId:'a1',version:2}),/current operation/);
 fail=false;f.s.reconcile(op.id);await f.settle();assert.equal(f.s.op(op.id).status,'removed');assert.equal(f.apps.size,0);assert.equal(f.calls.filter(c=>c==='remove').length,1);
});
