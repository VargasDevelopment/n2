import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { run } from './index.js';
import { countLines, lineNumber } from './analyze.js';
import { readBaseline } from './baseline.js';
import {
  CODE_EXTENSIONS,
  classifyFile,
  discoverFiles,
  isCodeFile,
  isTextFile,
  readFiles
} from './files.js';
import { fixture } from './test-helpers.js';

void test('regressions fail while improvements pass without rewriting the baseline', async (t) => {
  const root = await fixture(t);
  const baselinePath = join(root, 'code-health-baseline.json');
  const original = await readFile(baselinePath, 'utf8');
  await writeFile(
    join(root, 'packages/domain/src/index.ts'),
    '// @ts-ignore\nexport {};\n',
    'utf8'
  );
  assert.match((await run({ root })).failures.join('\n'), /tsSuppressions/);
  await writeFile(
    join(root, 'packages/domain/src/index.ts'),
    'export const healthier = true;\n',
    'utf8'
  );
  assert.deepEqual((await run({ root })).failures, []);
  assert.equal(await readFile(baselinePath, 'utf8'), original);
});

void test('classifies monorepo production and test paths at every package depth', () => {
  assert.equal(classifyFile('apps/web/src/App.tsx'), 'production');
  assert.equal(classifyFile('packages/domain/src/index.ts'), 'production');
  for (const path of [
    'packages/domain/test/projectGraph.ts',
    'packages/domain/tests/projectGraph.ts',
    'apps/web/src/__tests__/GraphCanvas.tsx',
    'apps/web/src/__specs__/GraphCanvas.tsx',
    'apps/web/src/App.test.tsx',
    'apps/web/src/App.tests.tsx',
    'packages/domain/src/projectGraph.spec.ts',
    'packages/domain/src/projectGraph.specs.ts'
  ]) {
    assert.equal(classifyFile(path), 'test', path);
  }
  assert.equal(classifyFile('scripts/code-health/index.ts'), 'analyzer');
  assert.equal(classifyFile('scripts/code-health/policies/typescript.ts'), 'analyzer');
  assert.equal(classifyFile('docs/example.ts'), null);
  for (const extension of CODE_EXTENSIONS) {
    const path = `packages/domain/src/example${extension}`;
    assert.equal(isCodeFile(path), true, path);
    assert.equal(isTextFile(path), true, path);
    assert.equal(classifyFile(`packages/domain/src/example.test${extension}`), 'test', path);
  }
  assert.equal(isCodeFile('apps/web/src/styles.css'), false);
});

void test('analyzes TypeScript module extensions instead of silently omitting them', async (t) => {
  const root = await fixture(t);
  await writeFile(
    join(root, 'packages/domain/src/module.mts'),
    '// @ts-ignore\nexport {};\n',
    'utf8'
  );
  await writeFile(join(root, 'packages/domain/src/common.cts'), 'process.exit(1);\n', 'utf8');
  const { metrics } = (await run({ root })).report;
  assert.equal(metrics.tsSuppressions.length, 1);
  assert.equal(metrics.unsanctionedProcessExit.length, 1);
});

void test('discovers untracked source and excludes generated directories at any depth', async (t) => {
  const root = await fixture(t);
  for (const directory of [
    '.next',
    '.pnpm-store',
    '.turbo',
    'coverage',
    'dist',
    'node_modules',
    'out',
    'apps/web/dist',
    'packages/domain/coverage'
  ]) {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, directory, 'bad.ts'), 'process.exit(1);\n', 'utf8');
    execFileSync('git', ['add', '-f', `${directory}/bad.ts`], { cwd: root });
  }
  await writeFile(
    join(root, 'pnpm-lock.yaml'),
    "lockfileVersion: '9.0'\nimporters: {}\n# process.exit(1);\n",
    'utf8'
  );
  execFileSync('git', ['add', '-f', 'pnpm-lock.yaml'], { cwd: root });
  await mkdir(join(root, 'packages/domain/src/generated'), { recursive: true });
  await writeFile(join(root, 'packages/domain/src/generated/bad.ts'), 'process.exit(1);\n', 'utf8');
  assert.ok(discoverFiles(root).includes('packages/domain/src/generated/bad.ts'));
  assert.equal((await run({ root })).report.metrics.unsanctionedProcessExit.length, 1);
});

void test('large-file maps reject growth and replacement', async (t) => {
  const root = await fixture(t);
  const original = `${'// line\n'.repeat(500)}export const end = true;\n`;
  await writeFile(join(root, 'packages/domain/src/large.ts'), original, 'utf8');
  execFileSync('git', ['add', 'packages/domain/src/large.ts'], { cwd: root });
  await run({ root, update: true });
  const baseline = await readBaseline(root);
  assert.deepEqual(baseline.largeFiles.production, {
    'packages/domain/src/large.ts': 501
  });
  await writeFile(join(root, 'packages/domain/src/large.ts'), `${original}// growth\n`, 'utf8');
  assert.match((await run({ root })).failures.join('\n'), /grew to 502 lines/);
  await rm(join(root, 'packages/domain/src/large.ts'));
  await writeFile(join(root, 'packages/domain/src/replacement.ts'), original, 'utf8');
  assert.match((await run({ root })).failures.join('\n'), /new oversized production file/);
});

