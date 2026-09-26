# Architecture and implementation decisions

## Data model

A workspace is an explicit snapshot, with `id`, `name`, `repositories`, `contract`, `recipes`, and `fixtures`. Each repository has an ID, display name, dependencies, and a map of relative `.ts`/`.tsx` paths to source text. Before/after OpenAPI documents supply component schemas. A recipe identifies the supported operation and its target.

This model makes input reproducible, reviewable, and portable. It does not model Git branches, full npm workspaces, private registries, package exports, or external declarations. Those need separate integrations.

## Analysis path

1. Validate identifiers, relative paths, source sizes, dependency references, recipes, and fixture count.
2. Create virtual source files under `/repos/<repository>/<path>`.
3. Create a strict TypeScript program with a minimal virtual standard library.
4. Find the selected interface-property symbol, then inspect references and contextual types.
5. Derive imports across repository boundaries and merge them with explicit dependencies.
6. Compare component schemas, collect diagnostics, and generate a stable workspace fingerprint.

The fingerprint is FNV-1a64 over a stable serialization. Its purpose is accidental stale-workspace detection. It is not cryptographic authentication, a permission check, or a collision-proof content identifier.

## Semantic edits

A rename operates on symbols rather than a global text replacement. The analyzer handles typed direct access, string literal access, contextual object literals, shorthand properties, and destructuring aliases. For example:

```ts
const { priceCents } = product;
```

becomes:

```ts
const { amountMinor: priceCents } = product;
```

The local variable keeps its name. An unrelated `AdBid.priceCents` resolves to another symbol and is left alone. Access through `any` or computed keys is recorded for review. A target-name collision blocks the rename.

Edits are applied from the end of the file to the beginning so earlier character offsets remain valid. Export uses a deterministic full-file unified hunk, with explicit handling of missing terminal newlines.

## Dependency graph

Edges point from consumer to dependency. Tarjan's strongly connected components traversal finds cycles; dependencies appear before dependents in the returned order. A component with multiple nodes, or a self-loop, requires coordinated rollout review. A displayed order alone is not a safe deployment plan for a breaking change.

For `V` repositories and `E` dependency edges, the SCC traversal is `O(V + E)` before deterministic presentation sorting. Sorting members can add `O(V log V)` in the worst case. Building the graph also requires compiler/import resolution work.

## Verification levels

| Check | Meaning | What it does not prove |
| --- | --- | --- |
| Before/after compiler diagnostics | The virtual program type-checks against the supplied files and small virtual library. | Full project build, third-party package compatibility, or runtime behavior. |
| Explicit fixture transformation | A supported rename yields the expected supplied payload. | Behavior on all possible inputs. |
| Component-schema fixture check | Supplied payloads satisfy the implemented schema subset. | Full OpenAPI/JSON Schema conformance. |
| Provider/consumer matrix | Four combinations pass/fail/are unknown for the supplied schemas and fixtures. | Live service interoperability or rollout safety. |
| `verified` result | Supported checks pass and no tracked unresolved cases remain. | A guarantee that applying the patch is safe. |

Unsupported schema keywords produce `unknown`. Required-field/type-change recipes identify the need for a business rule without inventing conversions. A rename run can produce useful patches while still returning `needs-review`.

## Complexity and performance

Let `S` be source size, `M` AST nodes, and `P` edits. Two fresh TypeScript programs are created per migration. Compiler parsing, module resolution, and type-checking dominate many runs; no simple linear bound is claimed for the entire migration. AST inspection adds work proportional to visited nodes plus compiler lookups. Duplicate-edit checking can be quadratic in the number of edits within a file. Sorting edits costs `O(P log P)`, and repeated string slicing can cost more than linear in file size.

The API runs compiler analyses in worker threads with two active jobs, four queued jobs, a 15-second deadline, and a 256 MB old-generation memory cap per worker. Excess admission returns 429; deadline expiry returns a failed result. The browser executes its own bounded workspace analysis without these Node worker controls. Cross-run caching, user cancellation, and broader source imports belong on the roadmap. [Benchmarking](benchmarking.md) describes the actual measurement, without equating a tiny fixture with production throughput.

## Persistence and serving

Node's built-in SQLite module stores JSON run snapshots in WAL mode. Latest-run listing is limited to 100 rows; retention/deletion policy is future work. The HTTP layer accepts localhost hostnames, rejects cross-origin requests, limits body size, and serves bundled local assets. These are development boundaries, not production authentication.

The browser uses the same compiler-backed core. The build bundles a pinned TypeScript compiler; no CDN is required at runtime. The interface performs quick analysis locally. With the API connected, migration requests use the bounded server workers and persist their returned runs in SQLite. Startup loads recent server runs, and opening a saved run restores its source workspace for review. Without the API, migrations use the browser core and history uses localStorage. Browser-only records are not automatically imported into SQLite. Both analysis paths should produce the same semantics for supported input.

## Design choices

- **SQLite first:** easy reproducible local startup; a shared multi-user service would require isolation, migrations, and a stronger storage design.
- **Explicit recipes:** a constrained transformation makes verification useful. The optional model adapter proposes structured review notes separately; it cannot mutate or execute generated patches.
- **JSON snapshots:** reproducible artifacts avoid accidental execution of downloaded project scripts.
- **Qualified output:** ambiguity is useful product information, not a reason to hide the result.

## Optional AI review

`POST /api/suggest` analyzes the supplied workspace and builds a bounded context from unresolved findings and affected files. The provider receives at most five snippets / 6,000 source characters. Structured output can contain only allowed repository/file pairs, a bounded reason, and an optional bounded proposed-code snippet. Unknown paths, extra keys, oversized responses, malformed JSON, and provider errors are rejected or reported.

The adapter does not prove the suggestions correct. No provider-generated snippet enters the compiler patch flow automatically. A twelve-second network deadline and 64 KB response bound limit the request. API credentials remain on the server. Tests use a mocked provider; no live model evaluation is claimed.
