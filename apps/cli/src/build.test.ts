import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const executeFile = promisify(execFile);

describe('built N² CLI', () => {
  it('runs as a standalone Node entry point', async () => {
    const { stdout, stderr } = await executeFile(process.execPath, [
      'dist/index.js',
      'command',
      'schema'
    ]);
    const schema: unknown = JSON.parse(stdout);

    expect(stderr).toBe('');
    expect(z.object({ oneOf: z.array(z.unknown()).min(1) }).parse(schema).oneOf.length).toBe(16);
  });

  it('serves command-level help without requiring a local service', async () => {
    const { stdout, stderr } = await executeFile(process.execPath, [
      'dist/index.js',
      'project',
      'show',
      '--help'
    ]);

    expect(stderr).toBe('');
    expect(stdout).toContain('n2 project show');
  });

  it('packs, installs, and runs without unpublished workspace packages', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'n2-cli-pack-'));
    const installDirectory = join(directory, 'install');
    await mkdir(installDirectory);
    try {
      const packed = await executeFile('pnpm', ['pack', '--pack-destination', directory]);
      const tarball = packed.stdout.trim().split('\n').at(-1);
      if (!tarball) throw new Error('pnpm pack did not report a tarball.');
      await executeFile(
        'npm',
        ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
        {
          cwd: installDirectory,
          env: { ...process.env, npm_config_cache: join(directory, 'npm-cache') }
        }
      );

      const installed = await executeFile(join(installDirectory, 'node_modules', '.bin', 'n2'), [
        'command',
        'schema'
      ]);
      const schema: unknown = JSON.parse(installed.stdout);
      expect(installed.stderr).toBe('');
      expect(z.object({ oneOf: z.array(z.unknown()).min(1) }).parse(schema).oneOf).toHaveLength(16);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
