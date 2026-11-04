import { ProjectLibrarySchema } from '@n2/contracts';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { localAccess, selfHostConfig } from './selfHostConfig.js';
import { createWebApp } from './webApp.js';

const children = new Set<ChildProcessWithoutNullStreams>();
const directories = new Set<string>();

afterEach(() => {
  for (const child of children) child.kill('SIGKILL');
  children.clear();
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  directories.clear();
});

function startSelfHost(databasePath: string) {
  const child = spawn(process.execPath, ['dist/selfhost.js'], {
    env: { ...process.env, N2_DB_PATH: databasePath, N2_PORT: '0' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  children.add(child);
  let output = '';
  const collect = (chunk: Buffer) => {
    output += chunk.toString('utf8');
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  const ready = new Promise<string>((resolve, reject) => {
    child.stdout.on('data', () => {
      const port = /ready on 127\.0\.0\.1:(\d+)/.exec(output)?.[1];
      if (port) resolve(`http://127.0.0.1:${port}`);
    });
    void exited.then((code) => reject(new Error(`exited ${code}: ${output}`)));
  });
  // A test that expects the server to exit never awaits `ready`.
  ready.catch(() => undefined);
  return { ready, exited, output: () => output };
}

const tempDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'n2-selfhost-'));
  directories.add(directory);
  return directory;
};

describe('self-hosted entrypoint', () => {
  it('creates a missing library and refuses cross-origin writes', async () => {
    const path = join(tempDirectory(), 'n2.sqlite');
    const origin = await startSelfHost(path).ready;
    expect(statSync(path).mode & 0o777).toBe(0o600);

    expect(await (await fetch(`${origin}/health`)).json()).toMatchObject({ ok: true });
    const library = ProjectLibrarySchema.parse(
      await (await fetch(`${origin}/api/projects`)).json()
    );
    expect(library.projects).toHaveLength(1);

    const create = (headers: Record<string, string>) =>
      fetch(`${origin}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ projectId: randomUUID(), name: 'Second', referenceKey: 'SEC' })
      });
    expect((await create({ Origin: 'https://elsewhere.invalid' })).status).toBe(403);
    expect((await create({ Origin: origin })).status).toBe(201);
  });

  it('refuses an existing file that is not an N2 library', async () => {
    const path = join(tempDirectory(), 'n2.sqlite');
    writeFileSync(path, '');
    const server = startSelfHost(path);
    expect(await server.exited).toBe(1);
    expect(server.output()).toMatch(/Refusing/);
  });

  it('refuses a dangling symlink instead of creating its target', async () => {
    const directory = tempDirectory();
    const target = join(directory, 'elsewhere.sqlite');
    const path = join(directory, 'n2.sqlite');
    symlinkSync(target, path);
    const server = startSelfHost(path);
    expect(await server.exited).toBe(1);
    expect(server.output()).toMatch(/Refusing/);
    expect(existsSync(target)).toBe(false);
  });

  it('requires an absolute database path, a valid port and plain allowed host names', () => {
    expect(selfHostConfig({ N2_DB_PATH: '/data/n2.sqlite' })).toEqual({
      databasePath: '/data/n2.sqlite',
      hostname: '127.0.0.1',
      port: 4317,
      allowedHosts: new Set(['localhost', '127.0.0.1', '[::1]'])
    });
    expect(
      selfHostConfig({ N2_DB_PATH: '/n2.sqlite', N2_ALLOWED_HOSTS: ' N2.lan, ,box ' }).allowedHosts
    ).toEqual(new Set(['localhost', '127.0.0.1', '[::1]', 'n2.lan', 'box']));
    for (const hosts of ['n2.lan:4317', 'http://n2.lan', 'n2.lan/x', 'me@n2.lan', '*']) {
      expect(() => selfHostConfig({ N2_DB_PATH: '/n2.sqlite', N2_ALLOWED_HOSTS: hosts })).toThrow(
        /N2_ALLOWED_HOSTS/
      );
    }
    expect(() => selfHostConfig({})).toThrow(/absolute/);
    expect(() => selfHostConfig({ N2_DB_PATH: 'n2.sqlite' })).toThrow(/absolute/);
    for (const port of ['', 'abc', '-1', '70000', '1.5']) {
      expect(() => selfHostConfig({ N2_DB_PATH: '/n2.sqlite', N2_PORT: port })).toThrow(/port/);
    }
  });
});

describe('self-host access gate', () => {
  const api = new Hono()
    .get('/api/test', (context) => context.json({ read: true }))
    .post('/api/test', (context) => context.json({ wrote: true }));
  const { allowedHosts } = selfHostConfig({ N2_DB_PATH: '/n2.sqlite', N2_ALLOWED_HOSTS: 'n2.lan' });
  const web = createWebApp(api, localAccess(allowedHosts));
  const status = async (method: string, headers: Record<string, string>) =>
    (await web.request('/api/test', { method, headers })).status;

  it('refuses reads and writes under a host name it does not know (DNS rebinding)', async () => {
    for (const method of ['GET', 'POST']) {
      expect(await status(method, { Host: 'attacker.invalid:4317' })).toBe(403);
      expect(
        await status(method, {
          Host: 'attacker.invalid:4317',
          Origin: 'http://attacker.invalid:4317'
        })
      ).toBe(403);
    }
    expect(await status('GET', {})).toBe(403);
  });

  it('serves local and allowed host names, and writes only from the same origin', async () => {
    for (const host of ['localhost:4317', '127.0.0.1:5317', '[::1]:4317', 'N2.LAN']) {
      expect(await status('GET', { Host: host })).toBe(200);
      expect(await status('POST', { Host: host })).toBe(200);
    }
    expect(await status('POST', { Host: 'localhost:4317', Origin: 'http://localhost:4317' })).toBe(
      200
    );
    expect(await status('POST', { Host: 'n2.lan', Origin: 'https://n2.lan' })).toBe(200);
    for (const origin of ['http://127.0.0.1:4317', 'http://localhost:9999', 'null']) {
      expect(await status('POST', { Host: 'localhost:4317', Origin: origin })).toBe(403);
    }
    expect(
      await status('GET', { Host: 'localhost:4317', Origin: 'https://elsewhere.invalid' })
    ).toBe(200);
  });
});
