import { serve } from '@hono/node-server';
import { ProjectApplication } from '@n2/application';
import { ProjectRepository } from '@n2/db';
import { createApp } from './app.js';
import { createOwnerApp } from './ownerApp.js';
import { productionConfig } from './productionConfig.js';

const config = productionConfig(process.env);
const repository = new ProjectRepository(config.databasePath, { opening: 'existing' });
const api = createApp(new ProjectApplication(repository), repository.readiness);
const web = createOwnerApp(api, config.login, config.publicOrigin);

// Docker publishes both listeners on host loopback; only 4318 is routed through Serve.
const local = serve({ fetch: api.fetch, hostname: '0.0.0.0', port: 4317 });
const frontend = serve({ fetch: web.fetch, hostname: '0.0.0.0', port: 4318 });
console.log('N2 is ready; private frontend 4318 and host-loopback agent API 4317');
const shutdown = (): void => {
  void Promise.all(
    [frontend, local].map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  ).then(() => repository.close());
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
