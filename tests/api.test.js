import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
const listen = server => new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));

test('API persists real migration runs across restart and rejects stale/cross-origin requests',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'changeweave-')),database=join(temp,'runs.sqlite');let server=createApp({database,llmEnv:{}});
  try {
    let base=await listen(server);const demo=await (await fetch(base+'/api/demo')).json();
    const capabilities=await(await fetch(base+'/api/capabilities')).json();assert.equal(capabilities.aiReview.configured,false);
    const review=await(await fetch(base+'/api/suggest',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspace:demo})})).json();assert.equal(review.mode,'unconfigured');assert.equal(review.suggestions.length,0);assert.ok(review.unresolved.length);
    const response=await fetch(base+'/api/migrate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspace:demo,recipeId:'rename-price'})});assert.equal(response.status,200);const run=await response.json();assert.equal(run.patches.length,5);
    const blocked=await fetch(base+'/api/analyze',{method:'POST',headers:{'content-type':'application/json',origin:'https://example.org'},body:JSON.stringify({workspace:demo})});assert.equal(blocked.status,403);
    const stale=await fetch(base+'/api/migrate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspace:demo,expectedFingerprint:'outdated'})});assert.equal(stale.status,409);
    const bad=await fetch(base+'/api/analyze',{method:'POST',headers:{'content-type':'text/plain'},body:'hello'});assert.equal(bad.status,415);
    await close(server);server=createApp({database,llmEnv:{}});base=await listen(server);
    const stored=await (await fetch(base+'/api/runs/'+run.id)).json();assert.equal(stored.fingerprint,run.fingerprint);assert.equal((await(await fetch(base+'/api/runs')).json()).length,1);
    const patch=await(await fetch(base+'/api/runs/'+run.id+'/patches')).text();assert.match(patch,/--- a\/catalog-api\/src\/contracts.ts/);
  }finally{await close(server);await rm(temp,{recursive:true,force:true});}
});
