import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { demoWorkspace } from '../core/engine.js';
import { createJobRunner } from './job-runner.js';
import { reviewCapabilities, suggestReview } from './suggestions.js';
import { openStore } from './store.js';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const MAX_BODY=2_200_000;
function send(res,status,value,type='application/json; charset=utf-8') {res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin'});res.end(type.startsWith('application/json')?JSON.stringify(value):value);}
async function body(req) {
  if(!req.headers['content-type']?.startsWith('application/json'))throw Object.assign(new Error('Content-Type must be application/json.'),{status:415});
  if(Number(req.headers['content-length'])>MAX_BODY)throw Object.assign(new Error('Request body exceeds 2.2 MB.'),{status:413});
  let length=0;const chunks=[];
  for await(const chunk of req){length+=chunk.length;if(length>MAX_BODY)throw Object.assign(new Error('Request body exceeds 2.2 MB.'),{status:413});chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Invalid JSON request.'),{status:400});}
}
export function createApp({database=process.env.CHANGEWEAVE_DB||resolve(ROOT,'data/changeweave.sqlite'),webRoot=resolve(ROOT,'web'),llmEnv=process.env,llmFetch=globalThis.fetch}={}) {
  const store=openStore(database),jobs=createJobRunner();
  const server=http.createServer(async(req,res)=>{
    try {
      const host=req.headers.host || '';
      if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))return send(res,403,{error:'This development server accepts localhost hosts only.'});
      if(req.headers.origin && req.headers.origin!==`http://${host}`)return send(res,403,{error:'Cross-origin requests are disabled.'});
      const url=new URL(req.url,'http://'+host),path=decodeURIComponent(url.pathname);
      if(path==='/healthz')return send(res,200,{ok:true,service:'changeweave',version:'0.1.0'});
      if(req.method==='GET'&&path==='/api/capabilities')return send(res,200,reviewCapabilities(llmEnv));
      if(req.method==='GET'&&path==='/api/demo')return send(res,200,demoWorkspace());
      if(req.method==='GET'&&path==='/api/runs')return send(res,200,store.list());
      const match=/^\/api\/runs\/([a-z0-9-]+)(?:\/(patches|workspace))?$/.exec(path);
      if(req.method==='GET'&&match){const run=store.get(match[1]);if(!run)return send(res,404,{error:'Run not found.'});
        if(match[2]==='patches'){res.setHeader('Content-Disposition',`attachment; filename="${run.id}.patch"`);return send(res,200,run.patches.map(p=>p.diff).join('\n'),'text/plain; charset=utf-8');}
        if(match[2]==='workspace'){res.setHeader('Content-Disposition',`attachment; filename="${run.id}-workspace.json"`);return send(res,200,run.patchedWorkspace);}
        return send(res,200,run);
      }
      if(req.method==='POST'&&(path==='/api/analyze'||path==='/api/migrate'||path==='/api/suggest')){
        const input=await body(req);if(!input||typeof input!=='object')return send(res,400,{error:'Request object required.'});
        const result=await jobs.run(path==='/api/analyze'?'analyze':'migrate',input);
        if(path==='/api/suggest')return send(res,200,await suggestReview({workspace:input.workspace,run:result},{env:llmEnv,fetchImpl:llmFetch}));
        if(path==='/api/migrate'){result.id='run-'+randomUUID();store.save(result);}
        return send(res,200,result);
      }
      if(path.startsWith('/api/'))return send(res,404,{error:'Endpoint not found.'});
      if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'Method not allowed.'});
      if(path.split('/').some(p=>p==='..'||p.startsWith('.'))||path.includes('\\')||path.includes('\0'))return send(res,400,{error:'Invalid asset path.'});
      let file=resolve(webRoot,'.'+(path==='/'?'/index.html':path));
      if(!file.startsWith(resolve(webRoot)+sep))return send(res,403,{error:'Invalid asset path.'});
      try{if(!(await stat(file)).isFile())return send(res,404,{error:'File not found.'});const buffer=await readFile(file);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png'};
        const type=types[extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:buffer);
      }catch{return send(res,404,{error:'Build the web assets, then open this address again.'});}
    }catch(error){const stale=error.message?.startsWith('STALE_WORKSPACE');send(res,error.status||(stale?409:400),{error:error.message||'Request failed.'});}
  });
  server.requestTimeout=20_000;server.headersTimeout=10_000;server.keepAliveTimeout=5_000;
  server.on('close',()=>{jobs.close();store.close();});return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||4311);createApp().listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`ChangeWeave: http://127.0.0.1:${port}`));
}
