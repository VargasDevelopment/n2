import { ProjectApplication } from '@n2/application';
import { BUILD_COMMIT_HEADER } from '@n2/contracts';
import { LATEST_SCHEMA_VERSION, ProjectRepository } from '@n2/db';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { createOwnerApp } from './ownerApp.js';
import { productionConfig } from './productionConfig.js';

const login = 'owner@example.invalid';
const publicOrigin = 'https://n2.example.invalid';
const owner = { 'Tailscale-User-Login': login };
const api = new Hono().all('/api/test', (context) => context.json({ ok: true }));
const web = createOwnerApp(api, login, publicOrigin);
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('production boundary', () => {
  it('allows the owner and rejects another or missing identity on every path', async () => {
    expect((await web.request('/api/test', { headers: owner })).status).toBe(200);
    for (const path of ['/api/test', '/health', '/', '/projects/default']) {
      for (const headers of [{}, { 'Tailscale-User-Login': 'other@example.invalid' }]) {
        expect((await web.request(path, { headers })).status).toBe(403);
      }
    }
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'rejects cross-origin %s requests',
    async (method) => {
      const response = await web.request('/api/test', {
        method,
        headers: { ...owner, Origin: 'https://other.invalid' }
      });
      expect(response.status).toBe(403);
    }
  );

  it('allows same-origin and native writes and cross-origin safe reads', async () => {
    for (const headers of [owner, { ...owner, Origin: publicOrigin }]) {
      expect((await web.request('/api/test', { method: 'POST', headers })).status).toBe(200);
    }
    expect(
      (await web.request('/api/test', { headers: { ...owner, Origin: 'https://other.invalid' } }))
        .status
    ).toBe(200);
    expect((await web.request('/api/missing', { headers: owner })).status).toBe(404);
  });

  it('requires explicit configuration and an exact HTTPS origin', () => {
    const env = {
      N2_DB_PATH: '/data/n2.sqlite',
      N2_TAILSCALE_LOGIN: login,
      N2_PUBLIC_ORIGIN: publicOrigin
    };
    expect(productionConfig(env)).toEqual({ databasePath: env.N2_DB_PATH, login, publicOrigin });
    for (const key of Object.keys(env))
      expect(() => productionConfig({ ...env, [key]: '' })).toThrow();
    for (const origin of ['http://n2.invalid', `${publicOrigin}/`, `${publicOrigin}/path`]) {
      expect(() => productionConfig({ ...env, N2_PUBLIC_ORIGIN: origin })).toThrow();
    }
    for (const key of ['N2_DB_PATH', 'N2_HOST_DATA_DIR', 'N2_HOST_BACKUP_DIR']) {
      expect(() => productionConfig({ ...env, [key]: './relative' })).toThrow(/absolute/);
    }
  });

  it('makes the app shell revalidate and lets hashed bundle files be cached forever', async () => {
    const root = mkdtempSync(join(tmpdir(), 'n2-public-'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<!doctype html>');
    writeFileSync(join(root, 'assets', 'index-abc123.js'), 'export {};');
    const app = createOwnerApp(api, login, publicOrigin, root);
    const cacheControl = async (path: string) => {
      const response = await app.request(path, { headers: owner });
      return [response.status, response.headers.get('Cache-Control')];
    };
    try {
      expect(await cacheControl('/')).toEqual([200, 'no-cache']);
      expect(await cacheControl('/projects/default')).toEqual([200, 'no-cache']);
      expect(await cacheControl('/assets/index-abc123.js')).toEqual([
        200,
        'public, max-age=31536000, immutable'
      ]);
      expect(await cacheControl('/assets/index-old.js')).toEqual([404, null]);
      expect(await cacheControl('/api/test')).toEqual([200, null]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('names its build commit on every API response, and only when it has one', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'n2-commit-'));
    const repository = new ProjectRepository(join(directory, 'n2.sqlite'));
    const appFor = (commit: string | undefined) => {
      vi.stubEnv('N2_BUILD_COMMIT', commit);
      return createApp(new ProjectApplication(repository), repository.readiness);
    };
    try {
      const deployed = appFor('test-commit');
      for (const path of ['/api/projects', '/api/projects/missing', '/health']) {
        expect((await deployed.request(path)).headers.get(BUILD_COMMIT_HEADER)).toBe('test-commit');
      }
      const development = appFor(undefined);
      expect((await development.request('/api/projects')).headers.has(BUILD_COMMIT_HEADER)).toBe(
        false
      );
    } finally {
      repository.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports database readiness, schema, and build commit, and fails when the connection closes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'n2-health-'));
    const repository = new ProjectRepository(join(directory, 'n2.sqlite'));
    vi.stubEnv('N2_BUILD_COMMIT', 'test-commit');
    const app = createApp(new ProjectApplication(repository), repository.readiness);
    try {
      const response = await app.request('/health');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        schemaVersion: LATEST_SCHEMA_VERSION,
        commit: 'test-commit'
      });
    } finally {
      repository.close();
    }
    try {
      const response = await app.request('/health');
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, commit: 'test-commit' });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
