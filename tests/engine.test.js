import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { setCompiler, demoWorkspace, analyzeWorkspace, runMigration, fingerprint, validateWorkspace, dependencyGraph, checkPayload } from '../core/engine.js';
setCompiler(ts);
const repo = (w,id) => w.repositories.find(r=>r.id===id);

test('compiler-backed migration edits typed declarations/accesses and keeps unrelated fields',()=>{
  const original=demoWorkspace(),snapshot=JSON.stringify(original),run=runMigration(original);
  assert.equal(JSON.stringify(original),snapshot,'engine must not mutate imported workspace');
  assert.equal(run.verification.before.ok,true);assert.equal(run.verification.after.ok,true);
  assert.equal(run.patches.length,5);assert.equal(run.stats.affectedRepositories,4);
  const api=repo(run.patchedWorkspace,'catalog-api').files['src/catalog.ts'];
  assert.match(api,/amountMinor: 2499/);assert.match(api,/legacyMetric = \{ priceCents: 812 \}/);assert.match(api,/legacyMetric\.priceCents/);
  assert.equal(repo(run.patchedWorkspace,'storefront').files['src/analytics.ts'],repo(original,'storefront').files['src/analytics.ts']);
});
test('destructuring preserves local variable names and shorthand preserves value bindings',()=>{
  const run=runMigration(demoWorkspace());
  const cart=repo(run.patchedWorkspace,'storefront').files['src/cart.ts'];
  const order=repo(run.patchedWorkspace,'order-worker').files['src/order.ts'];
  assert.match(cart,/\{ amountMinor: priceCents \} = product/);assert.match(cart,/return priceCents;/);
  assert.match(cart,/product\["amountMinor"\]/);assert.match(order,/\{ amountMinor: unitPrice \}/);
  assert.match(order,/amountMinor: priceCents, currency/);
});
test('ambiguous any inputs remain unchanged and block a verified status',()=>{
  const run=runMigration(demoWorkspace());assert.equal(run.status,'needs-review');
  assert.ok(run.unresolved.some(u=>u.kind==='dynamic-access'));
  assert.match(repo(run.patchedWorkspace,'reporting-sdk').files['src/report.ts'],/raw\.priceCents/);
});
test('supported migration can become verified only when ambiguity is removed',()=>{
  const w=demoWorkspace();repo(w,'reporting-sdk').files['src/report.ts']='import type { Product } from "../../catalog-api/src/contracts";\nexport function amount(product: Product): number { return product.priceCents; }\n';
  const run=runMigration(w);assert.equal(run.status,'verified');assert.equal(run.unresolved.length,0);assert.ok(run.verification.fixtures.every(f=>f.status==='passed'));
});
test('compatibility tests expose the breaking rollout boundary',()=>{
  const run=runMigration(demoWorkspace());assert.deepEqual(run.verification.compatibility.map(c=>c.status),['passed','failed','failed','passed']);
  assert.ok(run.verification.compatibility.every(c=>c.details.includes('fixtures only')));
});
test('required business fields and structural price conversions never invent rules',()=>{
  for(const id of ['require-market','structured-price']){
    const run=runMigration(demoWorkspace(),id);assert.equal(run.status,'needs-review');assert.equal(run.patches.length,0);assert.ok(run.unresolved.some(u=>u.kind==='business-rule'));assert.ok(run.verification.fixtures.every(f=>f.status==='failed'));
  }
});
test('content fingerprint detects changed source, recipe, or fixtures',()=>{
  const w=demoWorkspace(),hash=fingerprint(w);assert.equal(hash,fingerprint(JSON.parse(JSON.stringify(w))));
  repo(w,'catalog-api').files['src/contracts.ts']+='\n';assert.throws(()=>runMigration(w,'rename-price',hash),/STALE_WORKSPACE/);
  const v=demoWorkspace();v.fixtures[0].after.amountMinor=0;assert.notEqual(hash,fingerprint(v));
});
test('dependency graph detects cycles and places providers ahead of consumers',()=>{
  const w=demoWorkspace(),graph=dependencyGraph(w);assert.deepEqual(graph.order,['catalog-api','storefront','order-worker','reporting-sdk']);
  w.repositories[0].dependencies=['reporting-sdk'];const cyclic=dependencyGraph(w);assert.equal(cyclic.cycles.length,1);assert.equal(cyclic.cycles[0].length,4);
  assert.ok(runMigration(w).unresolved.some(u=>u.kind==='dependency-cycle'));
});
test('dependency graph derives cross-repository import edges even if metadata omits them',()=>{
  const w=demoWorkspace();for(const r of w.repositories)r.dependencies=[];const analysis=analyzeWorkspace(w);
  assert.ok(analysis.graph.edges.some(e=>e.from==='storefront'&&e.to==='catalog-api'));
});
test('path traversal, large files, duplicate IDs and unknown dependencies are rejected',()=>{
  const path=demoWorkspace();path.repositories[0].files['../escape.ts']='';assert.throws(()=>validateWorkspace(path),/Unsafe/);
  const large=demoWorkspace();large.repositories[0].files['src/large.ts']='x'.repeat(150001);assert.throws(()=>validateWorkspace(large),/per-file/);
  const duplicate=demoWorkspace();duplicate.repositories[1].id=duplicate.repositories[0].id;assert.throws(()=>validateWorkspace(duplicate),/unique/);
  const dep=demoWorkspace();dep.repositories[0].dependencies=['missing'];assert.throws(()=>validateWorkspace(dep),/Unknown dependency/);
});
test('invalid expected fixtures prevent a verified result',()=>{
  const w=demoWorkspace();w.fixtures[0].after.amountMinor=99999;const run=runMigration(w);assert.equal(run.verification.fixtures[0].status,'failed');assert.match(run.verification.fixtures[0].details,/does not match/);assert.equal(run.status,'needs-review');
});
test('a target property collision blocks all automatic edits',()=>{
  const w=demoWorkspace();repo(w,'catalog-api').files['src/contracts.ts']=repo(w,'catalog-api').files['src/contracts.ts'].replace('id: string;','id: string;\n  amountMinor?: number;');
  const run=runMigration(w);assert.equal(run.patches.length,0);assert.ok(run.unresolved.some(u=>u.kind==='name-collision'));
});
test('schema keywords outside the supported subset return unknown, never a pass',()=>{
  assert.equal(checkPayload('x',{type:'string',pattern:'^x$'},{components:{schemas:{}}}).status,'unknown');
  assert.equal(checkPayload({foo:1},{type:'object',required:['bar'],additionalProperties:false,properties:{}},{components:{schemas:{}}}).status,'failed');
});
test('existing compile errors stay visible',()=>{
  const w=demoWorkspace();repo(w,'storefront').files['src/broken.ts']='export const number: number = "wrong";';
  const run=runMigration(w);assert.equal(run.verification.before.ok,false);assert.equal(run.verification.after.ok,false);assert.equal(run.status,'needs-review');
});

test('contract changes beyond an explicit rename must remain review-required',()=>{
  const w=demoWorkspace();w.contract.after.components.schemas.Product.properties.currency.enum.push('GBP');
  const run=runMigration(w);assert.equal(run.status,'needs-review');assert.ok(run.unresolved.some(u=>u.kind==='additional-contract-change'));
  const wrong=demoWorkspace();wrong.contract.after=structuredClone(wrong.contract.before);const blocked=runMigration(wrong);assert.equal(blocked.patches.length,0);assert.ok(blocked.unresolved.some(u=>u.kind==='contract-recipe-mismatch'));
});
