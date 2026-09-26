import ts from 'typescript';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { setCompiler, demoWorkspace, analyzeWorkspace, runMigration } from '../core/engine.js';
setCompiler(ts);const workspace=demoWorkspace();analyzeWorkspace(workspace);
const samples=[];for(let i=0;i<5;i++){const start=performance.now();const run=runMigration(workspace);samples.push({milliseconds:Math.round((performance.now()-start)*100)/100,status:run.status,patches:run.patches.length});}
const sorted=samples.map(s=>s.milliseconds).sort((a,b)=>a-b);
console.log(JSON.stringify({benchmark:'local fixture migration, warm compiler process',date:new Date().toISOString(),node:process.version,typescript:ts.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,repositoryCount:workspace.repositories.length,sourceBytes:workspace.repositories.reduce((n,r)=>n+Object.values(r.files).reduce((a,s)=>a+Buffer.byteLength(s),0),0),samples,medianMs:sorted[2],maximumMs:sorted.at(-1),limitations:'Five sequential local runs; not a throughput, production, or p95 benchmark. Includes two fresh virtual compiler programs per run; no caching claims.'},null,2));
