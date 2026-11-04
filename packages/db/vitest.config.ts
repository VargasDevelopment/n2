import { configDefaults, defineConfig } from 'vitest/config';

const memorySuites = ['test/SchemaMigrations.test.ts'];

export default defineConfig({
  test: {
    environment: 'node',
    // File-backed suites compete for durable writes; bound workers when several gates run together.
    maxWorkers: 4,
    projects: [
      {
        extends: true,
        test: {
          name: 'file-backed',
          exclude: [...configDefaults.exclude, ...memorySuites],
          // Real WAL/checkpoint/fsync work needs scheduling headroom under machine load.
          // Keep this policy here, including hooks, rather than adding per-test exceptions.
          // Measurements and fixture rules: docs/operations/db-test-performance.md.
          testTimeout: 10_000,
          hookTimeout: 10_000
        }
      },
      {
        extends: true,
        test: {
          name: 'memory',
          include: memorySuites
        }
      }
    ]
  }
});
