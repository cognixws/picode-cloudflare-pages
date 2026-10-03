import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {buildUI} from "../scripts/build-ui.mjs";
test("the installable UI matches the standalone build",async()=>{
 assert.equal(await buildUI(),readFileSync(new URL("../ui/app.js",import.meta.url),"utf8"));
});
test("the package exposes the unchanged PiCode installation contract",()=>{
 const m=JSON.parse(readFileSync(new URL("../picode-extension.json",import.meta.url)));
 assert.equal(m.id,"cloudflare-pages");assert.equal(m.apiVersion,2);
 assert.deepEqual(m.activation,{instance:true});
 assert.deepEqual(m.permissions,["artifacts:read","artifacts:export","events:publish"]);
 assert.equal(m.process.command,"node");assert.deepEqual(m.process.args,["${extensionDir}/server.mjs"]);
 for(const p of ["server.mjs","ui/index.html","vendor/blake3-wasm/dist/node/index.js","vendor/blake3-wasm/dist/wasm/nodejs/blake3_js_bg.wasm","migrations/001_publications.sql","migrations/002_project_provenance.sql"])assert.ok(existsSync(new URL("../"+p,import.meta.url)),p);
});
