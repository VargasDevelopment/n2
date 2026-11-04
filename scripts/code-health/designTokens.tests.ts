import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import type { MetricName } from './config.js';
import { run } from './index.js';
import { fixture } from './test-helpers.js';

const TOKENS = [
  '@layer tokens.palette { :root { --palette-ink: #111218; } }',
  '@layer tokens.semantic { :root { --color-surface: var(--palette-ink); } }',
  '@layer tokens.derived { :root { --color-text-on-accent: var(--color-surface); } }'
].join('\n');

async function writeWebFiles(root: string, files: Record<string, string>): Promise<void> {
  await mkdir(join(root, 'apps/web/src'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(root, 'apps/web/src', name), content, 'utf8');
  }
}

async function offenses(root: string, metric: MetricName) {
  const items = (await run({ root })).report.metrics[metric];
  return items.map(
    (item) => `${item.path.replace('apps/web/src/', '')}:${item.line} ${item.message}`
  );
}

void test('CSS raw colors are allowed only in the tokens.css palette layer', async (t) => {
  const root = await fixture(t);
  await writeWebFiles(root, {
    'tokens.css': `${TOKENS}\n@layer tokens.semantic { :root { --color-sneaky: #fff; } }`,
    'component.css': [
      '/* #ffffff in a comment is fine */',
      '#root { color: var(--color-surface); white-space: nowrap; content: "#abc"; }',
      '.a { color: #fff; background: rgba(0, 0, 0, 0.5); border-color: White; }',
      '.b { mask-image: linear-gradient(currentColor, transparent); }',
      '.c { color-scheme: dark; } .d { color-scheme: var(--color-scheme); } .e { color-scheme: var(--component-scheme); }'
    ].join('\n')
  });
  await writeFile(join(root, 'packages/domain/src/hex.css'), '.x { color: red; }\n');

  const found = await offenses(root, 'rawColorLiterals');
  assert.equal(
    found.filter((item) => item.startsWith('component.css:3')).length,
    3,
    found.join('\n')
  );
  assert.deepEqual(
    found.filter((item) => !item.startsWith('component.css:3')),
    [
      'component.css:5 color-scheme dark bypasses the theme; use var(--color-scheme) from apps/web/src/tokens.css',
      'component.css:5 color-scheme var(--component-scheme) bypasses the theme; use var(--color-scheme) from apps/web/src/tokens.css',
      'tokens.css:4 raw color #fff in --color-sneaky; use a token from apps/web/src/tokens.css'
    ]
  );
});

void test('TS raw colors are found in every string, whatever path paints them', async (t) => {
  const root = await fixture(t);
  await writeWebFiles(root, {
    'tokens.css': TOKENS,
    'colors.tsx': [
      'export const a = <MiniMap nodeColor="red" />;',
      "export const b = 'linear-gradient(#fff,#000)';",
      "export const c = '0 0 4px #fff';",
      'export const d = `rgb(8 9 13 / ${0.78})`;',
      "export const e = (ctx: CanvasRenderingContext2D) => { ctx.fillStyle = 'Red'; };",
      "export const f = (el: HTMLElement) => { el.style.color = 'tomato'; };",
      "export const g = (el: HTMLElement) => el.style.setProperty('color', 'green');",
      "const DANGER = 'crimson';",
      'export const h = <div style={{ color: DANGER }} />;',
      'export const i = <a title="Fix issue #123" />;',
      '// design-tokens-allow: issue numbers in a title are prose',
      'export const j = <a title="Fix issue #123" />;',
      'export const k = <path fill="url(#abc)" />;',
      "export const prose = <p title='Redo the bluebird import'>Pick a white card</p>;",
      "export const keywords = ['transparent', 'currentColor', 'inherit', 'initial', 'unset'];",
      "export const path = '/docs/#abc';",
      "export const l = { border: '1px solid red', boxShadow: '0 0 4px black' };",
      "export const m = 'linear-gradient(red, Blue)';",
      'export const n = (w: number) => `${w}px solid red`;'
    ].join('\n')
  });

  assert.deepEqual(
    (await offenses(root, 'rawColorLiterals')).map((item) => item.split(' ').slice(0, 4).join(' ')),
    [
      'colors.tsx:1 raw color red',
      'colors.tsx:2 raw color #fff',
      'colors.tsx:2 raw color #000',
      'colors.tsx:3 raw color #fff',
      'colors.tsx:4 raw color rgb(',
      'colors.tsx:5 raw color Red',
      'colors.tsx:6 raw color tomato',
      'colors.tsx:7 raw color green',
      'colors.tsx:8 raw color crimson',
      'colors.tsx:10 raw color #123',
      'colors.tsx:17 raw color red',
      'colors.tsx:17 raw color black',
      'colors.tsx:18 raw color red',
      'colors.tsx:18 raw color Blue',
      'colors.tsx:19 raw color red'
    ]
  );
  assert.deepEqual(await offenses(root, 'designTokenAllowances'), [
    'colors.tsx:11 // design-tokens-allow: issue numbers in a title are prose'
  ]);
});

