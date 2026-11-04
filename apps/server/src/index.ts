import { serve } from '@hono/node-server';
import { ProjectApplication } from '@n2/application';
import { ProjectRepository } from '@n2/db';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const databasePath = process.env.N2_DB_PATH ?? resolve(repositoryRoot, '.data', 'n2.sqlite');
const requireExisting =
  process.env.NODE_ENV === 'production' || process.env.N2_REQUIRE_EXISTING_DB === '1';
if (!requireExisting) mkdirSync(dirname(databasePath), { recursive: true });

const repository = new ProjectRepository(databasePath, {
  opening: requireExisting ? 'existing' : 'unchecked'
});
const app = createApp(new ProjectApplication(repository), repository.readiness);
const port = Number(process.env.N2_PORT ?? 4317);

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, ({ port: activePort }) => {
  console.log(`N2 local service is ready at http://127.0.0.1:${activePort}`);
});

const shutdown = (): void => {
  server.close(() => {
    repository.close();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
