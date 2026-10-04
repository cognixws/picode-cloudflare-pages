import { RemoteError } from "./cloudflare.mjs";

export function analyticsURL(account, tag) {return "https://dash.cloudflare.com/"+account+"/web-analytics/overview?siteTag~in="+encodeURIComponent(tag);}

// Web Analytics state lives in the project's build configuration; the RUM site
// tag is adopted by hostname before any create, so a lost create response is
// settled by listing instead of creating the same site twice.
export class PublicationAnalytics {
 constructor({db}) {this.db=db;}
 host(p) {return p.project+".pages.dev";}
 async find(cf,p) {
  const host=this.host(p),sites=await cf.rumSites();
  return sites.find(s=>s.host===host||typeof s.host==="string"&&s.host.includes(host))||null;
 }
 async ensure(cf,p,project,record=true) {
  const current=project.build_config||{};
  if(current.web_analytics_tag&&current.web_analytics_token) {
   if(current.web_analytics_tag!==p.analytics_tag)throw new RemoteError("This site already has Web Analytics configured outside this extension. Review Cloudflare.",409);
   return current.web_analytics_tag;
  }
  let site=await this.find(cf,p);
  if(!site||!site.site_tag||!site.site_token) {
   try {
    const created=await cf.createRumSite(this.host(p));
    if(!created?.site_tag||!created.site_token)throw new RemoteError("Cloudflare did not identify the Web Analytics site.",502);
    site=created;
   }catch(e) {
    site=await this.find(cf,p);
    if(!site?.site_tag||!site.site_token)throw e;
   }
  }
  await cf.setAnalytics(p.project,{...current,web_analytics_tag:site.site_tag,web_analytics_token:site.site_token});
  const after=await cf.getProject(p.project);
  if(after?.build_config?.web_analytics_tag!==site.site_tag)throw new RemoteError("Cloudflare has not confirmed Web Analytics for this site. Check the result.",409);
  if(record)this.db.prepare("UPDATE publications SET analytics_tag=? WHERE id=?").run(site.site_tag,p.id);
  return site.site_tag;
 }
 async clear(cf,p,project) {
  const current=project.build_config||{};
  if(current.web_analytics_tag||current.web_analytics_token) {
   await cf.setAnalytics(p.project,{...current,web_analytics_tag:null,web_analytics_token:null});
   const after=await cf.getProject(p.project);
   if(after?.build_config?.web_analytics_tag||after?.build_config?.web_analytics_token)throw new RemoteError("Cloudflare has not confirmed that Web Analytics is off. Check the result.",409);
  }
  this.db.prepare("UPDATE publications SET analytics_tag=NULL WHERE id=?").run(p.id);
 }
 // Removing the analytics site of a deleted project is idempotent: an absent
 // site settles the cleanup, so Check result may repeat it safely. Only the
 // disposed tag clears the recorded column; a newer tag stays untouched.
 async dispose(cf,p) {
  if(!p.analytics_tag)return;
  try {await cf.deleteRumSite(p.analytics_tag);}
  catch(e) {if(e.status!==404)throw e;}
  this.db.prepare("UPDATE publications SET analytics_tag=NULL WHERE id=? AND analytics_tag=?").run(p.id,p.analytics_tag);
 }
}
