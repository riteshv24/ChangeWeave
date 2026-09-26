import ts from 'typescript';
import { setCompiler, demoWorkspace, runMigration } from '../core/engine.js';
setCompiler(ts);const run=runMigration(demoWorkspace());
console.log(JSON.stringify({status:run.status,stats:run.stats,patches:run.patches.map(p=>p.repository+'/'+p.file),verification:run.verification,unresolved:run.unresolved},null,2));
