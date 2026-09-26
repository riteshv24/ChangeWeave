# ChangeWeave engine / UI contract

`core/engine.js` is pure ESM and imports no Node modules. Call `setCompiler(ts)` once with TypeScript compiler API (Node: import ts from 'typescript'; browser bundle or `globalThis.ts`). Then use:

- `demoWorkspace()` -> fresh workspace JSON (also serializable for import/export).
- `analyzeWorkspace(workspace, recipeId = 'rename-price')` -> analysis JSON below, no mutations.
- `runMigration(workspace, recipeId = 'rename-price', expectedFingerprint?)` -> run JSON below; throws on stale expected fingerprint.

Workspace: `{ id, name, repositories: [{id,name,dependencies:string[],files:{'src/file.ts':string}}], contract:{before:OpenAPI,after:OpenAPI}, recipes:[{id,label,kind,from?,to?,typeNames?:string[],description}], fixtures:[{name,before:object,after:object}] }`. Allowed recipe kinds: `rename-property`, `required-field`, `type-change`. Only explicit rename recipes produce patches; other kinds produce review-required findings.

Analysis: `{workspaceId,workspaceName,fingerprint,recipe,stats:{repositories,files,symbols,affectedFiles,affectedRepositories},contractChanges:[{id,path,kind,severity,before,after,description}],impacts:[{repository,file,line,column,kind,symbol,preview}],graph:{nodes:[{id,name,affected}],edges:[{from,to}],cycles:string[][],order:string[]},diagnostics:[{repository,file,line,column,code,message}],warnings:string[],durationMs}`.

Run includes ALL analysis keys, plus `{id,status,createdAt,patches:[{repository,file,before,after,edits:[{start,end,text,kind}],diff}],verification:{before:{ok,diagnostics},after:{ok,diagnostics},fixtures:[{name,status,beforeValid,afterValid,details}],compatibility:[{provider,consumer,status,details}],summary},unresolved:[{kind,file?,line?,message}],patchedWorkspace}`. Status `verified` means compiler + fixtures pass for the supported recipe; `needs-review` means unresolved/unsupported cases or diagnostics. It does not prove runtime behavior. Compatibility is schema-fixture verification only and states that explicitly.

`validateWorkspace(workspace)` returns workspace or throws with descriptive errors. API defaults localhost:4311; GET /api/demo, POST /api/analyze `{workspace,recipeId}`, POST /api/migrate `{workspace,recipeId,expectedFingerprint}`, GET /api/runs, GET /api/runs/:id, GET /api/runs/:id/patches. JSON only, no command execution. Browser UI may use pure core offline and API when available.

## Implemented boundaries

- Four-repository fixture: Catalog API, Storefront, Order Worker, Reporting SDK. `fixtures/commerce-workspace.json` is directly importable.
- `rename-price` patches a specifically selected interface's declaration, typed property/element access, contextual object properties, shorthand object values, and destructuring while preserving local aliases. The unrelated AdBid and legacy analytics `priceCents` fields stay unchanged.
- The demo intentionally includes `raw: any`; this remains unresolved, so its overall status is `needs-review` even when all supported compilation and fixture checks pass.
- Extra contract changes require review. A rename recipe that does not match the before/after schema blocks automatic edits.
- `require-market` and `structured-price` are real structural contract analysis cases that require a human conversion rule. They do not invent patches.
- Compatibility means validation of the supplied JSON fixtures against the supported component-schema subset. It does not execute repository tests, prove all payloads compatible, or establish a safe production rollout. Unsupported schema keywords produce `unknown`.
- Compiler programs use a deliberately small virtual standard library. Package imports, Node/browser globals beyond that library, complex third-party types, and runtime behavior are not verified.
- Typed transformations and evidence are deterministic. Optional server-side AI review is implemented through an OpenAI-compatible chat-completions adapter; its suggestions remain separate and are never applied or executed. Live provider accuracy has not been evaluated.
- Content fingerprints use stable FNV-1a64 for detecting changed inputs, not as a cryptographic authenticity check.
- The dependency graph includes declared repository dependencies and compiler-resolved cross-repository imports. Edges point **consumer → provider**. Tarjan SCC traversal is O(V + E); compiler analysis has its own additional costs. The returned order places providers first, but breaking old/new fixture combinations still require compatibility work before deployment.
- Server mode runs compiler operations in worker threads with 2 active slots, 4 queued requests, a 15-second deadline, and a 256 MB V8 old-generation heap cap. Browser direct-engine usage does not inherit those Node limits.
- The server never executes imported code, package installation commands, tests, or build scripts. API input remains JSON data.
- API persistence is SQLite (Node 24 built-in), capped to the most recent 100 rows when listing; older runs remain accessible by ID. Do not present this localhost development server as a multi-user hosted service.
- Unified patches use repository-prefixed paths and full-file hunks. They were verified with `git apply --check` and apply against the bundled source fixture.

## Optional AI review API

`GET /api/capabilities` returns `{aiReview:{enabled,configured,model?,baseUrl?,reason?}}`, with no API key. `POST /api/suggest` takes `{workspace,recipeId}` and returns:

```json
{
  "mode": "unconfigured | suggestions | unavailable | invalid-response",
  "configured": false,
  "model": "only included when configured",
  "suggestions": [{"repository":"reporting-sdk","file":"src/report.ts","reason":"Review finding","proposedCode":"optional review-only snippet"}],
  "unresolved": [],
  "context": {"files":[{"repository":"reporting-sdk","file":"src/report.ts"}],"characters":1200},
  "message": "Human-readable status"
}
```

Enable only on the local server with `CHANGEWEAVE_ENABLE_LLM=1`, `LLM_API_KEY`, and `LLM_MODEL`. `LLM_BASE_URL` defaults to `https://api.openai.com/v1`; custom endpoints require HTTPS except localhost HTTP. The adapter posts to `/chat/completions` with a 12-second timeout. The UI must invoke this only from an explicit user action that states relevant code snippets will be sent to the configured provider. No secrets belong in browser bundles.

Context is limited to five relevant files and 6000 source characters, with at most 20 shortened unresolved findings. Provider replies must be strict JSON `{suggestions:[...]}`; unknown files, extra fields, more than eight suggestions, reasons over 1200 characters, and proposed code over 4000 characters are rejected. Response body is capped at 64 KB. The entire model response is discarded if one suggestion fails validation. Suggestions are not a patch and have no verified status.

No live model request was made during validation. The provider interface is tested with mocked HTTP responses for success, unavailability, malformed JSON, unknown paths, oversize output, and secret redaction.
