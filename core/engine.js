import { demoWorkspace } from './demo.js';
export { demoWorkspace };
let compiler;
export function setCompiler(ts) { if (!ts?.createProgram) throw new Error('A TypeScript compiler API is required.'); compiler = ts; }
const tsApi = () => { const value = compiler || globalThis.ts; if (!value?.createProgram) throw new Error('Call setCompiler(ts) before running analysis.'); return value; };
const clone = value => JSON.parse(JSON.stringify(value));
const now = () => globalThis.performance?.now() ?? Date.now();
const textName = (node) => node?.text ?? node?.escapedText?.toString();
const simplePath = value => typeof value === 'string' && value.length <= 180 && !value.includes('\\') && !value.startsWith('/') && !value.split('/').some(p => !p || p === '.' || p === '..') && !value.includes('\0');
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);

export function validateWorkspace(input) {
  if (!input || typeof input !== 'object' || !safeId(input.id) || typeof input.name !== 'string' || input.name.length > 180) throw new Error('Workspace needs a safe id and a name of at most 180 characters.');
  if (!Array.isArray(input.repositories) || input.repositories.length < 1 || input.repositories.length > 24) throw new Error('Provide 1–24 repositories.');
  let bytes = 0, count = 0;
  const ids = new Set();
  for (const repo of input.repositories) {
    if (!safeId(repo.id) || ids.has(repo.id)) throw new Error('Repository ids must be safe and unique.');
    ids.add(repo.id);
    if (typeof repo.name !== 'string' || repo.name.length > 180 || !repo.files || Array.isArray(repo.files) || typeof repo.files !== 'object') throw new Error('Each repository needs a name and files object.');
    for (const [path, source] of Object.entries(repo.files)) {
      if (!simplePath(path) || !/\.(ts|tsx)$/.test(path)) throw new Error(`Unsafe or unsupported file path: ${path}`);
      if (typeof source !== 'string' || source.length > 150_000) throw new Error(`Source exceeds per-file limit: ${path}`);
      bytes += source.length; count++;
    }
    if (!Array.isArray(repo.dependencies) || repo.dependencies.some(id => !safeId(id))) throw new Error('dependencies must be an array of repository ids.');
  }
  if (bytes > 1_000_000 || count > 120) throw new Error('Workspace exceeds 1 MB of source or 120 files.');
  for (const repo of input.repositories) if (repo.dependencies.some(id => !ids.has(id))) throw new Error(`Unknown dependency in ${repo.id}.`);
  if (!Array.isArray(input.recipes) || input.recipes.length > 16) throw new Error('Provide up to 16 recipes.');
  const recipeIds = new Set();
  for (const recipe of input.recipes) {
    if (!safeId(recipe.id) || recipeIds.has(recipe.id) || !['rename-property','required-field','type-change'].includes(recipe.kind)) throw new Error('Invalid or duplicate migration recipe.');
    recipeIds.add(recipe.id);
    if (recipe.kind === 'rename-property' && (![recipe.from,recipe.to].every(s => typeof s === 'string' && /^[A-Za-z_$][\w$]{0,79}$/.test(s)) || recipe.from === recipe.to || !Array.isArray(recipe.typeNames) || !recipe.typeNames.length)) throw new Error('Rename recipes require distinct valid field names and target typeNames.');
    if (recipe.targetRepository && !ids.has(recipe.targetRepository)) throw new Error('Unknown target repository.');
    if (recipe.targetFile && !simplePath(recipe.targetFile)) throw new Error('Unsafe target file.');
    if (recipe.kind !== 'rename-property' && (typeof recipe.field !== 'string' || !/^[A-Za-z_$][\w$]{0,79}$/.test(recipe.field))) throw new Error('Recipe requires a valid field.');
  }
  if (!input.contract?.before?.components?.schemas || !input.contract?.after?.components?.schemas) throw new Error('Before and after OpenAPI components.schemas are required.');
  if (!Array.isArray(input.fixtures) || input.fixtures.length > 100) throw new Error('Provide at most 100 fixtures.');
  const serialized = JSON.stringify(input);
  if (serialized.length > 2_000_000) throw new Error('Workspace JSON exceeds 2 MB.');
  if (/"(?:__proto__|prototype|constructor)"\s*:/.test(serialized)) throw new Error('Reserved object keys are not supported.');
  return input;
}

