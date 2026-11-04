import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type MiddlewareHandler } from 'hono';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

const cacheControl =
  (value: string): MiddlewareHandler =>
  async (context, next) => {
    await next();
    if (context.res.ok) context.header('Cache-Control', value);
  };

/** True for methods that can change the library. */
export const isWrite = (method: string): boolean => !SAFE_METHODS.includes(method);

/**
 * Serves the API and the built web bundle from one origin. Every request, including static
 * assets and health, passes through `gate` first.
 */
export function createWebApp(api: Hono, gate: MiddlewareHandler, publicRoot = './public'): Hono {
  const web = new Hono();
  web.use('*', gate);
  web.route('/', api);
  web.all('/api/*', (context) => context.json({ error: 'Unknown API route' }, 404));
  // Vite names every bundle file by its content hash, so a name never changes meaning. A missing
  // one is a 404, never the app shell, so a stale tab cannot cache HTML under a script's name.
  web.use(
    '/assets/*',
    cacheControl('public, max-age=31536000, immutable'),
    serveStatic({ root: publicRoot })
  );
  web.all('/assets/*', (context) => context.json({ error: 'Unknown asset' }, 404));
  // index.html names the current bundle, so a reload must revalidate it to pick up a deploy.
  web.use('*', cacheControl('no-cache'), serveStatic({ root: publicRoot }));
  web.get('*', serveStatic({ path: `${publicRoot}/index.html` }));
  return web;
}