void test('baseline maps fail closed when malformed', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'code-health-baseline.json');
  const baseline = await readBaseline(root);
  assert.deepEqual(baseline.metrics.tsSuppressions, {});
  assert.deepEqual(baseline.largeFiles.analyzer, {});
  await writeFile(
    path,
    JSON.stringify({
      ...baseline,
      metrics: { ...baseline.metrics, tsSuppressions: { invalid: 1 } }
    }),
    'utf8'
  );
  await assert.rejects(run({ root }), /invalid fingerprint map/);
  await run({ root, update: true });
  const repaired = await readBaseline(root);
  await writeFile(
    path,
    JSON.stringify({
      ...repaired,
      largeFiles: {
        ...repaired.largeFiles,
        production: { 'packages/domain/src/small.ts': 1 }
      }
    }),
    'utf8'
  );
  await assert.rejects(run({ root }), /invalid path map/);
  await rm(path);
  await assert.rejects(run({ root }), /missing or malformed/);
});

void test('unknown versions and threshold drift fail closed', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'code-health-baseline.json');
  const baseline = await readBaseline(root);
  await writeFile(path, JSON.stringify({ ...baseline, version: 999 }), 'utf8');
  await assert.rejects(run({ root }), /unsupported baseline version/);
  await writeFile(
    path,
    JSON.stringify({
      ...baseline,
      thresholds: {
        largeFileLines: {
          ...baseline.thresholds.largeFileLines,
          production: baseline.thresholds.largeFileLines.production + 1
        }
      }
    }),
    'utf8'
  );
  await assert.rejects(run({ root }), /threshold drift/);
});

void test('fingerprints reject moved debt but tolerate line shifts and improvements', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'packages/domain/src/debt.ts');
  await writeFile(path, '// @ts-ignore same\nconst first = one;\nconst second = two;\n', 'utf8');
  execFileSync('git', ['add', 'packages/domain/src/debt.ts'], { cwd: root });
  await run({ root, update: true });
  await writeFile(
    path,
    '\n\n// @ts-ignore same\nconst first = one;\nconst second = two;\n',
    'utf8'
  );
  assert.deepEqual((await run({ root })).failures, []);
  await writeFile(path, 'const first = one;\n// @ts-ignore same\nconst second = two;\n', 'utf8');
  assert.match((await run({ root })).failures.join('\n'), /offense fingerprint/);
  await writeFile(path, 'const first = one;\nconst second = two;\n', 'utf8');
  assert.deepEqual((await run({ root })).failures, []);
});

void test('contained symlinks work and escaping tracked or untracked symlinks fail closed', async (t) => {
  const root = await fixture(t);
  await writeFile(
    join(root, 'packages/domain/src/target.ts'),
    'export const target = true;\n',
    'utf8'
  );
  await symlink('target.ts', join(root, 'packages/domain/src/internal.ts'));
  assert.ok(discoverFiles(root).includes('packages/domain/src/internal.ts'));
  assert.deepEqual((await run({ root })).failures, []);

  const external = await mkdtemp(join(tmpdir(), 'n2-code-health-external-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  await writeFile(join(external, 'outside.ts'), 'export {};\n', 'utf8');
  for (const tracked of [true, false]) {
    const unsafeRoot = await fixture(t);
    await symlink(
      join(external, 'outside.ts'),
      join(unsafeRoot, 'packages/domain/src/external.ts')
    );
    if (tracked) {
      execFileSync('git', ['add', 'packages/domain/src/external.ts'], { cwd: unsafeRoot });
    }
    assert.throws(() => discoverFiles(unsafeRoot), /symlink escapes root/);
  }
});

void test('baseline replacement is atomic and temporary files are cleaned', async (t) => {
  const root = await fixture(t);
  const baselinePath = join(root, 'code-health-baseline.json');
  const before = await readFile(baselinePath, 'utf8');
  await run({ root, update: true });
  assert.equal(await readFile(baselinePath, 'utf8'), before);
  assert.equal(
    (await readdir(root)).some((name) => name.startsWith('.code-health-baseline.json.')),
    false
  );
  await rm(baselinePath);
  await mkdir(baselinePath);
  await assert.rejects(run({ root, update: true }));
  assert.equal(
    (await readdir(root)).some((name) => name.startsWith('.code-health-baseline.json.')),
    false
  );
});

void test('safe reads and line helpers cover path punctuation and every line terminator', async (t) => {
  const root = await fixture(t);
  const path = 'packages/domain/src/hash# query? percent% 雪.ts';
  await writeFile(join(root, path), 'export const readable = true;\n', 'utf8');
  const [file] = await readFiles(root, [path]);
  assert.ok(file);
  assert.equal(file.content, 'export const readable = true;\n');
  const content = 'one\r\ntwo\nthree\rfour\u2028five\u2029six';
  assert.equal(countLines(content), 6);
  assert.equal(lineNumber(content, content.indexOf('six')), 6);
});