// Stable content fingerprint, for stale-run detection (not authentication).
export function fingerprint(value) {
  function stable(v) { if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'; if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+stable(v[k])).join(',') + '}'; return JSON.stringify(v); }
  const s = stable(value); let hash = 0xcbf29ce484222325n;
  for (let i=0; i<s.length; i++) { hash ^= BigInt(s.charCodeAt(i)); hash = BigInt.asUintN(64, hash * 0x100000001b3n); }
  return 'fnv1a64:' + hash.toString(16).padStart(16,'0');
}

const LIB = `interface Object {}\ninterface Function {}\ninterface CallableFunction extends Function {}\ninterface NewableFunction extends Function {}\ninterface IArguments { [index: number]: any; length: number; }\ninterface String { readonly length: number; toUpperCase(): string; toLowerCase(): string; }\ninterface Number { toFixed(digits?: number): string; }\ninterface Boolean {}\ninterface RegExp {}\ninterface Array<T> { [index: number]: T; length: number; map<U>(fn: (value: T, index: number) => U): U[]; reduce<U>(fn: (acc: U, value: T) => U, initial: U): U; filter(fn: (value: T) => boolean): T[]; }\ninterface ReadonlyArray<T> { readonly [index: number]: T; readonly length: number; }\ntype Record<K extends string | number | symbol, T> = { [P in K]: T };\ntype Partial<T> = { [P in keyof T]?: T[P] };\n`;
function virtualFiles(workspace) {
  const files = new Map([['/lib.d.ts', LIB]]);
  for (const repo of workspace.repositories) for (const [path,text] of Object.entries(repo.files)) files.set('/repos/'+repo.id+'/'+path,text);
  return files;
}
function location(file) { const match = /^\/repos\/([^/]+)\/(.+)$/.exec(file); return {repository:match?.[1] || '',file:match?.[2] || file}; }
function makeProgram(workspace) {
  const ts=tsApi(), files=virtualFiles(workspace);
  const options={strict:true,noEmit:true,noLib:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,jsx:ts.JsxEmit.Preserve,skipLibCheck:true};
  const host={getSourceFile:(name,version)=>files.has(name)?ts.createSourceFile(name,files.get(name),version,true):undefined,readFile:name=>files.get(name),fileExists:name=>files.has(name),writeFile:()=>{},getCurrentDirectory:()=> '/',getDefaultLibFileName:()=>'/lib.d.ts',getDirectories:()=>[],directoryExists:path=>[...files.keys()].some(f=>f.startsWith(path.replace(/\/$/,'')+'/')),getCanonicalFileName:name=>name,useCaseSensitiveFileNames:()=>true,getNewLine:()=> '\n'};
  host.resolveModuleNames=(names,containing)=>names.map(name=>ts.resolveModuleName(name,containing,options,host).resolvedModule);
  const program=ts.createProgram([...files.keys()],options,host), checker=program.getTypeChecker();
  return {ts,program,checker,files,host,options};
}
function diagnosticsOf(ctx) {
  return ctx.ts.getPreEmitDiagnostics(ctx.program).filter(d=>d.file?.fileName !== '/lib.d.ts').map(d=>{const point=d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start):{line:0,character:0};return {...location(d.file?.fileName || ''),line:point.line+1,column:point.character+1,code:d.code,message:ctx.ts.flattenDiagnosticMessageText(d.messageText,'\n')};});
}

