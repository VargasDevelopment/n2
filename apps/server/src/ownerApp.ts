import type { Hono } from 'hono';
import { createWebApp, isWrite } from './webApp.js';

export function createOwnerApp(
  api: Hono,
  login: string,
  publicOrigin: string,
  publicRoot = './public'
): Hono {
  return createWebApp(
    api,
    async (context, next) => {
      // Only Serve may supply identity. Loopback and host access are part of this trust boundary.
      if (context.req.header('Tailscale-User-Login') !== login) {
        return context.json({ error: 'Tailnet owner identity required' }, 403);
      }
      const origin = context.req.header('Origin');
      if (isWrite(context.req.method) && origin && origin !== publicOrigin) {
        return context.json({ error: 'Cross-origin writes are not allowed' }, 403);
      }
      await next();
    },
    publicRoot
  );
}
