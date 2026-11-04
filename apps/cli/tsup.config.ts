import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  noExternal: [/^@n2\//, /^zod(?:\/|$)/],
  banner: { js: '#!/usr/bin/env node' }
});