export function diffContracts(before, after) {
  const changes=[]; const add=(path,kind,severity,a,b,description)=>changes.push({id:'change-'+(changes.length+1),path,kind,severity,before:a??null,after:b??null,description});
  const visit=(a,b,path)=>{
    if (a === undefined) {add(path,'added','info',a,b,'Schema or field added.');return;}
    if (b === undefined) {add(path,'removed','breaking',a,b,'Schema or field removed.');return;}
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {if(JSON.stringify(a)!==JSON.stringify(b)) add(path,'changed','review',a,b,'Schema value changed.');return;}
    if (a.type !== b.type) add(path,'type-changed','breaking',a.type,b.type,'Type changed; consumers may need a conversion rule.');
    if (JSON.stringify(a.enum)!==JSON.stringify(b.enum)) add(path+'/enum','enum-changed','review',a.enum,b.enum,'Allowed values changed; direction-specific compatibility requires review.');
    const ar=new Set(a.required || []), br=new Set(b.required || []);
    for (const field of br) if(!ar.has(field)) add(path+'/required/'+field,'newly-required','breaking',false,true,'Existing payloads may omit this newly required field.');
    for (const field of ar) if(!br.has(field)) add(path+'/required/'+field,'no-longer-required','review',true,false,'Consumers may still depend on the field being present.');
    for (const field of new Set([...Object.keys(a.properties || {}),...Object.keys(b.properties || {})])) visit(a.properties?.[field],b.properties?.[field],path+'/properties/'+field);
    if(a.items || b.items) visit(a.items,b.items,path+'/items');
    for(const key of ['minimum','maximum','minLength','maxLength','pattern','additionalProperties','$ref','nullable','allOf','oneOf','anyOf','not']) if(JSON.stringify(a[key])!==JSON.stringify(b[key])) add(path+'/'+key,'constraint-changed','review',a[key],b[key],'Constraint changed; verify payload compatibility.');
  };
  const a=before.components?.schemas || {}, b=after.components?.schemas || {};
  for(const name of new Set([...Object.keys(a),...Object.keys(b)])) visit(a[name],b[name],'#/components/schemas/'+name);
  if(JSON.stringify(before.paths || {})!==JSON.stringify(after.paths || {})) add('#/paths','operation-changed','review',before.paths,after.paths,'Operation definitions changed; automated migration covers component fields only.');
  return changes;
}
function selectedContract(workspace,recipe) {
  if(recipe.kind==='rename-property') return {before:workspace.contract.before,after:workspace.contract.after};
  const before=workspace.contract.before, after=clone(before), s=after.components.schemas[recipe.schemaName || 'Product'];
  if(!s) throw new Error('Recipe schema not found.');
  s.properties[recipe.field]=clone(recipe.fieldSchema || {type:'string'});
  if(recipe.kind==='required-field') s.required=[...new Set([...(s.required || []),recipe.field])];
  return {before,after};
}
function recipeContractReview(contract,recipe) {
  if(recipe.kind!=='rename-property')return [];
  const name=recipe.schemaName || recipe.typeNames?.[0],before=contract.before.components.schemas[name],after=contract.after.components.schemas[name];
  if(!before?.properties?.[recipe.from] || !after?.properties?.[recipe.to] || own(after.properties,recipe.from) || own(before.properties,recipe.to))return [{kind:'contract-recipe-mismatch',message:'The selected schema must remove the original field and add the new field for this explicit rename recipe.'}];
  const expected=clone(before);expected.properties[recipe.to]=expected.properties[recipe.from];delete expected.properties[recipe.from];
  if(expected.required)expected.required=expected.required.map(k=>k===recipe.from?recipe.to:k);
  if(fingerprint(expected)!==fingerprint(after))return [{kind:'additional-contract-change',message:'The target schema contains changes beyond this field rename. Supply separate transformation rules and fixtures.'}];
  const otherBefore=clone(contract.before),otherAfter=clone(contract.after);delete otherBefore.components.schemas[name];delete otherAfter.components.schemas[name];
  if(fingerprint(otherBefore)!==fingerprint(otherAfter))return [{kind:'additional-contract-change',message:'Other API definitions changed outside the selected field migration; review those changes separately.'}];
  return [];
}
function selectRecipe(workspace,id) { const recipe=workspace.recipes.find(r=>r.id===(typeof id==='object'?id.id:id)) || (!id?workspace.recipes[0]:null); if(!recipe) throw new Error('Unknown migration recipe.'); return recipe; }
function sourcePoint(node,source) {const p=source.getLineAndCharacterOfPosition(node.getStart(source));return {line:p.line+1,column:p.character+1};}
function targetAnalysis(workspace,recipe,ctx) {
  const {ts,checker,program}=ctx, targets=new Set(), targetTypes=new Set(), edits=new Map(), impacts=[], unresolved=[];
  const sources=program.getSourceFiles().filter(s=>s.fileName.startsWith('/repos/'));
  function addEdit(source,node,text,kind) {
    const start=node.getStart(source),end=node.end, arr=edits.get(source.fileName)||[];
    if(!arr.some(e=>e.start===start && e.end===end)) arr.push({start,end,text,kind}); edits.set(source.fileName,arr);
    const loc=location(source.fileName), p=sourcePoint(node,source);
    impacts.push({...loc,...p,kind,symbol:recipe.from,preview:source.text.split('\n')[p.line-1].trim()});
  }
  for(const source of sources) {
    const loc=location(source.fileName);
    if(recipe.targetRepository && loc.repository!==recipe.targetRepository || recipe.targetFile && loc.file!==recipe.targetFile) continue;
    const visit=node=>{
      if(ts.isInterfaceDeclaration(node) && recipe.typeNames.includes(node.name.text)) {
        targetTypes.add(checker.getTypeAtLocation(node));
        for(const member of node.members) if(ts.isPropertySignature(member)&&textName(member.name)===recipe.from) {const symbol=checker.getSymbolAtLocation(member.name);if(symbol) targets.add(symbol);}
      }
      ts.forEachChild(node,visit);
    };visit(source);
  }
  const targetOnType=(type)=> {
    if(!type) return false;
    if(type.isUnion?.()) { const members=type.types.filter(t=>!(t.flags&(ts.TypeFlags.Undefined|ts.TypeFlags.Null))); return members.length>0 && members.every(targetOnType); }
    const symbol=checker.getPropertyOfType(type,recipe.from);return !!symbol && targets.has(symbol);
  };
  const hasDynamic=type=>!!(type.flags&(ts.TypeFlags.Any|ts.TypeFlags.Unknown));
  function unknown(source,node,message) {const p=sourcePoint(node,source);unresolved.push({kind:'dynamic-access',...location(source.fileName),...p,message});}
  for(const source of sources) {
    const visit=node=>{
      if(ts.isPropertySignature(node) && targets.has(checker.getSymbolAtLocation(node.name))) addEdit(source,node.name,recipe.to,'declaration');
      else if(ts.isPropertyAccessExpression(node) && node.name.text===recipe.from) {
        const type=checker.getTypeAtLocation(node.expression);
        if(targetOnType(type)) addEdit(source,node.name,recipe.to,'typed-property-access');
        else if(hasDynamic(type)) unknown(source,node,'Access through any/unknown may reference the migrated payload; review the runtime contract.');
      } else if(ts.isElementAccessExpression(node)) {
        const type=checker.getTypeAtLocation(node.expression),arg=node.argumentExpression;
        if(arg&&ts.isStringLiteralLike(arg)&&arg.text===recipe.from) {if(targetOnType(type)) addEdit(source,arg,JSON.stringify(recipe.to),'typed-element-access');else if(hasDynamic(type)) unknown(source,node,'Dynamic object with matching string key requires review.');}
        else if(targetOnType(type) && arg && !ts.isStringLiteralLike(arg)) unknown(source,node,'Computed property key may refer to the renamed field; no automatic change was made.');
      } else if((ts.isPropertyAssignment(node)||ts.isShorthandPropertyAssignment(node)) && ts.isObjectLiteralExpression(node.parent)) {
        const type=checker.getContextualType(node.parent),name=textName(node.name);
        if(name===recipe.from && targetOnType(type)) {
          if(ts.isShorthandPropertyAssignment(node)) addEdit(source,node,recipe.to+': '+node.name.getText(source),'typed-object-shorthand');
          else addEdit(source,node.name,ts.isStringLiteralLike(node.name)?JSON.stringify(recipe.to):recipe.to,'typed-object-property');
        }
      } else if(ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        const pattern=node.parent, name=textName(node.propertyName || node.name),type=checker.getTypeAtLocation(pattern);
        if(name===recipe.from&&targetOnType(type)) {
          if(node.propertyName) addEdit(source,node.propertyName,recipe.to,'typed-destructuring');
          else addEdit(source,node.name,recipe.to+': '+node.name.getText(source),'typed-destructuring-alias');
        }
      }
      ts.forEachChild(node,visit);
    };visit(source);
  }
  if(!targets.size) unresolved.push({kind:'missing-target',message:'No matching interface field declaration was found in the selected target.'});
  for(const type of targetTypes) if(checker.getPropertyOfType(type,recipe.to)) unresolved.push({kind:'name-collision',message:`Target type already declares ${recipe.to}; automatic migration was blocked.`});
  return {edits,impacts,unresolved,targetCount:targets.size};
}

