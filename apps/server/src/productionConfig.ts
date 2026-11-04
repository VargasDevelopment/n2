import { isAbsolute } from 'node:path';

export function productionConfig(env: NodeJS.ProcessEnv): {
  databasePath: string;
  login: string;
  publicOrigin: string;
} {
  const {
    N2_DB_PATH: databasePath,
    N2_TAILSCALE_LOGIN: login,
    N2_PUBLIC_ORIGIN: publicOrigin
  } = env;
  if (!databasePath || !login?.trim() || !publicOrigin) {
    throw new Error('Explicit database, public origin and allowed tailnet login are required');
  }
  const paths = [databasePath, env.N2_HOST_DATA_DIR, env.N2_HOST_BACKUP_DIR];
  if (paths.some((path) => path !== undefined && !isAbsolute(path))) {
    throw new Error('Production database and host bind paths must be absolute');
  }
  const url = new URL(publicOrigin);
  if (url.protocol !== 'https:' || url.origin !== publicOrigin) {
    throw new Error('N2_PUBLIC_ORIGIN must be an HTTPS origin without a path');
  }
  return { databasePath, login, publicOrigin };
}
