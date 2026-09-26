import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobRunner } from '../server/job-runner.js';
import { demoWorkspace } from '../core/demo.js';

test('analysis workers enforce queue admission and execution deadline',async()=>{
  const runner=createJobRunner({concurrency:1,queueLimit:0,timeoutMs:1});
  try {
    const results=await Promise.allSettled([runner.run('analyze',{workspace:demoWorkspace()}),runner.run('analyze',{workspace:demoWorkspace()})]);
    assert.equal(results[0].status,'rejected');assert.equal(results[0].reason.status,422);
    assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.status,429);
  }finally{runner.close();}
});