export function dependencyGraph(workspace, affectedRepositories=new Set(), context) {
  const dependencies=new Map(workspace.repositories.map(r=>[r.id,new Set(r.dependencies)]));
  if(context) for(const source of context.program.getSourceFiles()) {
    const repo=location(source.fileName).repository;if(!dependencies.has(repo))continue;
    for(const stmt of source.statements) if(context.ts.isImportDeclaration(stmt)&&context.ts.isStringLiteral(stmt.moduleSpecifier)) {
      const resolved=context.ts.resolveModuleName(stmt.moduleSpecifier.text,source.fileName,context.options,context.host).resolvedModule;
      const target=resolved&&location(resolved.resolvedFileName).repository;
      if(target&&target!==repo&&dependencies.has(target)) dependencies.get(repo).add(target);
    }
  }
  let counter=0;const indexes=new Map(), low=new Map(),stack=[],onStack=new Set(),cycles=[],order=[];
  function visit(id) {indexes.set(id,counter);low.set(id,counter++);stack.push(id);onStack.add(id);
    for(const dep of dependencies.get(id)) {if(!indexes.has(dep)){visit(dep);low.set(id,Math.min(low.get(id),low.get(dep)));}else if(onStack.has(dep))low.set(id,Math.min(low.get(id),indexes.get(dep)));}
    if(low.get(id)===indexes.get(id)){const group=[];let item;do{item=stack.pop();onStack.delete(item);group.push(item);}while(item!==id);if(group.length>1||dependencies.get(id).has(id))cycles.push(group);order.push(...group.sort());}
  }
  for(const id of dependencies.keys())if(!indexes.has(id))visit(id);
  return {nodes:workspace.repositories.map(r=>({id:r.id,name:r.name,affected:affectedRepositories.has(r.id)})),edges:[...dependencies].flatMap(([from,deps])=>[...deps].map(to=>({from,to}))),cycles,order};
}

