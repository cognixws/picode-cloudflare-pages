import {build} from "esbuild";
import {writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
export async function buildUI(){
 const result=await build({absWorkingDir:root,entryPoints:["ui/source.mjs"],outfile:"ui/app.js",bundle:true,format:"iife",target:"es2022",minify:true,legalComments:"eof",write:false});
 return result.outputFiles[0].text.replace(/[ \t]+$/gm,"");
}
if(process.argv[1]===fileURLToPath(import.meta.url))writeFileSync(root+"ui/app.js",await buildUI());
