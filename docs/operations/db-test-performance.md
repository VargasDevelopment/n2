# DB test performance

## Timeout and worker policy

File-backed suites have a **10 s test timeout and 10 s hook timeout**, set once in
`packages/db/vitest.config.ts`. Refusal tests follow this policy too: opening,
checkpointing, and removing their SQLite fixtures performs real disk work. The
in-memory `SchemaMigrations.test.ts` project keeps Vitest's **5 s test default**.
New suites use the file-backed policy unless explicitly listed as in-memory.
Default file discovery and exclusions remain intact. There are no retries or
load-dependent timeout multipliers.

Both Vitest projects share a cap of **four workers**. Each project must not start
an independent pool. The fixed deadlines allow scheduling headroom for disk work;
they are not performance targets or evidence that tests became faster.

## Fixture and constructor rules

Use `createTestProjectRepository(path, options?)` when a test needs a fresh current
schema. It caches an in-memory migrated image per isolated module, exclusively
creates a separate writable file for each call, and runs the ordinary repository
constructor. Starter initialization, WAL, and foreign keys still run. Connection
options pass through so two-connection tests exercise the same locks and SQL
callbacks. Files are private to each caller; an existing file is refused.

Use the ordinary constructor to reopen a file, test empty-library initialization,
or migrate a historical schema. A test that restores a historical shape from the
current schema may use the fixture for setup, then the constructor for the actual
migration. Keep genuine legacy-library and empty-file migration coverage.

The fixture replaces 23 setup call sites, executed 34 times per suite, while retaining
all 127 tests and their assertions. Tests cover schema and starter-data
equivalence, isolation, persistence after reopening, exclusive creation, and
connection-option forwarding.

## Paired measurements (2026-10-22)

These are historical results. The baseline commit predates this repository's
published history. Measurements used Linux on an eight-core, 16-logical-CPU
shared host with ext4/NVMe storage, Node **24.22.0**, pnpm **10.12.4**, Vitest **4.1.11**, and `TMPDIR` on the same ext4/NVMe disk. Dependencies came from a
frozen-lockfile install. Each run executed **127 tests in 17 files**. Elapsed time
includes direct Node/Vitest startup and JSON reporting, but excludes pnpm startup.
Quality checks and diagnostic probes ran separately from timing trials.

The comparison alternated baseline and updated sources in the same worktree,
reversing their order in the second pair. Loaded batches kept **24 Python CPU
busy loops** running across all six invocations, after two seconds of warmup.
Source restoration and load cleanup ran in `finally` blocks. Unloaded means no
synthetic load; unrelated work continued on the shared host in both conditions.

| Condition    | Version |  Trial 1 |  Trial 2 |  Trial 3 |   Median |
| ------------ | ------- | -------: | -------: | -------: | -------: |
| Unloaded     | Before  |  9.799 s |  9.967 s |  9.912 s |  9.912 s |
| Unloaded     | After   |  9.470 s |  9.374 s | 10.119 s |  9.470 s |
| 24 CPU loops | Before  | 21.775 s | 25.164 s | 26.624 s | 25.164 s |
| 24 CPU loops | After   | 19.539 s | 18.715 s | 21.908 s | 19.539 s |

All **12 paired runs passed**, including three loaded runs per version. Peak
overlapping test-file bodies remained four across both projects. The longest
updated test in the paired loaded batch took **1.789 s**. Shared-host contention
limits the comparison: these observations do not establish an isolated throughput
ratio or guarantee success during arbitrary machine stalls.

Diagnostic probes showed fewer migration writes with durability unchanged.
We keep four workers: using one or two did not improve the measured loaded suite time.

## Reproduction

From the repository root with Node 24 active, run this batch once unloaded, then
change `loaded=0` to `loaded=1` and repeat. It uses a private results directory,
runs three suites sequentially, records per-test durations, and cleans up its own
load processes even if a suite fails. These commands use temporary test databases.

```bash
results=$(mktemp -d "${TMPDIR:-/tmp}/n2-db-timing.XXXXXX")
loaded=0
(
  pids=()
  trap 'kill "${pids[@]}" 2>/dev/null || true; wait "${pids[@]}" 2>/dev/null || true' EXIT
  if (( loaded )); then
    for i in {1..24}; do
      python3 -c 'while True: pass' &
      pids+=("$!")
    done
    sleep 2
  fi
  batch_status=0
  for run in 1 2 3; do
    time node node_modules/vitest/vitest.mjs run --root packages/db --maxWorkers=4 \
      --reporter=default --reporter=json --outputFile="$results/run-$run.json" || batch_status=1
  done
  exit "$batch_status"
)
```

Keep runtime, storage, workers, and test count identical between versions. Avoid
unrelated builds or typechecks during measurements. Compare elapsed and per-test
times; a longer timeout alone is not a speedup. The raw reports were temporary and
are not kept in the repository.
