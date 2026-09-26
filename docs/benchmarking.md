# Benchmarking

## Reproduce the shipped measurement

```bash
npm ci
npm run benchmark
```

The script performs one analysis warm-up, then five sequential migrations of the commerce fixture. It reports Node and TypeScript versions, CPU, OS, architecture, source byte count, repository count, each sample, median, and maximum. A recorded run is included in `fixtures/benchmark-local.json`; its timing belongs to its recorded machine and date.

To save a new result:

```bash
mkdir -p benchmark-results
node server/benchmark.js > benchmark-results/local.json
```

No network, hosted model, or user repository is involved. Each migration still creates two fresh TypeScript compiler programs. A warm process is not an incremental analysis cache.

## Interpretation

This is a tiny functional workload and timing smoke test, not a p95, throughput, scalability, or production result. Five samples are insufficient for meaningful tail-latency conclusions. Compare on the same hardware/runtime, report raw samples, and explain warm-up and background load. A faster result is only useful if semantic outputs remain equivalent.

## Next benchmark PR

Create a seeded generator spanning file count, source size, repository count, import fan-out, cycles, and dynamic references. Keep all generated workspaces within the enforced limits. Compare full analysis with a future incremental implementation over one changed file, a changed shared interface, and an unchanged re-run. Include warm/cold runs, peak memory, cancellation latency, and raw samples. Validate that both paths return the same impacts and unresolved cases before reporting a speedup.

The engine currently has no incremental implementation, so the repository makes no incremental-versus-full speedup claim.