function analyzeInternal(workspace,recipeId) {
  const started=now();validateWorkspace(workspace);const recipe=selectRecipe(workspace,recipeId),ctx=makeProgram(workspace),contract=selectedContract(workspace,recipe);
  const target=recipe.kind==='rename-property'?targetAnalysis(workspace,recipe,ctx):{edits:new Map(),impacts:[],unresolved:[{kind:'business-rule',message:recipe.description || 'This contract change requires an explicit business transformation.'}],targetCount:0};
  target.unresolved.push(...recipeContractReview(contract,recipe));
  const affected=new Set(target.impacts.map(i=>i.repository)),graph=dependencyGraph(workspace,affected,ctx);
  const warnings=['Compilation uses a small documented virtual standard library; external packages and runtime behavior are not verified.','Contract analysis covers component schemas; operation changes are reported for human review.'];
  if(graph.cycles.length) warnings.push('Dependency cycles require coordinated rollout; the displayed order is not a safe independent deployment sequence.');
  const symbolSet=new Set();for(const s of ctx.program.getSourceFiles())if(s.fileName.startsWith('/repos/')){const visit=n=>{if(ctx.ts.isIdentifier(n)){const symbol=ctx.checker.getSymbolAtLocation(n);if(symbol)symbolSet.add(symbol);}ctx.ts.forEachChild(n,visit);};visit(s);}const symbols=symbolSet.size;
  const result={workspaceId:workspace.id,workspaceName:workspace.name,fingerprint:fingerprint(workspace),recipe:clone(recipe),stats:{repositories:workspace.repositories.length,files:workspace.repositories.reduce((n,r)=>n+Object.keys(r.files).length,0),symbols,affectedFiles:new Set(target.impacts.map(i=>i.repository+'/'+i.file)).size,affectedRepositories:affected.size},contractChanges:diffContracts(contract.before,contract.after),impacts:target.impacts,graph,diagnostics:diagnosticsOf(ctx),warnings,durationMs:Math.round((now()-started)*100)/100};
  return {result,target,contract,ctx};
}
export function analyzeWorkspace(workspace,recipeId='rename-price') {return analyzeInternal(workspace,recipeId).result;}

