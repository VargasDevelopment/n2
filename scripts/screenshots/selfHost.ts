import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type SelfHost = {
  /** Resolves to the server's origin once it is listening. */
  ready: Promise<string>;
  /** Stops the server and deletes its library. Safe to call more than once and after a failed start. */
  stop: () => Promise<void>;
};

/**
 * Starts the built self-host entrypoint on a new library in a temporary directory. Port 0 lets the
 * operating system pick a free port, so this never reaches an existing N2 install. It returns
 * before the server is ready, so callers can stop it even while it is still starting.
 */
export function startSelfHost(root: string): SelfHost {
  const directory = mkdtempSync(join(tmpdir(), 'n2-screenshots-'));
  const removeLibrary = () => rmSync(directory, { recursive: true, force: true });
  let child: ReturnType<typeof launch>;
  try {
    child = launch(root, directory);
  } catch (error) {
    removeLibrary();
    throw error;
  }
  // A spawn failure emits 'error' instead of 'exit'; either way the process is gone.
  const exited = once(child, 'exit').then(
    () => undefined,
    () => undefined
  );
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      try {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
          await exited;
        }
      } finally {
        removeLibrary();
      }
    })());

  let output = '';
  const ready = new Promise<string>((resolve, reject) => {
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      const port = /ready on 127\.0\.0\.1:(\d+)/.exec(output)?.[1];
      if (port) resolve(`http://127.0.0.1:${port}`);
    });
    void exited.then(() => reject(new Error(`The N2 server exited early:\n${output}`)));
  });
  return { ready, stop };
}

function launch(root: string, directory: string) {
  // The self-host server serves ./public, so run it beside a link to the built web bundle.
  symlinkSync(join(root, 'apps/web/dist'), join(directory, 'public'), 'dir');
  // Drop inherited N2_* settings: only this library, host and port may apply.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('N2_'))
  );
  return spawn(process.execPath, [join(root, 'apps/server/dist/selfhost.js')], {
    cwd: directory,
    env: {
      ...inherited,
      NODE_ENV: 'production',
      N2_DB_PATH: join(directory, 'n2.sqlite'),
      N2_HOST: '127.0.0.1',
      N2_PORT: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}
