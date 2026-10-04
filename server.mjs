import http from "node:http";
import https from "node:https";
import { timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Cloudflare, RemoteError } from "./cloudflare.mjs";
import { PagesService } from "./service.mjs";

const env=process.env;
const url=new URL(env.PICODE_URL);
if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname))throw new Error("PiCode Host API must use loopback.");
const token=env.PICODE_EXT_TOKEN,secret=env.PICODE_EXT_PROXY_SECRET;
function host(path,limit=1<<20,body) {
 return new Promise((resolve,reject)=>{
  const target=new URL("/api/ext/v1"+path,url);
  const client=target.protocol==="https:"?https:http;
  // Only PiCode loopback uses its self-signed certificate. Cloudflare uses
  // the normal TLS verifier; never disable verification process-wide.
  const req=client.request(target,{method:body===undefined?"GET":"POST",rejectUnauthorized:false,headers:{"X-PiCode-Extension-Token":token,"Content-Type":"application/json"}},res=>{
   const chunks=[];let bytes=0;
   res.on("data",b=>{bytes+=b.length;if(bytes>limit){res.destroy();reject(new RemoteError("PiCode's response is too large.",409));}else chunks.push(b);});
   res.on("error",reject);res.on("end",()=>{try{const r=JSON.parse(Buffer.concat(chunks).toString());if(res.statusCode>=400)reject(new RemoteError(typeof r.error==="string"?r.error:"PiCode refused the artifact request.",res.statusCode));else resolve(r);}catch{reject(new RemoteError("PiCode returned an unreadable response."));}});
  });req.setTimeout(60_000,()=>req.destroy(new Error("Host API timeout")));req.on("error",reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
}
const db=new DatabaseSync(env.PICODE_EXT_DB);
const service=new PagesService({db,host,remote:(account,token)=>new Cloudflare(account,token),emit:(name,data)=>host("/events",1<<20,{name,data})});
const equal=(a,b)=>{const x=Buffer.from(a||""),y=Buffer.from(b||"");return x.length===y.length&&timingSafeEqual(x,y);};
const server=http.createServer(async(req,res)=>{
 const send=(status,value)=>{res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(value));};
 if(!equal(req.headers["x-picode-proxy-secret"],secret)){send(403,{error:"Use the PiCode process relay."});return;}
 try {
  const path=new URL(req.url,"http://localhost").pathname;
  let body={};if(req.method==="POST"){let text="";for await(const b of req){text+=b;if(text.length>16<<10)throw new RemoteError("Request too large.",400);}try{body=JSON.parse(text||"{}");}catch{throw new RemoteError("Invalid request.",400);}}
  if(req.method==="POST"&&path==="/connection/check")return send(200,await service.checkConnection());
  if(req.method==="POST"&&path==="/access/check")return send(200,await service.checkAccessSetup());
  if(req.method==="POST"&&path==="/access/verify")return send(200,await service.checkAccess(body.publicationId));
  if(req.method==="GET"&&path==="/state")return send(200,await service.state());
  if(req.method==="GET"&&path.startsWith("/artifacts/"))return send(200,await service.source(decodeURIComponent(path.slice(11))));
  if(req.method==="POST"&&path==="/prepare")return send(201,await service.prepare(body));
  if(req.method==="POST"&&path==="/__picode/confirm") {
   if(!equal(req.headers["x-picode-owner-confirmed"],body.revision))throw new RemoteError("Confirm this operation through PiCode.",403);
   return send(202,await service.confirm(body.operationId,body.revision));
  }
  const match=/^\/operations\/([a-zA-Z0-9-]{1,80})(?:\/(cancel|check))?$/.exec(path);
  if(match && req.method==="GET"&&!match[2])return send(200,service.operation(match[1]));
  if(match && req.method==="POST"&&match[2]==="cancel")return send(200,service.cancel(match[1]));
  if(match && req.method==="POST"&&match[2]==="check")return send(202,service.reconcile(match[1]));
  send(404,{error:"This action is unavailable."});
 }catch(e){send(e instanceof RemoteError?e.status:500,{error:e instanceof RemoteError?e.message:"The extension could not complete the request."});}
});
server.listen(Number(env.PICODE_EXT_PORT),"127.0.0.1",()=>void service.recover());
const timer=setInterval(()=>void service.tick(),3000);
// Remote status has no PiCode feed until this process observes it. Polling
// is against Cloudflare only; the page follows extension feed events.
function shutdown(){service.closing=true;clearInterval(timer);server.close();}
process.on("SIGTERM",shutdown);process.on("SIGINT",shutdown);
