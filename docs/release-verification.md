# Release verification — v0.1.0

Verified on 2026-09-26 in the development workspace.

25 Node tests passed. The CLI demo produced five patches across four repositories; both compiler checks and all three fixtures passed. Mixed-version compatibility failures and the unresolved dynamic access are intentional review findings.

## Browser acceptance

- ChangeWeave migration produces five reviewed patches.
- ChangeWeave model unconfigured state.
- ChangeWeave before/after compilation and compatibility review.
- ChangeWeave SQLite persistence with cleared browser storage.
- ChangeWeave mobile patch review fits viewport.
- ChangeWeave static demo runs real compiler migration.
- No uncaught browser errors.

Chromium was exercised at desktop and 390-pixel mobile widths. API-backed histories were restored after clearing localStorage.

## Remaining verification limits

- Real model provider calls were not made; adapter behavior is covered by mocked responses and unconfigured fallbacks.
- Docker and Compose files are included but Docker execution was not available in this environment.
- GitHub Actions workflows are included; no GitHub-hosted CI run is claimed.
- Synthetic fixtures exercise supported behavior; they do not establish production accuracy or throughput.
