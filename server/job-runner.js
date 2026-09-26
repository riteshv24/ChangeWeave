import { Worker } from 'node:worker_threads';
// Inputs are parsed as data, never executed. Workers also isolate compiler CPU/memory.
export function createJobRunner({concurrency=2,queueLimit=4,timeoutMs=15_000}={}) {
  let active=0,closed=false;const queue=[],workers=new Set();
  function drain(){while(!closed&&active<concurrency&&queue.length){const job=queue.shift();active++;
    const worker=new Worker(new URL('./analysis-worker.js',import.meta.url),{workerData:{operation:job.operation,input:job.input},resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32,stackSizeMb:4}});
    workers.add(worker);let finished=false;
    const timer=setTimeout(()=>finish(Object.assign(new Error('Analysis exceeded the '+timeoutMs+' ms worker limit. Reduce workspace complexity.'),{status:422})),timeoutMs);
    function finish(error,result){if(finished)return;finished=true;clearTimeout(timer);workers.delete(worker);void worker.terminate();active--;if(error)job.reject(error);else job.resolve(result);drain();}
    worker.once('message',message=>message.ok?finish(null,message.result):finish(new Error(message.error)));
    worker.once('error',error=>finish(Object.assign(new Error('Compiler worker failed: '+error.message),{status:422})));
    worker.once('exit',code=>{if(!finished)finish(Object.assign(new Error('Compiler worker exited before completing analysis ('+code+').'),{status:422}));});
  }}
  return {
    run(operation,input){return new Promise((resolve,reject)=>{if(closed)return reject(Object.assign(new Error('Server shutting down.'),{status:503}));if(active>=concurrency&&queue.length>=queueLimit)return reject(Object.assign(new Error('Analysis queue is full. Retry when an existing run finishes.'),{status:429}));queue.push({operation,input,resolve,reject});drain();});},
    close(){closed=true;for(const job of queue.splice(0))job.reject(Object.assign(new Error('Server shutting down.'),{status:503}));for(const worker of workers)void worker.terminate();}
  };
}