void test('TS never writes color-scheme, whatever the write syntax, but may read it', async (t) => {
  const root = await fixture(t);
  await writeWebFiles(root, {
    'tokens.css': TOKENS,
    'scheme.tsx': [
      "export const a = (el: HTMLElement) => { el.style.colorScheme = 'dark'; };",
      "export const b = (el: HTMLElement) => { el.style['colorScheme'] = 'dark'; };",
      "export const c = { colorScheme: 'dark' };",
      "export const d = { 'colorScheme': 'dark' };",
      "export const e = { ['color-scheme']: 'dark' };",
      'export const f = (colorScheme: string) => ({ colorScheme });',
      "export const g = (el: HTMLElement) => el.style.setProperty('color-scheme', 'dark');",
      "export const h = (el: HTMLElement) => { el.style.cssText = 'color-scheme: dark'; };",
      'export const i = (el: HTMLElement) => getComputedStyle(el).colorScheme;',
      "export const j = (el: HTMLElement) => getComputedStyle(el).getPropertyValue('color-scheme');",
      "export const k = (el: HTMLElement) => el.style['colorScheme'] === 'dark';",
      'export const { colorScheme } = getComputedStyle(document.body);',
      "export const m = <div style={{ color: 'var(--color-scheme)' }} />;"
    ].join('\n')
  });

  assert.deepEqual(
    (await offenses(root, 'rawColorLiterals')).map((item) => item.split(' ').slice(0, 2).join(' ')),
    [1, 2, 3, 4, 5, 6, 7, 8].map((line) => `scheme.tsx:${line} color-scheme`)
  );
});

void test('an allowance fingerprint covers the line it exempts', async (t) => {
  const root = await fixture(t);
  const allow = '// design-tokens-allow: issue numbers are prose';
  const write = (lines: readonly string[]) =>
    writeWebFiles(root, { 'tokens.css': TOKENS, 'notes.ts': lines.join('\n') });
  const allowanceFailures = async () =>
    (await run({ root })).failures.filter((item) => item.startsWith('designTokenAllowances'));
  await write([allow, "export const a = 'Fix #123';"]);
  await run({ root, update: true });

  await write(['export const first = 1;', '', allow, "export const a = 'Fix #123';"]);
  assert.deepEqual((await run({ root })).failures, [], 'a line shift keeps the fingerprint');

  await write([allow, "export const a = { color: 'red', background: 'blue' };"]);
  assert.notDeepEqual(await allowanceFailures(), [], 'replacing the exempted code fails');

  await write(["export const a = 'Fix issue 123';", allow, "export const b = { color: 'red' };"]);
  assert.notDeepEqual(await allowanceFailures(), [], 'moving the allowance fails');
});

