# Roadmap and reviewable PRs

This is a roadmap for a substantial two-person project, not a record of months worked or contributors already involved. The original “70%” target means an agreed weighted delivery plan; no measured completion percentage is claimed. v0.1 closes a bounded workflow: import → analyze → patch → verify supported checks → review → export.

## Shipped scope

- TypeScript interface-property rename analysis with a real compiler.
- Component-schema comparison and explicit fixture verification.
- Repository import/dependency graph, cycle warnings, and stale snapshot checks.
- Local browser workspace, bounded compiler workers, API, SQLite history, and export.
- Optional structured AI review suggestions kept separate from deterministic patches.
- Reproducible demo, tests, and an honest local benchmark harness.

## Planned PR tickets

| Ticket | Proposed owner | Deliverable | Acceptance criteria |
| --- | --- | --- | --- |
| CW-01: Full workspace loader | Engineer A | Parse tsconfig, package exports, project references, and declaration files from a bounded local directory. | Reproduce a multi-package fixture with aliases; reject path escapes; distinguish missing dependencies from valid code; never execute install scripts during import. |
| CW-02: Incremental symbol index | Engineer A | Cache file hashes, semantic dependencies, and affected analysis. | Seeded changed-file runs match full analysis output; shared-type changes invalidate dependents; publish raw cold/warm timings and memory. |
| CW-03: Verification workers | Engineer B | Run approved test commands in disposable containers with timeouts and resource limits. | Network-off default, cancellation, stdout limits, non-root execution, timeout cleanup, and results bound to exact source/config hashes. |
| CW-04: GitHub draft PR integration | Engineer B | Minimal-permission GitHub App with linked migration branches and drafts. | Explicit repository allowlist and user approval; idempotent retry; revoked-access handling; exact source SHA checks; no tokens in logs. |
| CW-05: AI review evaluation | Shared | Evaluate the existing optional review adapter on independently authored ambiguous migrations. | Publish incorrect suggestions and abstention; no silent business defaults; retain strict output validation; compare providers and deterministic review guidance with cost/time measurements. |
| CW-06: Broader schema support | Engineer A | Resolve additional JSON Schema/OpenAPI constructs using a documented dialect. | Differential fixtures for supported keywords; unsupported constructs remain unknown; compatibility direction is explicit. |
| CW-07: Staged migration planner | Shared | Expand/contract migration states with provider/consumer transition constraints. | Cycle cases remain blocked or coordinated; old/new combinations tested; rollout order distinguished from dependency order. |
| CW-08: Java/Spring adapter | Engineer A | Java symbol analysis and API contract extraction. | Separate adapter contract; overloaded/inherited symbols tested; unsupported transformations do not generate patches. |
| CW-09: Run management | Engineer B | Cancellation, retention, export/import, and pagination. | Restart-safe job states; bounded database growth; deletion/export tests; clear UI for partial runs. |
| CW-10: Runtime dependency evidence | Shared | Import sanitized request traces to supplement static dependencies. | Static and observed edges remain distinguishable; no inferred edge presented as proven; missing traffic coverage explained. |

Engineer A/B are suggested responsibilities. Both should review changes across the boundary and record actual contributions through normal PR history.

## Definition of done for every PR

The advertised behavior works end to end, tests cover its meaningful failure mode, documentation matches implementation, unsupported cases are visible, and performance claims include the workload and raw measurements. Avoid PRs that merely alter completion counters or add nonfunctional controls.
