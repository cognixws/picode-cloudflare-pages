import { z } from "zod";
const publicationSchema=z.object({artifactId:z.string().min(1),version:z.number().int().positive(),projectName:z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,57}$/, "Use lowercase letters, numbers and dashes (up to 58 characters).").optional()});
/* The page has no network and no credentials. Every request uses PiCode's
 * process relay; operations continue after the page closes. */
(async function(){
 const root=document.getElementById("root");
 const processDoor=await picode.use("process");
 const confirmDoor=await picode.use("confirm");
 const events=await picode.use("events");
 const context=await picode.use("context");
 const links=await picode.use("links");
 let state=null,versions=[],selected="",version=0,busy=false,error="",generation=0,refreshTimer,projectName="";
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
 const labels={prepared:"Awaiting confirmation",queued:"Preparing",creating:"Creating site",uploading:"Uploading files",deploying:"Publishing",verifying:"Verifying publication",published:"Published",failed:"Failed",removed:"Removed",cancelled:"Cancelled",unknown:"Result needs checking","rolling-back":"Restoring",removing:"Removing"};
 const pending=s=>["prepared","queued","creating","uploading","deploying","verifying","removing","rolling-back","unknown"].includes(s);
 function button(label,action,id="",cls=""){return `<button type="button" class="${cls}" data-action="${action}" data-id="${esc(id)}" ${busy?"disabled":""}>${label}</button>`;}
 async function request(path,body){
  if(!processDoor)throw new Error("The extension process is unavailable. Open its settings to turn it on.");
  const r=await processDoor.request(path,{method:body===undefined?"GET":"POST",body});let d;try{d=JSON.parse(r.body);}catch{throw new Error("The extension returned an unreadable response.");}
  if(r.status>=400)throw new Error(d.error||"The operation could not run.");return d;
 }
 function render(){
  const focus=document.activeElement?.id;
  const pages=(state?.artifacts||[]).filter(a=>a.kind==="page");
  const pubs=state?.publications||[];
  root.setAttribute("aria-busy",String(busy));
  root.innerHTML=`<div class="row spread"><h1>Cloudflare Pages</h1>${button("Settings","settings")}</div><p class="muted">Publish a version. Keep its public link up to date.</p>
   ${error?`<div class="panel" role="alert"><p class="error">${esc(error)}</p>${button("Retry","refresh")}</div>`:""}
   ${state?`<section class="panel" aria-label="Publish an artifact"><form noValidate><h2>Publish an artifact</h2>${pages.length?`<div class="row controls"><div class="control-group" data-align-row><select id="artifact" aria-label="Artifact"><option value="">Choose an artifact</option>${pages.map(a=>`<option value="${esc(a.id)}" ${selected===a.id?"selected":""}>${esc(a.title)}</option>`).join("")}</select><select id="version" aria-label="Version" ${!versions.length?"disabled":""}>${versions.length?versions.map(v=>`<option value="${v.n}" ${version===v.n?"selected":""}>Version ${v.n}</option>`).join(""):"<option>Version</option>"}</select></div><div class="control-group" data-align-row><input id="project-name" aria-label="Project name (optional)" placeholder="Project name" value="${esc(projectName)}"><button type="submit" class="primary" data-action="publish" ${busy||!selected||!versions.length?"disabled":""}>${busy?"Preparing…":"Publish version"}</button></div></div>`:`<p class="muted">No page artifacts yet.</p>${button("Open artifacts","artifacts")}`}</form></section>
   <section aria-label="Publications"><h2>Publications</h2>${pubs.length?pubs.map(p=>{
    const op=p.operations.find(o=>pending(o.status));
    const last=op||p.operations[0];
    return `<article class="panel"><div class="row spread"><h2>${esc(p.title)}</h2><span class="status ${esc(p.status)}">${esc(p.status==="draft"?"Not published":labels[p.status]||p.status)}</span></div><p class="muted">${esc(p.project)}</p>
     ${p.status==="published"?`<p><a href="${esc(p.url)}" data-open="${esc(p.url)}">${esc(p.url)}</a></p><p class="muted">Published version ${p.version}${p.latestVersion?` · Latest artifact version ${p.latestVersion}`:" · Source artifact unavailable"}</p><div class="row publication-actions" data-align-stack>${button("Open site","open",p.id)}${button("Copy link","copy",p.id)}${p.latestVersion&&!op?button("Choose version to update","choose",p.id):""}${!op?button("Remove publication","remove",p.id,"danger"):""}</div>`:""}
     ${p.status==="draft"&&p.hasProject&&!op?button("Remove unused site","remove",p.id,"danger"):""}
     ${last?`<div class="operation ${op&&!['prepared','unknown'].includes(op.status)?"is-busy":""}" role="status"><strong>${esc(labels[last.status]||last.status)}</strong>${last.error?`<p class="error">${esc(last.error)}</p>`:""}${op?.status==="prepared"?`<div class="row" data-align-row>${button("Review operation","confirm",op.id)}${button("Cancel","cancel",op.id)}</div>`:op?.status==="unknown"?button("Check result","check",op.id):""}</div>`:""}
     ${p.history.length?`<details><summary>Publication history</summary><div class="history">${p.history.map(d=>`<div class="row spread"><span>Version ${d.version} · ${esc(new Date(d.created_at).toLocaleString())}</span>${!op&&p.status==="published"&&d.project===p.project&&d.id!==p.deployment?button("Restore","restore",p.id+"/"+d.id):""}</div>`).join("")}</div></details>`:""}</article>`;
   }).join(""):`<div class="panel"><p class="muted">No published sites yet.</p>${button("Choose an artifact","focus")}</div>`}</section>`:`<div class="skeleton" aria-label="Loading publications"><div></div><div></div><div></div></div>`}`;
  if(focus)document.getElementById(focus)?.focus();
 }
 async function loadVersions(id,n){
  selected=id;version=n||0;versions=[];const seq=++generation;render();if(!id)return;
  try{const r=await request("/artifacts/"+encodeURIComponent(id));if(seq!==generation)return;versions=r.versions;version=n||r.artifact.liveVersion;render();}catch(e){if(seq===generation){error=e.message;render();}}
 }
 async function refresh(){try{const next=await request("/state");state=next;error=next.error||"";render();}catch(e){error=e.message;render();}}
 async function run(body){
  const op=await request("/prepare",body);
  if(op.unchanged)return refresh();
  const r=await confirmDoor.operation(op.id);
  if(!r.confirmed)await request("/operations/"+op.id+"/cancel",{});
  await refresh();
 }
 function open(url){if(links)return links.open(url);throw new Error("Open the link from the publication URL.");}
 root.addEventListener("input",e=>{if(e.target.id==="project-name")projectName=e.target.value;});
 root.addEventListener("submit",e=>{e.preventDefault();root.querySelector("[data-action=publish]")?.click();});
 root.addEventListener("change",e=>{if(e.target.id==="artifact")void loadVersions(e.target.value);if(e.target.id==="version")version=Number(e.target.value);});
 root.addEventListener("click",async e=>{
  const link=e.target.closest("[data-open]");if(link){e.preventDefault();try{await open(link.dataset.open);}catch(e){error=e.message;render();}return;}
  const b=e.target.closest("button[data-action]");if(!b||busy)return;e.preventDefault();
  const {action,id}=b.dataset;const p=state?.publications.find(p=>p.id===id);
  busy=true;error="";render();
  try {
   if(action==="refresh")await refresh();
   else if(action==="publish"){const r=publicationSchema.safeParse({artifactId:selected,version,projectName:projectName.trim()||undefined});if(!r.success)throw new Error(r.error.issues[0].message);await run(r.data);}
   else if(action==="remove")await run({action:"remove",publicationId:id});
   else if(action==="restore"){const [publicationId,deployment]=id.split("/");await run({action:"rollback",publicationId,deployment});}
   else if(action==="confirm")await confirmDoor.operation(id);
   else if(action==="cancel")await request("/operations/"+id+"/cancel",{});
   else if(action==="check")await request("/operations/"+id+"/check",{});
   else if(action==="choose")await loadVersions(p.artifact_id,p.latestVersion);
   else if(action==="open")await open(p.url);
   else if(action==="copy")await links.copy(p.url);
   else if(action==="settings")await open(new URL("/#/extensions/cloudflare-pages",location.href).href);
   else if(action==="artifacts")await open(new URL("/#/artifacts",location.href).href);
   else if(action==="focus")document.getElementById("artifact")?.focus();
  }catch(e){error=e.message;}finally{busy=false;render();if(["cancel","confirm","check"].includes(action))void refresh();}
 });
 if(events)events.onChange(()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>void refresh(),150);});
 if(context){const c=context.current();if(c?.artifactId){selected=c.artifactId;version=c.version;}context.onChange(c=>{if(c?.artifactId)void loadVersions(c.artifactId,c.version);});}
 await refresh();if(selected)await loadVersions(selected,version);
})().catch(()=>{const root=document.getElementById("root");root.setAttribute("aria-busy","false");root.textContent="The extension could not start. Reopen its page from Extensions.";});
