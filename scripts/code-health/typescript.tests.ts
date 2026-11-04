import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { run } from './index.js';
import type { MetricName } from './config.js';
import { fixture } from './test-helpers.js';
import type { Metrics } from './types.js';

function assertMetricCount(metrics: Metrics, metric: MetricName, expected: number): void {
  assert.equal(metrics[metric].length, expected);
}

void test('detects chained and legacy test modifiers', async (t) => {
  const root = await fixture(t);
  const roots = ['describe', 'it', 'suite', 'test'];
  const disabled = roots.flatMap((rootName) => [
    `${rootName}.skip('skip ${rootName}', () => {});`,
    `${rootName}.todo('todo ${rootName}');`
  ]);
  const exclusive = roots.map((rootName) => `${rootName}.only('only ${rootName}', () => {});`);
  const conditional = roots.flatMap((rootName) => [
    `${rootName}.skipIf(condition)('skip-if ${rootName}', () => {});`,
    `${rootName}.runIf(condition)('run-if ${rootName}', () => {});`
  ]);
  await writeFile(
    join(root, 'packages/domain/src/modifiers.ts'),
    [
      "import { describe as context, fit as focused, test as spec, xit as disabled } from 'vitest';",
      "import * as testing from 'vitest';",
      ...disabled,
      ...exclusive,
      ...conditional,
      "test.skip.each([[1]])('skip each', () => {});",
      "test.concurrent.skip('skip concurrent', () => {});",
      "it.skip.each`value`('skip table', () => {});",
      "it.concurrent.todo('todo concurrent');",
      "describe.only.each([[1]])('only each', () => {});",
      "test.concurrent.only('only concurrent', () => {});",
      "it.only.each([[1]])('only each', () => {});",
      "test('skip option', { skip: true }, () => {});",
      "it('skip reason', { skip: 'reason' }, () => {});",
      "suite('todo option', { todo: true }, () => {});",
      "describe('only option', { only: true }, () => {});",
      "test('dynamic skip option', { skip: shouldSkip }, () => {});",
      "test('parenthesized skip', ({ skip: true }), () => {});",
      "test('asserted todo', ({ todo: true } as const), () => {});",
      "suite('satisfies skip', ({ skip: true } satisfies Record<string, unknown>), () => {});",
      "it('angle asserted skip', (<const>{ skip: true }), () => {});",
      "describe('asserted only', ({ only: true } as const), () => {});",
      "test('false controls', { skip: false, todo: false, only: false }, () => {});",
      "test('parenthesized false controls', { skip: (false), todo: ((false)), only: (false) }, () => {});",
      "it('asserted false controls', { skip: false as const, todo: <false>false, only: false satisfies boolean }, () => {});",
      "suite('non-null false controls', { skip: false!, todo: false!, only: false! }, () => {});",
      "spec.skip('aliased skip', () => {});",
      "context.only('aliased only', () => {});",
      "disabled('aliased legacy skip', () => {});",
      "focused('aliased legacy focus', () => {});",
      "testing.test.skip('namespace skip', () => {});",
      "testing.describe.only('namespace only', () => {});",
      "testing.test('namespace skip option', { skip: true }, () => {});",
      "test('computed skip option', { ['skip']: true }, () => {});",
      "describe('computed only option', { [`only`]: true }, () => {});",
      "test('computed false option', { ['skip']: false as const }, () => {});",
      "test('dynamic computed option', { [controlName]: true }, () => {});",
      "const skippedOptions = { skip: true }; test('bound skip option', skippedOptions, () => {});",
      "const exclusiveOptions = { only: true } as const; describe('bound only option', exclusiveOptions, () => {});",
      "const enabledOptions = { skip: false, only: false }; test('bound enabled options', enabledOptions, () => {});",
      "xit('legacy skip', () => {});",
      "fit('legacy focus', () => {});"
    ].join('\n'),
    'utf8'
  );
  const { metrics } = (await run({ root })).report;
  assertMetricCount(metrics, 'skippedTests', disabled.length + conditional.length + 19);
  assertMetricCount(metrics, 'exclusiveTests', exclusive.length + 11);
});

void test('AST policies ignore text and cover both assertion syntaxes', async (t) => {
  const root = await fixture(t);
  await writeFile(
    join(root, 'packages/domain/src/policies.ts'),
    [
      `const policyText = "@ts-ignore eslint-disable process.exit(1) test.only('x') as any";`,
      `const url = 'https://example.test/path'; process.exit(1);`,
      '// Replace @ts-ignore workarounds without adding another suppression.',
      '// Avoid eslint-disable directives in production code.',
      '/* prose mentioning @ts-expect-error and eslint-disable */',
      '// @ts-ignore real directive',
      '/* @ts-expect-error real block directive */',
      '// eslint-disable-next-line real directive',
      '/* eslint-disable no-alert */',
      'const late = true;',
      '// @ts-nocheck too late to affect the file',
      '/* eslint no-alert: off, eqeqeq: "error" */',
      '/* eslint "no-console": 0, curly: 2 */',
      '/* eslint @typescript-eslint/no-explicit-any: ["off", { fixToUnknown: true }] */',
      '/* eslint no-debugger: error, semi: [2, "always"] */',
      'const first = value as any;',
      'const angleAny = <any>value;',
      'const second = value as unknown as string;',
      'const angleDouble = <string><unknown>value;',
      'const mixedAs = (<unknown>value) as string;',
      'const mixedAngle = <string>(value as unknown);',
      'const nonNullDouble = (value as unknown)! as string;',
      'const satisfiesDouble = ((value as unknown) satisfies unknown) as string;',
      `process['exit'](2);`,
      "import { exit as terminate } from 'node:process'; terminate(3);",
      "import * as nodeProcess from 'node:process'; nodeProcess.exit(4);",
      "test.only('focused', () => {});"
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    join(root, 'packages/domain/src/policy-text.tsx'),
    'export const PolicyText = () => <div>// @ts-ignore eslint-disable</div>;\n',
    'utf8'
  );
  await writeFile(
    join(root, 'packages/domain/src/nocheck.ts'),
    '// @ts-nocheck generated file\nexport const unchecked = missingValue;\n',
    'utf8'
  );
  await writeFile(
    join(root, 'packages/domain/src/nocheck-colon.ts'),
    '// @ts-nocheck: generated file\nexport const uncheckedColon = missingValue;\n',
    'utf8'
  );
  const { metrics } = (await run({ root })).report;
  assertMetricCount(metrics, 'tsSuppressions', 4);
  assertMetricCount(metrics, 'eslintDisables', 5);
  assertMetricCount(metrics, 'unsafeCasts', 8);
  assertMetricCount(metrics, 'unsanctionedProcessExit', 4);
  assertMetricCount(metrics, 'exclusiveTests', 1);
});

void test('directive owner anchors survive line shifts but change across statements', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'packages/domain/src/anchored.ts');
  await writeFile(path, '// @ts-ignore same\nconst first = one;\nconst second = two;\n', 'utf8');
  execFileSync('git', ['add', 'packages/domain/src/anchored.ts'], { cwd: root });
  await run({ root, update: true });
  await writeFile(path, '\n// @ts-ignore same\nconst first = one;\nconst second = two;\n', 'utf8');
  assert.deepEqual((await run({ root })).failures, []);
  await writeFile(path, 'const first = one;\n// @ts-ignore same\nconst second = two;\n', 'utf8');
  assert.match((await run({ root })).failures.join('\n'), /offense fingerprint/);
});
