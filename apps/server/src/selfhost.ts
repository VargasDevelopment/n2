import { serve } from '@hono/node-server';
import { ProjectApplication } from '@n2/application';
import { ProjectRepository } from '@n2/db';
import { createApp } from './app.js';
import { localAccess, selfHostConfig } from './selfHostConfig.js';
import { createWebApp } from './webApp.js';

// Self-hosting serves the web interface and the API on one port without a login. Unlike the
// owner's production entrypoint, it creates a missing library (with the starter project) so a
// fresh install works; anything already at the path must be a valid N2 library.
const { databasePath, hostname, port, allowedHosts } = selfHostConfig(process.env);
const repository = new ProjectRepository(databasePath, { opening: 'create-if-missing' });
const api = createApp(new ProjectApplication(repository), repository.readiness);

const server = serve(
  { fetch: createWebApp(api, localAccess(allowedHosts)).fetch, hostname, port },
  ({ port: activePort }) => console.log(`N2 is ready on ${hostname}:${activePort}`)
);

const shutdown = (): void => {
  server.close(() => repository.close());
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
