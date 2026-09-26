# Commerce migration walkthrough

## Starting state

The fixture has four repositories: `catalog-api`, `storefront`, `order-worker`, and `reporting-sdk`. The selected `Product` interface defines `id`, `priceCents`, and `currency`. The explicit rename changes `priceCents` to `amountMinor`; it does not change cents into a floating-point currency amount.

The workspace includes unrelated fields with the same spelling, destructuring, aliased bindings, string-key access, typed object shorthand, and one untyped external payload. These are intentional behavioral cases.

## Run without the browser

```bash
npm ci
npm run demo
```

The CLI prints affected source, verification, and unresolved items. A `needs-review` status is expected for the bundled workspace because an untyped payload cannot be migrated with confidence.

For the saved API workflow:

```bash
npm run build:web
npm start
```

In another terminal:

```bash
node scripts/api-demo.mjs
```

The helper reads `/api/demo`, calls `/api/analyze`, and supplies that analysis fingerprint to `/api/migrate`. Retrieve the printed run ID through `/api/runs/<id>` or the interface. Exported patches use paths such as `catalog-api/src/contracts.ts`; review their path layout before applying to a checkout.

## Review and restore through the interface

Open the running local application and confirm **Local API connected**. Run a migration, open **History**, reload the page, and reopen the saved run. The run comes from SQLite and includes patches, verification, and unresolved findings. If a provider is explicitly configured, **Request AI review** in Patch review sends bounded snippets for separate review notes. Suggestions do not change the patches.

The browser-only version uses localStorage instead. Its history is local to that browser and is not automatically uploaded when an API becomes available.

## Expected review observations

- Typed `Product` references change; unrelated `AdBid` and analytics properties do not.
- A local variable introduced with shorthand destructuring retains its original name through an explicit alias.
- Zero-price values survive the rename as zero.
- The supplied original/original and migrated/migrated schema combinations pass.
- Cross-version combinations fail for the intentionally strict component schemas.
- The untyped access remains visible as unresolved.
- Selecting the required-market or structured-price recipe does not manufacture a default market, currency conversion, or rounding policy.

## Stale workspace exercise

Read an analysis fingerprint, modify any workspace source, and send the changed workspace with the old `expectedFingerprint`. The API returns HTTP 409 and `STALE_WORKSPACE`. Re-analysis is required. This exercises snapshot consistency; it is not a Git commit identity check.

## Your own bounded workspace

Start with `fixtures/commerce-workspace.json`. Replace the repository source maps and contracts while keeping valid relative paths. Supply explicit before/after fixtures, particularly zero values, edge values, and invalid examples in your own tests. Restrict recipes to a selected interface and repository/file where possible. Import the JSON in the interface or send it to the API.

The virtual compiler cannot load your normal npm dependencies or execute your project's tests. Use the exported result in a reviewed local branch and run the real build and tests separately.
