import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

import { run } from './index.js';

export async function fixture(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'n2-code-health-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  await writeFile(join(root, '.gitignore'), 'ignored/\ndist/\n', 'utf8');
  await writeFile(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\nimporters: {}\n", 'utf8');
  await mkdir(join(root, 'packages/domain/src'), { recursive: true });
  await writeFile(
    join(root, 'packages/domain/src/index.ts'),
    'export const healthy = true;\n',
    'utf8'
  );
  execFileSync('git', ['add', '.'], { cwd: root });
  await run({ root, update: true });
  return root;
}