void test('token references resolve, stay layered, and come from code rather than comments', async (t) => {
  const root = await fixture(t);
  await writeWebFiles(root, {
    'tokens.css': [
      TOKENS,
      '@layer tokens.derived { :root { --color-detail: var(--palette-ink); } }',
      '@layer tokens.semantic { :root { --color-unused: var(--palette-ink); } }',
      ':root { --color-loose: var(--color-surface); }',
      '@layer tokens.semantic { :root { --color-loop: var(--color-text-on-accent); } }'
    ].join('\n'),
    'component.css': [
      '.a { background: var(--color-surface); color: var(--color-missing); }',
      '.b { border-color: var(--palette-ink); --color-local: var(--color-surface); }',
      '.c { --local-size: 4px; width: var(--local-size); color: var(--color-detail); }',
      '.d { color: var(--color-text-on-accent); outline-color: var(--color-loose); }',
      '.e { color: var(--color-loop); }'
    ].join('\n'),
    'inline.tsx': [
      '// var(--color-ghost) in a comment is neither a reference nor a declaration',
      "export const a = <div style={{ '--color-new': 'var(--color-surface)' }} />;",
      "export const b = (el: HTMLElement) => el.style.setProperty('--gradient-new', 'none');",
      "export const c = (el: HTMLElement) => { el.style.cssText = `--color-css-text: ${'none'}`; };",
      '// design-tokens-allow: nothing here needs it',
      "export const d = 'plain';",
      '// design-tokens-allow: a component-local property needs no allowance',
      "export const e = (el: HTMLElement) => el.style.setProperty('--local-size', '4px');"
    ].join('\n')
  });

  assert.deepEqual(await offenses(root, 'designTokenReferences'), [
    'component.css:1 undefined design token --color-missing',
    'component.css:2 palette token --palette-ink used outside apps/web/src/tokens.css and apps/web/src/themes.css',
    'component.css:2 design token --color-local declared outside apps/web/src/tokens.css',
    'inline.tsx:2 design token --color-new declared outside apps/web/src/tokens.css',
    'inline.tsx:3 design token --gradient-new declared outside apps/web/src/tokens.css',
    'inline.tsx:4 design token --color-css-text declared outside apps/web/src/tokens.css',
    'inline.tsx:5 design-tokens-allow comment exempts nothing on the next line',
    'inline.tsx:7 design-tokens-allow comment exempts nothing on the next line',
    'tokens.css:4 --color-detail in tokens.derived reads --palette-ink from tokens.palette; tokens.derived may read only tokens.semantic and tokens.derived',
    'tokens.css:5 unused design token --color-unused',
    'tokens.css:6 design token --color-loose declared outside a tokens.* layer',
    'tokens.css:7 --color-loop in tokens.semantic reads --color-text-on-accent from tokens.derived; tokens.semantic may read only tokens.palette and tokens.semantic'
  ]);
});

void test('themes.css only overrides semantic tokens, through the palette', async (t) => {
  const root = await fixture(t);
  await writeWebFiles(root, {
    'tokens.css': [
      TOKENS,
      '@layer tokens.palette { :root { --palette-paper: #fbf9f5; } }',
      '@layer tokens.semantic { :root { --color-quiet: var(--palette-ink); } }',
      '.x { color: var(--color-quiet); }'
    ].join('\n'),
    'themes.css': [
      "@layer tokens.semantic { [data-theme='paper'] { --color-surface: var(--palette-paper); } }",
      "@layer tokens.semantic { [data-theme='paper'] { --color-quiet: #fff; } }",
      "@layer tokens.semantic { [data-theme='paper'] { --color-new: var(--palette-ink); } }",
      "@layer tokens.derived { [data-theme='paper'] { --color-text-on-accent: var(--color-surface); } }",
      "@layer tokens.semantic { [data-theme='paper'] { --color-surface: var(--color-text-on-accent); } }"
    ].join('\n'),
    'component.css': '.a { color: var(--color-text-on-accent); }'
  });

  assert.deepEqual(await offenses(root, 'rawColorLiterals'), [
    'themes.css:2 raw color #fff in --color-quiet; use a token from apps/web/src/tokens.css'
  ]);
  // --palette-paper is read only by the theme and still counts as used.
  assert.deepEqual(await offenses(root, 'designTokenReferences'), [
    'themes.css:3 --color-new is not a tokens.semantic override of a tokens.semantic token in apps/web/src/tokens.css',
    'themes.css:4 --color-text-on-accent is not a tokens.semantic override of a tokens.semantic token in apps/web/src/tokens.css',
    'themes.css:5 --color-surface in apps/web/src/themes.css reads --color-text-on-accent from tokens.derived; tokens.semantic may read only tokens.palette and tokens.semantic'
  ]);
});
