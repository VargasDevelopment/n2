import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { readBaseline } from './baseline.js';
import { CODE_EXTENSIONS } from './files.js';
import { run } from './index.js';
import { analyzeComplexity, measureComplexity } from './policies/complexity.js';
import { fixture } from './test-helpers.js';

const FILE = 'packages/domain/src/complex.ts';

function branches(score: number): string {
  return 'if (value) work();\n'.repeat(score - 1);
}

function declaration(name: string, score: number): string {
  return `function ${name}(value) { ${branches(score)} }`;
}

void test('installed core semantics: switches, nested paths, defaults, operators and class paths', () => {
  const cases = [
    {
      content:
        'function f(x) { switch(x) { case 1: if (x) work(); break; case 2: x && work(); break; default: work(); } }',
      classic: [5],
      modified: [4]
    },
    { content: 'function f(x) { switch(x) { default: work(); } }', classic: [1], modified: [2] },
    {
      content:
        'function outer(x) { if (x) work(); function inner(y = 1) { return y ? 1 : 0; } items.map(x => x && work()); }',
      classic: [2, 2, 3],
      modified: [2, 2, 3]
    },
    {
      content: 'function f(x = 1, { y = 2 } = {}) { const { z = 3 } = value; return x ?? y; }',
      classic: [6],
      modified: [6]
    },
    {
      content:
        'function f(x) { x.a ||= 1; x.b &&= 2; x.c ??= 3; return (x?.a?.(x?.b) || x && y) ?? z; }',
      classic: [10],
      modified: [10]
    },
    {
      content:
        'function f(xs) { for (;;) {} for (const x in xs) {} for (const x of xs) {} while (x) {} do {} while (x); try {} catch {} }',
      classic: [7],
      modified: [7]
    },
    {
      content:
        'function outer() { class C { field = flag ? 1 : 0; arrow = () => flag ? 1 : 0; static { flag && work(); } method() { return value?.x; } } }',
      classic: [1, 1, 2, 2, 2, 2],
      modified: [1, 1, 2, 2, 2, 2]
    },
    { content: 'if (flag) work(); const x = value && other;', classic: [], modified: [] }
  ];
  for (const { content, ...expected } of cases) {
    for (const variant of ['classic', 'modified'] as const) {
      const measured = measureComplexity({ path: FILE, content }, variant);
      assert.deepEqual(
        measured.map(({ score }) => score).sort((a, b) => a - b),
        expected[variant],
        content
      );
    }
  }
});

void test('inline config cannot disable or reconfigure measurement; all code extensions parse', () => {
  for (const extension of [
    ...CODE_EXTENSIONS,
    ...CODE_EXTENSIONS.map((value) => value.toUpperCase())
  ]) {
    const measured = measureComplexity({
      path: `tooling/example${extension}`,
      content: `/* eslint-disable */\n/* eslint complexity: ["error", { "max": 999 }] */\n${declaration('debt', 21)}`
    });
    assert.equal(measured[0]?.score, 21, extension);
  }
  assert.throws(
    () => measureComplexity({ path: FILE, content: 'function {' }),
    /measurement failed/
  );
});

void test('IDs preserve lexical bindings, callback roles and implicit initializer boundaries', () => {
  const measured = measureComplexity({
    path: FILE,
    content: `
    const left = { run: () => {}, nested: { run: () => {} } };
    const right = { run: () => {} };
    const choices = (() => {})() ? () => {} : () => {};
    function outer() {
      const first = items.map(() => {});
      const second = items.map(() => {});
      register(() => {}, () => {});
      class C { field = () => {}; static field = () => {}; get value() { return 1; } set value(v) {} }
    }
    namespace A { function same() {} }
    namespace B { function same() {} }
  `
  });
  const ids = measured.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes(`${FILE}#outer/first/items.map%3Aarg0`));
  assert.ok(ids.includes(`${FILE}#outer/register%3Aarg0`));
  assert.ok(ids.includes(`${FILE}#outer/register%3Aarg1`));
  assert.ok(ids.includes(`${FILE}#outer/C/field/initializer`));
  assert.ok(ids.includes(`${FILE}#outer/C/field`));
  assert.ok(ids.includes(`${FILE}#A/same`));
  assert.ok(ids.includes(`${FILE}#B/same`));
  for (const expression of ['a ? b : c', 'a && b', '[a]', 'function inner() {}']) {
    const initializer = measureComplexity({
      path: FILE,
      content: `class C { field = ${expression}; }`
    }).find(({ id }) => id.endsWith('/initializer'));
    assert.equal(initializer?.id, `${FILE}#C/field/initializer`);
  }
});

void test('ambiguous debt fails closed even against a small sibling; naming resolves it', () => {
  for (const secondScore of [1, 21]) {
    const content = `items.map(() => { ${branches(21)} }); items.map(() => { ${branches(secondScore)} });`;
    assert.throws(() => analyzeComplexity({ path: FILE, content }), /ambiguous.*distinct names/);
  }
  assert.deepEqual(
    analyzeComplexity({ path: FILE, content: 'items.map(() => {}); items.map(() => {});' }),
    {}
  );
  assert.throws(
    () =>
      analyzeComplexity({
        path: FILE,
        content: `items.map(() => { ${declaration('debt', 21)} }); items.map(() => {});`
      }),
    /ambiguous.*distinct names/
  );
  const named = analyzeComplexity({
    path: FILE,
    content: `items.map(function first() { ${branches(21)} }); items.map(function second() { ${branches(22)} });`
  });
  assert.equal(Object.keys(named).length, 2);
});

