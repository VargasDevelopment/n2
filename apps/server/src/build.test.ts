import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const children = new Set<ChildProcessWithoutNullStreams>();
const directories = new Set<string>();

afterEach(() => {
  for (const child of children) child.kill('SIGKILL');
  children.clear();
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  directories.clear();
});

describe('built N² server', () => {
  it('starts from compiled JavaScript and shuts down cleanly', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'n2-built-server-'));
    directories.add(directory);
    const child = spawn(process.execPath, ['dist/index.js'], {
      env: {
        ...process.env,
        N2_DB_PATH: join(directory, 'n2.sqlite'),
        N2_PORT: '0'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    children.add(child);

    const ready = await new Promise<string>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(
        () => reject(new Error(`Built server did not start. stdout=${stdout} stderr=${stderr}`)),
        5_000
      );
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (stdout.includes('N2 local service is ready')) {
          clearTimeout(timeout);
          resolve(stdout);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `Built server exited before startup: code=${code} signal=${signal} stdout=${stdout} stderr=${stderr}`
          )
        );
      });
    });
    expect(ready).toContain('http://127.0.0.1:');

    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))
    );
    child.kill('SIGTERM');
    const exit = await exitPromise;
    children.delete(child);
    expect(exit).toEqual({ code: 0, signal: null });
  });
});

it.each(['missing', 'empty'])(
  'production entrypoint refuses a %s database before listening',
  async (kind) => {
    const directory = mkdtempSync(join(tmpdir(), 'n2-production-refusal-'));
    directories.add(directory);
    const path = join(directory, 'n2.sqlite');
    if (kind === 'empty') writeFileSync(path, '');
    const child = spawn(process.execPath, ['dist/server.js'], {
      env: {
        ...process.env,
        N2_DB_PATH: path,
        N2_TAILSCALE_LOGIN: 'owner@example.invalid',
        N2_PUBLIC_ORIGIN: 'https://n2.example.invalid'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    children.add(child);
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const exitCode = await new Promise<number | null>((resolve) => child.once('exit', resolve));
    children.delete(child);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/ENOENT|Refusing/);
    if (kind === 'missing') expect(existsSync(path)).toBe(false);
    else expect(statSync(path).size).toBe(0);
  }
);