function resolveSchema(schema,document,seen=new Set()) {
  if(!schema?.$ref)return schema;
  if(!schema.$ref.startsWith('#/components/schemas/')||seen.has(schema.$ref))return null;
  seen.add(schema.$ref);return resolveSchema(document.components.schemas[schema.$ref.slice('#/components/schemas/'.length)],document,seen);
}
export function checkPayload(value,schema,document,path='$') {
  schema=resolveSchema(schema,document);if(!schema)return {status:'unknown',errors:[path+': unsupported or cyclic reference']};
  const unsupported=Object.keys(schema).filter(k=>!['type','properties','required','additionalProperties','items','enum','minimum','maximum','minLength','maxLength','description','title','example','default','$ref'].includes(k));
  if(unsupported.length)return {status:'unknown',errors:[path+': unsupported schema keywords '+unsupported.join(', ')]};
  let errors=[];const actual=value===null?'null':Array.isArray(value)?'array':typeof value;
  if(schema.type==='integer' ? !Number.isInteger(value) : schema.type && actual!==schema.type)errors.push(path+': expected '+schema.type);
  if(schema.enum&&!schema.enum.some(x=>JSON.stringify(x)===JSON.stringify(value)))errors.push(path+': value not in enum');
  if(typeof value==='number'){if(schema.minimum!==undefined&&value<schema.minimum)errors.push(path+': below minimum');if(schema.maximum!==undefined&&value>schema.maximum)errors.push(path+': above maximum');}
  if(typeof value==='string'){if(schema.minLength!==undefined&&value.length<schema.minLength)errors.push(path+': too short');if(schema.maxLength!==undefined&&value.length>schema.maxLength)errors.push(path+': too long');}
  let unknown=false;
  if(value && actual==='object'){for(const key of schema.required || [])if(!own(value,key))errors.push(path+'.'+key+': missing required field');
    for(const [key,v] of Object.entries(value)){if(schema.properties?.[key]){const checked=checkPayload(v,schema.properties[key],document,path+'.'+key);unknown ||= checked.status==='unknown';errors.push(...checked.errors);}else if(schema.additionalProperties===false)errors.push(path+'.'+key+': additional field');else if(schema.additionalProperties&&typeof schema.additionalProperties==='object'){const checked=checkPayload(v,schema.additionalProperties,document,path+'.'+key);unknown ||= checked.status==='unknown';errors.push(...checked.errors);}}
  }
  if(Array.isArray(value)&&schema.items)for(let i=0;i<value.length;i++){const checked=checkPayload(value[i],schema.items,document,path+'['+i+']');unknown ||= checked.status==='unknown';errors.push(...checked.errors);}
  return {status:unknown?'unknown':errors.length?'failed':'passed',errors};
}
function migrationFixture(payload,recipe) {
  const value=clone(payload);
  if(recipe.kind==='rename-property'&&value&&typeof value==='object'&&!Array.isArray(value)&&own(value,recipe.from)){value[recipe.to]=value[recipe.from];delete value[recipe.from];}
  return value;
}
function sameValue(a,b) {return fingerprint(a)===fingerprint(b);}
function unifiedDiff(file,before,after) {
  // Full-file hunk keeps patch generation deterministic; GNU git apply accepts it.
  const a=before.split('\n'),b=after.split('\n');if(a.at(-1)==='')a.pop();if(b.at(-1)==='')b.pop();
  let out=`--- a/${file}\n+++ b/${file}\n@@ -${a.length?1:0},${a.length} +${b.length?1:0},${b.length} @@\n`;
  for(let i=0;i<a.length;i++){out+='-'+a[i]+'\n';if(i===a.length-1&&!before.endsWith('\n'))out+='\\ No newline at end of file\n';}
  for(let i=0;i<b.length;i++){out+='+'+b[i]+'\n';if(i===b.length-1&&!after.endsWith('\n'))out+='\\ No newline at end of file\n';}
  return out;
}
export function runMigration(workspace,recipeId='rename-price',expectedFingerprint) {
  const {result,target,contract}=analyzeInternal(workspace,recipeId),recipe=result.recipe;
  if(expectedFingerprint&&expectedFingerprint!==result.fingerprint)throw new Error('STALE_WORKSPACE: source or configuration changed; analyze the latest workspace before migrating.');
  const patched=clone(workspace),patches=[],unresolved=[...target.unresolved];
  if(result.graph.cycles.length)unresolved.push({kind:'dependency-cycle',message:'Review coordinated rollout for the detected dependency cycle.'});
  if(!target.unresolved.some(i=>['name-collision','contract-recipe-mismatch'].includes(i.kind)))for(const [path,edits] of target.edits) {
    const loc=location(path),repo=patched.repositories.find(r=>r.id===loc.repository),before=repo.files[loc.file];let after=before;
    for(const edit of [...edits].sort((a,b)=>b.start-a.start)){after=after.slice(0,edit.start)+edit.text+after.slice(edit.end);}
    repo.files[loc.file]=after;patches.push({...loc,before,after,edits,diff:unifiedDiff(loc.repository+'/'+loc.file,before,after)});
  }
  const afterDiagnostics=diagnosticsOf(makeProgram(patched));
  const schemaName=recipe.schemaName || recipe.typeNames?.[0] || 'Product',beforeSchema=contract.before.components.schemas[schemaName],afterSchema=contract.after.components.schemas[schemaName];
  if(!beforeSchema||!afterSchema)unresolved.push({kind:'schema-not-found',message:'Recipe schema missing from before or after contract.'});
  const fixtures=workspace.fixtures.map(f=>{
    const transformed=migrationFixture(f.before,recipe),a=checkPayload(f.before,beforeSchema,contract.before),b=checkPayload(transformed,afterSchema,contract.after);
    const expected=recipe.kind==='rename-property' && f.after!==undefined ? sameValue(transformed,f.after):false;
    return {name:f.name,status:a.status==='unknown'||b.status==='unknown'?'unknown':a.status==='passed'&&b.status==='passed'&&expected?'passed':'failed',beforeValid:a.status==='passed',afterValid:b.status==='passed',details:[...a.errors,...b.errors,...(!expected?['Transformed payload does not match an explicit expected fixture.']:[])].join('; ') || 'Explicit rename preserves fixture values; before and after component schemas accept their respective payloads.',actual:transformed,expected:f.after ?? null};
  });
  const combos=[['old','old'],['old','new'],['new','old'],['new','new']];
  const compatibility=combos.map(([provider,consumer])=>{
    const schema=consumer==='old'?beforeSchema:afterSchema,doc=consumer==='old'?contract.before:contract.after;
    const checks=workspace.fixtures.map(f=>checkPayload(provider==='old'?f.before:migrationFixture(f.before,recipe),schema,doc));
    const status=!checks.length||checks.some(c=>c.status==='unknown')?'unknown':checks.every(c=>c.status==='passed')?'passed':'failed';
    return {provider:provider==='old'?'Original provider':'Migrated provider',consumer:consumer==='old'?'Original consumer':'Migrated consumer',status,details:'Component-schema checks over '+checks.length+' supplied fixtures only. '+checks.flatMap(c=>c.errors).slice(0,3).join('; ')};
  });
  if(!fixtures.length)unresolved.push({kind:'missing-fixtures',message:'No explicit before/after fixtures are available.'});
  if(recipe.kind==='rename-property'&&!patches.length)unresolved.push({kind:'no-patches',message:'No supported source patches were produced.'});
  const status=unresolved.length||result.diagnostics.length||afterDiagnostics.length||fixtures.some(f=>f.status!=='passed')?'needs-review':'verified';
  return {...result,id:'run-'+Date.now().toString(36)+'-'+result.fingerprint.slice(-6),createdAt:new Date().toISOString(),status,patches,unresolved,verification:{before:{ok:!result.diagnostics.length,diagnostics:result.diagnostics},after:{ok:!afterDiagnostics.length,diagnostics:afterDiagnostics},fixtures,compatibility,summary:status==='verified'?'Supported compiler and fixture checks passed. Runtime behavior and deployment compatibility remain outside this verification.':'Review unresolved cases and verification results before applying these patches.'},patchedWorkspace:patched};
}
