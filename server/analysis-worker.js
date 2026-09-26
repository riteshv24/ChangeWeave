import { parentPort, workerData } from 'node:worker_threads';
import ts from 'typescript';
import { setCompiler, analyzeWorkspace, runMigration } from '../core/engine.js';
setCompiler(ts);
try {
  const { operation, input }=workerData;
  const result=operation==='analyze'?analyzeWorkspace(input.workspace,input.recipeId):runMigration(input.workspace,input.recipeId,input.expectedFingerprint);
  parentPort.postMessage({ok:true,result});
}catch(error){parentPort.postMessage({ok:false,error:error.message||'Analysis failed.'});}
