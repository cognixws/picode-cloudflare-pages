import { z } from "zod";
const publicationSchema=z.object({artifactId:z.string().min(1),version:z.number().int().positive(),projectName:z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,57}$/, "Use lowercase letters, numbers and dashes (up to 58 characters).").optional()});
const accessSchema=z.discriminatedUnion("mode",[z.object({mode:z.literal("public"),emails:z.array(z.string()).transform(()=>[])}),z.object({mode:z.literal("restricted"),emails:z.array(z.email()).min(1,"Enter at least one allowed email address.").max(50,"Enter at most 50 email addresses.")})]);
function parseAccess(mode,text){const r=accessSchema.safeParse({mode,emails:text.split(/[\s,;]+/).filter(Boolean).map(e=>e.toLowerCase())});if(!r.success)throw new Error(r.error.issues[0].message);return r.data}
// Secrets and remote operations remain in the process. The page uses only
// the existing host bridge and retains form values during feed invalidation.
(async function(){
 const root=document.getElementById("root");
 const processDoor=await picode.use("process"),confirmDoor=await picode.use("confirm"),events=await picode.use("events"),context=await picode.use("context"),links=await picode.use("links");
 let state=null,versions=[],selected="",version=0,busy="",busySite="",error="",note="",generation=0,refreshTimer,projectName="",chooser=true,accessMode="public",accessEmails="",editor=null;
 const expanded=new Set();
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
 const labels={prepared:"Awaiting confirmation",queued:"Preparing publication",creating:"Creating site",protecting:"Checking site access",uploading:"Uploading files",deploying:"Publishing version",verifying:"Verifying publication",published:"Published",failed:"Failed",removed:"Removed",cancelled:"Cancelled",unknown:"Result needs checking","rolling-back":"Restoring version",removing:"Removing site"};
 const pending=s=>["prepared","queued","creating","protecting","uploading","deploying","verifying","removing","rolling-back","unknown"].includes(s);
 const ready=()=>state?.connection?.status==="ready";
 const button=(label,action,id="",cls="",disabled=false)=>`<button type="button" class="${cls}" data-action="${action}" data-id="${esc(id)}" ${busy||disabled?"disabled":""}>${label}</button>`;
 const detail=(id,title,content)=>`<details data-detail="${esc(id)}" ${expanded.has(id)?"open":""}><summary>${title}</summary>${content}</details>`;
 async function request(path,body){
  if(!processDoor)throw new Error("The extension is off or its process is unavailable.");
  const r=await processDoor.request(path,{method:body===undefined?"GET":"POST",body});let d;try{d=JSON.parse(r.body);}catch{throw new Error("The extension returned an unreadable response.");}
  if(r.status>=400)throw new Error(d.error||"The operation could not run.");return d;
 }
 function connection(){
  if(busy==="check-connection")return `<div class="notice is-busy" role="status"><span>Checking account access…</span></div>`;
  const c=state?.connection;
  if(!c||c.status==="not-configured")return `<div class="notice"><span>Connect Cloudflare to publish a site.</span>${button("Configure connection","settings","","primary")}</div>`;
  if(c.status==="unchecked")return `<div class="notice"><span>Settings saved. Connection has not been checked.</span>${button(busy==="check-connection"?"Checking…":"Check connection","check-connection","","primary")}</div>`;
  if(c.status==="error")return `<div class="notice" role="alert"><span>${esc(c.message)}</span>${button(c.retryable?"Check again":"Edit connection",c.retryable?"check-connection":"settings")}</div>`;
  return `<div class="connection"><span class="ok">Account access verified</span><span class="muted">Publishing requires Pages Edit permission.</span>${button("Check again","check-connection")}</div>`;
 }
 function accessFields(prefix,mode,emails){
  const setup=state?.accessSetup,checked=setup?.status==="ready";
  return `<div class="access-controls"><label class="field">Access<select id="${prefix}-mode"><option value="public" ${mode==="public"?"selected":""}>Public</option><option value="restricted" ${mode==="restricted"?"selected":""}>Restricted by email</option></select></label>
   ${mode==="restricted"?`<label class="field">Allowed email addresses<textarea id="${prefix}-emails" rows="3" placeholder="you@example.com, reader@example.com">${esc(emails)}</textarea></label><p class="muted">Readers sign in with a code sent to an allowed email address.</p>${busy==="access-setup"?`<div class="notice is-busy" role="status"><span>Checking email-code login…</span></div>`:checked?`<p class="muted">Email-code login configured.</p>`:`<div class="notice" role="status"><span>${esc(setup?.message||(setup?.status==="not-configured"?"Add an Access token to enable restricted sites.":"Check email-code login before continuing."))}</span>${button(setup?.status==="not-configured"||setup?.settingsRequired?"Connection settings":"Check restricted access",setup?.status==="not-configured"||setup?.settingsRequired?"settings":"access-setup")}</div>`}`:`<p class="muted">Anyone with a link can view this site and previous versions.</p>`}</div>`;
 }
 const canRestrict=mode=>mode!=="restricted"||state?.accessSetup?.status==="ready";
 function render(){
  const active=document.activeElement,focus=active?.id,range=["INPUT","TEXTAREA"].includes(active?.tagName)?[active.selectionStart,active.selectionEnd]:null;
  root.querySelectorAll("details[data-detail]").forEach(d=>{if(d.open)expanded.add(d.dataset.detail);else expanded.delete(d.dataset.detail)});
  const pages=(state?.artifacts||[]).filter(a=>a.kind==="page"),pubs=state?.publications||[],source=pages.find(a=>a.id===selected);
  root.setAttribute("aria-busy",String(!!busy));
  let form="";
  if(ready()){
   form=`<section class="panel" aria-label="Publish an artifact"><form noValidate><div class="row spread"><h2>${source?"Publish artifact":"Choose an artifact"}</h2>${selected&&!chooser?button("Change artifact","change"):""}</div>
   ${pages.length?`<div class="source-controls">${chooser?`<label class="field">Artifact<select id="artifact"><option value="">Choose an artifact</option>${pages.map(a=>`<option value="${esc(a.id)}" ${selected===a.id?"selected":""}>${esc(a.title)}</option>`).join("")}</select></label>`:`<p class="source-title">${esc(source?.title||selected)}</p>`}<label class="field version-field">Version<select id="version" ${!versions.length?"disabled":""}>${versions.length?versions.map(v=>`<option value="${v.n}" ${version===v.n?"selected":""}>Version ${v.n}</option>`).join(""):"<option>Choose an artifact first</option>"}</select></label></div>
   ${accessFields("publish-access",accessMode,accessEmails)}
   ${detail("advanced","Advanced options",`<label class="field">Project name (optional)<input id="project-name" placeholder="Generated automatically" value="${esc(projectName)}"></label>`)}
   <div class="publish-footer"><p class="muted">Review the version and access before publishing.</p><button type="submit" class="primary" ${busy||!selected||!versions.length||!canRestrict(accessMode)?"disabled":""}>${busy==="publish"?"Preparing…":"Review publication"}</button></div>`:`<p class="muted">No page artifacts yet.</p>${button("Open artifacts","artifacts")}`}</form></section>`;
  }
  const cards=pubs.map(p=>{
   const op=p.operations.find(o=>pending(o.status)),last=op||p.operations[0],known=p.status!=="removed"&&!!p.url&&!!p.version;
   const status=p.status==="draft"?"Not published":labels[p.status]||p.status;
   const operation=last?`<div class="operation ${op&&!['prepared','unknown'].includes(op.status)?"is-busy":""}" role="status"><strong>${esc(labels[last.status]||last.status)}</strong>${last.error?`<p class="error">${esc(last.error)}</p>`:""}${op?.status==="prepared"?`<div class="row">${button("Review operation","confirm",op.id)}${button("Cancel","cancel",op.id)}</div>`:op?.status==="unknown"?`<p class="muted">Check the result before starting another operation.</p>${button("Check result","check",op.id)}`:""}</div>`:"";
   const history=p.history.length?detail("history-"+p.id,"History · "+p.history.length+" version"+(p.history.length===1?"":"s"),`<div class="history">${p.history.map(d=>`<div class="history-row"><div><strong>Version ${d.version}</strong><span class="muted">${esc(new Date(d.created_at).toLocaleString())}</span></div>${d.id===p.deployment?(p.status==="removed"?'<span class="muted">Last published</span>':'<span class="status published">Current</span>'):!op&&p.status==="published"&&d.project===p.project?button("Restore this version","restore",p.id+"/"+d.id,"",!ready()):'<span class="muted">Unavailable</span>'}</div>`).join("")}</div>`):"";
   return `<article class="panel site" data-site="${esc(p.id)}"><div class="row spread"><h3 id="site-title-${esc(p.id)}" tabindex="-1">${esc(p.title)}</h3><span class="status ${esc(p.status)}">${esc(status)}</span></div>${known?`<p class="site-url"><a href="${esc(p.url)}" data-open="${esc(p.url)}">${esc(p.url)}</a></p><p class="muted">${op?"Last confirmed version":"Published version"} ${p.version}${p.latestVersion?` · ${p.latestVersion===p.version?"Up to date":`Artifact version ${p.latestVersion} available`}`:" · Source artifact unavailable"}</p><p class="muted">${op?.status==="unknown"?"Access unconfirmed · Check the result before sharing":p.access_mode==="restricted"?`Restricted by email · ${p.access_emails.length} reader${p.access_emails.length===1?"":"s"}${p.access_verified_at?` · Checked ${esc(new Date(p.access_verified_at).toLocaleString())}`:" · Check access"}`:"Public"}${op&&op.status!=="unknown"?" · Operation pending":""}</p><div class="row publication-actions">${button("Open site","open",p.id,"primary")}${button("Copy link","copy",p.id)}${p.latestVersion&&!op?button("Choose version to update","choose",p.id,"",!ready()):""}</div>`:`<p class="muted">${esc(p.project)}</p>`}${operation}${history}${!op&&p.hasProject&&p.status!=="removed"?detail("site-settings-"+p.id,"Site settings",`<p class="muted">Dedicated project: ${esc(p.project)}</p>${busySite===p.id&&["access-verify","access-save","remove"].includes(busy)?`<div class="notice is-busy" role="status"><span>${busy==="access-verify"?"Checking site access…":"Preparing review…"}</span></div>`:""}${editor?.id===p.id?`<form noValidate data-access-editor="${esc(p.id)}" aria-label="Change site access">${accessFields("edit-access",editor.mode,editor.emails)}<div class="row" data-align-row data-align-wrap><button type="submit" class="primary" ${busy||!canRestrict(editor.mode)?"disabled":""}>Review access change</button>${button("Cancel","access-cancel")}</div></form>`:`<div class="row" data-align-row data-align-wrap>${button("Change access","access-edit",p.id,"",!ready())}${p.access_mode==="restricted"?button("Check access","access-verify",p.id,"",!ready()):""}${button("Remove site","remove",p.id,"danger",!ready())}</div>`}`):""}</article>`;
  }).join("");
  root.innerHTML=`<header class="row spread"><div><h1>Cloudflare Pages</h1><p class="muted">Sites published from your artifacts</p></div>${button("Connection settings","settings")}</header>
  ${error?`<div class="notice" role="alert"><span class="error">${esc(error)}</span>${state?button("Refresh status","refresh"):button("Open extension settings","settings")}</div>`:""}
  ${["access-save","restore","remove"].includes(busy)?`<div class="notice is-busy" role="status"><span>Preparing review…</span></div>`:""}

  ${note?`<p class="ok" role="status">${esc(note)}</p>`:""}
  ${state?`${connection()}${form}<section aria-label="Published sites"><h2>Published sites</h2>${cards||`<div class="empty"><p>No published sites yet.</p>${ready()?button("Choose an artifact","focus"):""}</div>`}</section>`:error?"":'<div class="skeleton" aria-label="Loading publications"><div></div><div></div><div></div></div>'}`;
  if(focus){const target=document.getElementById(focus);target?.focus({preventScroll:true});if(range&&target?.setSelectionRange)target.setSelectionRange(...range)}
 }
 async function loadVersions(id,n){if(id!==selected){projectName="";const p=state?.publications.find(p=>p.artifact_id===id);accessMode=p?.access_mode||"public";accessEmails=(p?.access_emails||[]).join(", ")}selected=id;version=n||0;versions=[];const seq=++generation;render();if(!id)return;try{const r=await request("/artifacts/"+encodeURIComponent(id));if(seq!==generation)return;versions=r.versions;version=n||r.artifact.liveVersion;render();}catch(e){if(seq===generation){error=e.message;render()}}}
 async function refresh(){try{state=await request("/state");error=state.error||"";render()}catch(e){error=e.message;render()}}
 async function run(body){const op=await request("/prepare",body);if(op.unchanged){await refresh();note="This version and access are already published.";return}const r=await confirmDoor.operation(op.id);if(!r.confirmed)await request("/operations/"+op.id+"/cancel",{});await refresh();const card=root.querySelector(`[data-site="${op.publication_id}"]`);card?.scrollIntoView({block:"start",behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});card?.querySelector('h3')?.focus({preventScroll:true})}
 function open(url){if(links)return links.open(url);throw new Error("Open the link from the publication URL.")}
 root.addEventListener("input",e=>{if(e.target.id==="project-name")projectName=e.target.value;if(e.target.id==="publish-access-emails")accessEmails=e.target.value;if(e.target.id==="edit-access-emails"&&editor)editor.emails=e.target.value});
 root.addEventListener("change",e=>{if(e.target.id==="artifact")void loadVersions(e.target.value);if(e.target.id==="version")version=Number(e.target.value);if(e.target.id==="publish-access-mode"){accessMode=e.target.value;render()}if(e.target.id==="edit-access-mode"&&editor){editor.mode=e.target.value;render()}});
 root.addEventListener("submit",e=>{e.preventDefault();void action(e.target.dataset.accessEditor?"access-save":"publish")});
 root.addEventListener("click",e=>{const link=e.target.closest("[data-open]");if(link){e.preventDefault();void open(link.dataset.open).catch(e=>{error=e.message;render()});return}const b=e.target.closest("button[data-action]");if(b){e.preventDefault();void action(b.dataset.action,b.dataset.id)}});
 async function action(name,id=""){
  if(busy)return;const p=state?.publications.find(p=>p.id===id);busy=name;busySite=id.split("/")[0]||(name==="access-save"?editor?.id:"");error="";note="";render();
  try{
   if(name==="refresh")await refresh();
   else if(name==="check-connection"){await request("/connection/check",{});await refresh()}
   else if(name==="publish"){const r=publicationSchema.safeParse({artifactId:selected,version,projectName:state.publications.some(p=>p.artifact_id===selected&&p.hasProject&&p.status!=="removed")?undefined:projectName.trim()||undefined});if(!r.success)throw new Error(r.error.issues[0].message);await run({...r.data,access:parseAccess(accessMode,accessEmails)})}
   else if(name==="access-setup"){await request("/access/check",{});await refresh()}
   else if(name==="access-verify"){await request("/access/verify",{publicationId:id});await refresh();note="Restricted access verified on production and preview URLs."}
   else if(name==="access-edit"){editor={id:p.id,mode:p.access_mode,emails:p.access_emails.join(", ")};expanded.add("site-settings-"+p.id)}
   else if(name==="access-cancel")editor=null;
   else if(name==="access-save"){await run({action:"access",publicationId:editor.id,access:parseAccess(editor.mode,editor.emails)});editor=null}
   else if(name==="remove")await run({action:"remove",publicationId:id});
   else if(name==="restore"){const [publicationId,deployment]=id.split("/");await run({action:"rollback",publicationId,deployment})}
   else if(name==="confirm")await confirmDoor.operation(id);
   else if(name==="cancel")await request("/operations/"+id+"/cancel",{});
   else if(name==="check")await request("/operations/"+id+"/check",{});
   else if(name==="choose"){chooser=false;projectName="";accessMode=p.access_mode;accessEmails=p.access_emails.join(", ");await loadVersions(p.artifact_id,p.latestVersion);root.querySelector('[aria-label="Publish an artifact"]')?.scrollIntoView({block:"start",behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}
   else if(name==="change")chooser=true;
   else if(name==="open")await open(p.url);
   else if(name==="copy"){await links.copy(p.url);note="Link copied."}
   else if(name==="settings")await open(new URL("/#/extensions/cloudflare-pages",location.href).href);
   else if(name==="artifacts")await open(new URL("/#/artifacts",location.href).href);
   else if(name==="focus"){chooser=true;render();document.getElementById("artifact")?.focus()}
  }catch(e){error=e.message}finally{busy="";busySite="";render();if(["cancel","confirm","check"].includes(name))void refresh()}
 }
 if(events)events.onChange(()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>void refresh(),150)});
 if(context){const c=context.current();if(c?.artifactId){selected=c.artifactId;version=c.version;chooser=false}context.onChange(c=>{if(c?.artifactId){chooser=false;projectName="";void loadVersions(c.artifactId,c.version)}})}
 await refresh();if(selected){const p=state?.publications.find(p=>p.artifact_id===selected);accessMode=p?.access_mode||"public";accessEmails=(p?.access_emails||[]).join(", ");await loadVersions(selected,version);}
})().catch(()=>{const root=document.getElementById("root");root.setAttribute("aria-busy","false");root.textContent="The extension could not start. Reopen its page from Extensions."});