void test('20 passes, new 21 fails in every scope, and checks never rewrite the baseline', async (t) => {
  const root = await fixture(t);
  const baselinePath = join(root, 'code-health-baseline.json');
  const before = await readFile(baselinePath, 'utf8');
  for (const path of [FILE, 'tests/example.ts', 'tooling/example.ts']) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), declaration('fresh', 20));
    assert.deepEqual((await run({ root })).failures, []);
    await writeFile(join(root, path), declaration('fresh', 21));
    const { failures } = await run({ root });
    assert.equal(failures.length, 1);
    assert.match(
      failures[0] ?? '',
      /21 exceeds ceiling 20; simplify.*code-health:update.*justification/
    );
    await rm(join(root, path));
  }
  assert.equal(await readFile(baselinePath, 'utf8'), before);
});

void test('ceilings are independent: growth, renames, moves and callback argument swaps cannot transfer debt', async (t) => {
  const root = await fixture(t);
  const path = join(root, FILE);
  await writeFile(path, `${declaration('first', 22)}\n${declaration('second', 21)}`);
  await run({ root, update: true });
  for (const content of [
    `${declaration('first', 21)}\n${declaration('second', 22)}`,
    declaration('renamed', 22),
    `function outer() { ${declaration('first', 22)} }`
  ]) {
    await writeFile(path, content);
    assert.equal((await run({ root })).failures.length, 1);
  }
  await writeFile(path, declaration('first', 22));
  const moved = join(root, 'packages/domain/src/moved.ts');
  await rename(path, moved);
  assert.equal((await run({ root })).failures.length, 1);
  await rm(moved);
  await writeFile(path, `register(() => { ${branches(22)} }, () => {});`);
  await run({ root, update: true });
  await writeFile(path, `register(() => {}, () => { ${branches(22)} });`);
  assert.equal((await run({ root })).failures.length, 1);
});

void test('body edits and line shifts pass; updates lower ceilings and drop improved or removed debt', async (t) => {
  const root = await fixture(t);
  const path = join(root, FILE);
  const baselinePath = join(root, 'code-health-baseline.json');
  await writeFile(path, declaration('debt', 23));
  await run({ root, update: true });
  const before = await readFile(baselinePath, 'utf8');
  const baseline = await readBaseline(root);
  assert.deepEqual(baseline.functionComplexity, { [`${FILE}#debt`]: 23 });
  await writeFile(path, `\n\n${declaration('debt', 23).replaceAll('work()', 'otherWork()')}`);
  const shifted = await run({ root });
  assert.deepEqual(shifted.failures, []);
  assert.equal(shifted.report.functionComplexity[`${FILE}#debt`]?.line, 3);
  await writeFile(path, declaration('debt', 24));
  assert.match((await run({ root })).failures.join('\n'), /24 exceeds ceiling 23/);
  await writeFile(path, declaration('debt', 22));
  assert.deepEqual((await run({ root })).failures, []);
  assert.equal(await readFile(baselinePath, 'utf8'), before);
  await run({ root, update: true });
  assert.deepEqual((await readBaseline(root)).functionComplexity, { [`${FILE}#debt`]: 22 });
  for (const content of [declaration('debt', 20), '']) {
    await writeFile(path, declaration('debt', 22));
    await run({ root, update: true });
    await writeFile(path, content);
    assert.deepEqual((await run({ root })).failures, []);
    await run({ root, update: true });
    assert.deepEqual((await readBaseline(root)).functionComplexity, {});
  }
});

void test('extraction adds a base path without an aggregate penalty', async (t) => {
  const root = await fixture(t);
  const path = join(root, FILE);
  await writeFile(path, declaration('debt', 23));
  await run({ root, update: true });
  await writeFile(path, `${declaration('debt', 12)}\n${declaration('extracted', 12)}`);
  assert.deepEqual((await run({ root })).failures, []);
});

void test('generated files stay excluded even if tracked, while untracked debt is discovered', async (t) => {
  const root = await fixture(t);
  const generated = 'packages/domain/dist/complex.ts';
  await mkdir(join(root, 'packages/domain/dist'), { recursive: true });
  await writeFile(join(root, generated), declaration('generated', 99));
  execFileSync('git', ['add', '-f', generated], { cwd: root });
  assert.deepEqual((await run({ root })).failures, []);
  await writeFile(join(root, FILE), declaration('untracked', 21));
  assert.equal((await run({ root })).failures.length, 1);
});

void test('malformed score maps, missing fields, old versions and complexity threshold drift fail closed', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'code-health-baseline.json');
  const baseline = await readBaseline(root);
  for (const score of [20, 0, -1, 21.5, '21', null, Number.MAX_SAFE_INTEGER + 1]) {
    await writeFile(
      path,
      JSON.stringify({ ...baseline, functionComplexity: { [`${FILE}#debt`]: score } })
    );
    await assert.rejects(readBaseline(root), /invalid function score map/);
  }
  for (const functionComplexity of [[], null, { invalid: 21 }, undefined]) {
    await writeFile(path, JSON.stringify({ ...baseline, functionComplexity }));
    await assert.rejects(readBaseline(root), /baseline.*(object|score map|missing keys)/);
  }
  await writeFile(path, JSON.stringify({ ...baseline, version: 1 }));
  await assert.rejects(readBaseline(root), /unsupported baseline version/);
  for (const functionComplexity of [
    { variant: 'classic', max: 20 },
    { variant: 'modified', max: 21 }
  ]) {
    await writeFile(
      path,
      JSON.stringify({ ...baseline, thresholds: { ...baseline.thresholds, functionComplexity } })
    );
    await assert.rejects(readBaseline(root), /threshold drift/);
  }
});
