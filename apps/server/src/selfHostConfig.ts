import type { MiddlewareHandler } from 'hono';
import { isAbsolute } from 'node:path';
import { isWrite } from './webApp.js';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export function selfHostConfig(env: NodeJS.ProcessEnv): {
  databasePath: string;
  hostname: string;
  port: number;
  allowedHosts: ReadonlySet<string>;
} {
  const { N2_DB_PATH: databasePath, N2_HOST: hostname = '127.0.0.1', N2_PORT = '4317' } = env;
  if (!databasePath || !isAbsolute(databasePath)) {
    throw new Error('N2_DB_PATH must be an absolute path');
  }
  const port = Number(N2_PORT);
  if (!N2_PORT.trim() || !Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('N2_PORT must be a TCP port number');
  }
  const extraHosts = (env.N2_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  // Exact names only: no ports, paths or wildcards.
  if (extraHosts.some((entry) => !/^[a-z0-9.:[\]-]+$/.test(entry) || hostnameOf(entry) !== entry)) {
    throw new Error('N2_ALLOWED_HOSTS must list host names without ports, separated by commas');
  }
  return { databasePath, hostname, port, allowedHosts: new Set([...LOCAL_HOSTS, ...extraHosts]) };
}

/**
 * There is no login: whoever can reach the port is trusted. A web page can still reach a local
 * port through the browser, either directly or by pointing its own domain at 127.0.0.1 (DNS
 * rebinding). So every request must name an allowed host, and a write that names an Origin must
 * come from that same host.
 */
export function localAccess(allowedHosts: ReadonlySet<string>): MiddlewareHandler {
  return async (context, next) => {
    const host = context.req.header('Host');
    const hostname = host === undefined ? undefined : hostnameOf(host);
    if (host === undefined || hostname === undefined || !allowedHosts.has(hostname)) {
      return context.json(
        {
          error: 'This host name is not allowed. Add it to N2_ALLOWED_HOSTS to serve N2 under it.'
        },
        403
      );
    }
    const origin = context.req.header('Origin');
    if (isWrite(context.req.method) && origin !== undefined && !isSameAuthority(origin, host)) {
      return context.json({ error: 'Cross-origin writes are not allowed' }, 403);
    }
    await next();
  };
}

/** The lower-case host name of a `host[:port]` authority, or undefined if it is not one. */
function hostnameOf(authority: string): string | undefined {
  try {
    return new URL(`http://${authority}`).hostname;
  } catch {
    return undefined;
  }
}

function isSameAuthority(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === new URL(`http://${host}`).host;
  } catch {
    return false;
  }
}
