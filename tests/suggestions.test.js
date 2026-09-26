import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { setCompiler, demoWorkspace, runMigration } from '../core/engine.js';
import { buildReviewContext, reviewCapabilities, suggestReview } from '../server/suggestions.js';
setCompiler(ts);
const workspace=demoWorkspace(),run=runMigration(workspace),input={workspace,run};
const env={CHANGEWEAVE_ENABLE_LLM:'1',LLM_API_KEY:'test-secret-must-not-leak',LLM_MODEL:'test-model',LLM_BASE_URL:'https://llm.example/v1'};
const valid={repository:'reporting-sdk',file:'src/report.ts',reason:'Validate the external payload against the Product schema before reading its amount. Confirm whether callers still send the old field.',proposedCode:'// Review required: validate incoming payload before typed access.'};
const response=content=>new Response(JSON.stringify({choices:[{message:{content}}]}),{status:200,headers:{'content-type':'application/json'}});

test('LLM review is opt-in and never sends a request when unconfigured',async()=>{
  let calls=0;const result=await suggestReview(input,{env:{},fetchImpl:async()=>{calls++;throw Error('must not call');}});
  assert.equal(result.mode,'unconfigured');assert.equal(calls,0);assert.ok(result.unresolved.some(f=>f.kind==='dynamic-access'));assert.equal(result.suggestions.length,0);
  assert.equal(reviewCapabilities({...env,CHANGEWEAVE_ENABLE_LLM:'0'}).aiReview.configured,false);
  assert.equal(reviewCapabilities({...env,LLM_API_KEY:''}).aiReview.configured,false);
});
test('configured requests send bounded relevant snippets and accept separate validated suggestions',async()=>{
  const before=JSON.stringify(input);let request;
  const result=await suggestReview(input,{env,fetchImpl:async(url,options)=>{request={url,...options};return response(JSON.stringify({suggestions:[valid]}));}});
  assert.equal(result.mode,'suggestions');assert.equal(result.suggestions.length,1);assert.equal(JSON.stringify(input),before,'suggestions must never modify migration inputs or patches');
  assert.equal(request.url,'https://llm.example/v1/chat/completions');assert.equal(request.headers.Authorization,'Bearer test-secret-must-not-leak');
  const body=JSON.parse(request.body),context=JSON.parse(body.messages[1].content);assert.equal(body.model,'test-model');assert.ok(context.characters<=6000);assert.ok(context.files.length<=5);assert.ok(context.files.some(f=>f.repository==='reporting-sdk'));assert.ok(!context.files.some(f=>f.file==='src/analytics.ts'));
  assert.ok(request.signal instanceof AbortSignal);assert.ok(!JSON.stringify(result).includes(env.LLM_API_KEY));assert.ok(!JSON.stringify(reviewCapabilities(env)).includes(env.LLM_API_KEY));
});
test('provider failures remain explicit and never include response bodies or credentials',async()=>{
  const rejected=await suggestReview(input,{env,fetchImpl:async()=>new Response(env.LLM_API_KEY,{status:401})});assert.equal(rejected.mode,'unavailable');assert.ok(!JSON.stringify(rejected).includes(env.LLM_API_KEY));
  const unreachable=await suggestReview(input,{env,fetchImpl:async()=>{throw Error(env.LLM_API_KEY);}});assert.equal(unreachable.mode,'unavailable');assert.ok(!JSON.stringify(unreachable).includes(env.LLM_API_KEY));
});
test('malformed model JSON is rejected',async()=>{
  for(const value of ['not json','```json\n{"suggestions":[]}\n```','{"other": []}','{"suggestions": [], "apply": true}']){
    const result=await suggestReview(input,{env,fetchImpl:async()=>response(value)});assert.equal(result.mode,'invalid-response');assert.equal(result.suggestions.length,0);
  }
});
test('unknown paths and files absent from supplied context are rejected',async()=>{
  for(const invalid of [{...valid,file:'../secret.ts'},{...valid,repository:'missing'},{...valid,repository:'reporting-sdk/src',file:'report.ts'},{...valid,repository:'storefront',file:'src/analytics.ts'}]){
    const result=await suggestReview(input,{env,fetchImpl:async()=>response(JSON.stringify({suggestions:[invalid]}))});assert.equal(result.mode,'invalid-response');
  }
});
test('oversized suggestions and provider payloads are rejected',async()=>{
  const suggestions=[{...valid,reason:'x'.repeat(1201)},{...valid,proposedCode:'x'.repeat(4001)}];
  for(const invalid of suggestions){const result=await suggestReview(input,{env,fetchImpl:async()=>response(JSON.stringify({suggestions:[invalid]}))});assert.equal(result.mode,'invalid-response');}
  const huge=await suggestReview(input,{env,fetchImpl:async()=>response('x'.repeat(65000))});assert.equal(huge.mode,'invalid-response');
});
test('invalid base URLs do not enable provider requests',()=>{
  for(const base of ['http://external.example/v1','https://user:secret@example.com','https://example.com?key=secret','file:///tmp/key'])assert.equal(reviewCapabilities({...env,LLM_BASE_URL:base}).aiReview.configured,false);
  assert.equal(reviewCapabilities({...env,LLM_BASE_URL:'http://127.0.0.1:11434/v1'}).aiReview.configured,true);
});
test('review context caps large source excerpts',()=>{
  const w=demoWorkspace();w.repositories.find(r=>r.id==='reporting-sdk').files['src/report.ts']='x'.repeat(100000);const context=buildReviewContext(w,run);assert.ok(context.characters<=6000);assert.ok(context.files.every(f=>f.snippet.length<=1600));
});
