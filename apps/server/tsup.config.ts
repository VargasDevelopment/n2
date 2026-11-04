import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    server: 'src/production.ts',
    selfhost: 'src/selfhost.ts',
    backup: 'src/backup.ts'
  },
  format: ['esm'],
  target: 'node24',
  clean: true,
  external: ['better-sqlite3'],
  noExternal: [/^@n2\//]
});
