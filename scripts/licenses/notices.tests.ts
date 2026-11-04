import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assertAllowed, assertCurrent, inlinedRuntimeFor, renderNotices } from './notices.js';

void test('requires explicit approval for unknown, missing, and compound licenses', () => {
  for (const license of [
    'MIT',
    'ISC',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'Apache-2.0',
    'OFL-1.1',
    'BSL-1.0'
  ]) {
    assert.doesNotThrow(() => assertAllowed(license, 'example'));
  }
  for (const license of ['', 'UNKNOWN', 'UNLICENSED', 'GPL-3.0-only', 'MIT OR GPL-3.0-only']) {
    assert.throws(() => assertAllowed(license, 'example'), /Unapproved production license/);
  }
});

void test('reproduces notices with font attribution and exact lockfile fingerprint', () => {
  const notices = renderNotices(process.cwd());
  assertCurrent(readFileSync('THIRD_PARTY_NOTICES', 'utf8'), notices);
  const hash = createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex');
  assert.ok(notices.includes(`pnpm-lock.yaml SHA-256: ${hash}`));
  assert.ok(notices.includes('Copyright 2019 The Syne Project Authors'));
  assert.ok(notices.includes('SIL OPEN FONT LICENSE Version 1.1'));
  assert.ok(notices.includes('drizzle-orm@0.45.2'));
  assert.ok(notices.includes('Apache License'));
  assert.match(notices, /^vite@\S+\nLicense: MIT$/m);
  assert.match(notices, /^rolldown@\S+\nLicense: MIT$/m);
  assert.match(notices, /^esbuild@\S+\nLicense: MIT$/m);
  // Rolldown's own upstream notices (Rollup, esbuild) travel with its runtime helpers.
  assert.ok(notices.includes('THIRD-PARTY-LICENSE'));
  assert.ok(notices.includes('Copyright (c) 2020 Evan Wallace'));
  assert.throws(
    () => assertCurrent(notices.replace(hash, 'changed-lockfile'), notices),
    /is stale/
  );
  assert.throws(
    () => assertCurrent(notices.replace('Copyright 2019', 'Copyright 2020'), notices),
    /is stale/
  );
});

void test('requires review before a new build command can ship bundler runtime', () => {
  assert.deepEqual(inlinedRuntimeFor('tsc -p tsconfig.json'), []);
  assert.throws(() => inlinedRuntimeFor('webpack'), /Unreviewed build command/);
});
