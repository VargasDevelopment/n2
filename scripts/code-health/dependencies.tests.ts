import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { stringify } from 'yaml';

import { run } from './index.js';
import { checkDependencySpecifiers, checkSpecifier } from './policies/dependencies.js';
import { fixture } from './test-helpers.js';

void test('rejects floating aliases, malformed ranges, tags, and unbounded OR branches', () => {
  for (const specifier of [
    'latest',
    '*',
    'x',
    'X',
    '',
    '  ',
    '^',
    'next',
    'beta',
    'canary',
    '>=1',
    '>1.2.3',
    '>=1 || ^2',
    '^1 || >=2',
    '1.2.3 || *',
    'npm:foo@latest',
    'npm:foo@*',
    'npm:foo@x',
    'npm:foo',
    'npm:foo@',
    'npm:@scope/foo',
    'npm:@scope/foo@next',
    'npm:foo@^',
    'npm:foo@>=1',
    'npm:foo@npm:bar@latest',
    'npm:@^1',
    '1.2.3.4',
    null,
    42
  ]) {
    assert.equal(checkSpecifier(specifier), false, JSON.stringify(specifier));
  }
});

void test('accepts bounded semver, exact prereleases, recursive aliases, and allowed protocols', () => {
  for (const specifier of [
    '^1.2.3',
    '~0.5.4',
    '1.2.3',
    '1.2.3-rc.1',
    '>=1 <2',
    '<=2.3.4',
    '1.2 - 2.3',
    '^1 || ~2.0',
    'npm:foo@^1.2.3',
    'npm:@scope/foo@~0.1.0',
    'npm:foo@npm:bar@1.2.3-beta.1',
    'workspace:*',
    'workspace:^',
    'catalog:',
    'catalog:default',
    'link:../local',
    'file:../package.tgz',
    'git://example.com/foo.git',
    'git+https://example.com/foo.git',
    'git+ssh://git@example.com/foo.git',
    'git@example.com:foo.git',
    'ssh://git@example.com/foo.git',
    'github:owner/repo',
    'http://example.com/foo.tgz',
    'https://example.com/foo.tgz'
  ]) {
    assert.equal(checkSpecifier(specifier), true, specifier);
  }
});

void test('checks every importer dependency section, including aliases', () => {
  for (const importer of ['.', 'apps/example']) {
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const specifier of ['latest', '*', '', '^', 'npm:foo@latest', '-', null, 42]) {
        const failures = checkDependencySpecifiers({
          path: 'pnpm-lock.yaml',
          content: stringify({
            lockfileVersion: '9.0',
            importers: { [importer]: { [section]: { foo: { specifier, version: '1.0.0' } } } }
          })
        });
        assert.equal(failures.length, 1);
        assert.ok(failures[0]?.includes(`importers.${importer}.${section}.foo.specifier`));
      }
    }
  }
});

void test('checks default and named catalog specifiers behind catalog references', () => {
  const failures = checkDependencySpecifiers({
    path: 'pnpm-lock.yaml',
    content: `
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      react: { specifier: 'catalog:', version: 19.2.8 }
      foo: { specifier: 'catalog:tools', version: 1.0.0 }
catalogs:
  default:
    react: { specifier: latest, version: 19.2.8 }
  tools:
    foo: { specifier: '*', version: 1.0.0 }
`
  });
  assert.equal(failures.length, 2);
  assert.ok(failures.some((failure) => failure.includes('catalogs.default.react.specifier')));
  assert.ok(failures.some((failure) => failure.includes('catalogs.tools.foo.specifier')));
});

void test('checks merged overrides with the same specifier rule', () => {
  for (const specifier of ['latest', 'npm:foo@latest', '*', '>=1', '^']) {
    const failures = checkDependencySpecifiers({
      path: 'pnpm-lock.yaml',
      content: `lockfileVersion: '9.0'\nimporters: {}\n<<: { overrides: { foo: ${JSON.stringify(specifier)} } }\n`
    });
    assert.equal(failures.length, 1);
    assert.ok(failures[0]?.includes('overrides.foo'));
  }
});

void test('accepts removal and pnpm-resolved $foo overrides', () => {
  // pnpm 10.12.4 writes the range behind "$foo" into overrides, retaining "-" removals.
  assert.deepEqual(
    checkDependencySpecifiers({
      path: 'pnpm-lock.yaml',
      content: `
lockfileVersion: '9.0'
overrides:
  foo: ^1.2.3
  foo>bar: '-'
importers:
  .:
    dependencies:
      foo: { specifier: ^1.2.3, version: 1.2.3 }
`
    }),
    []
  );
});

void test('malformed lockfile structures fail closed', () => {
  for (const content of [
    '[',
    'null',
    '[]',
    '{}',
    'importers: []',
    'importers: { .: [] }',
    'importers: { .: { dependencies: [] } }',
    'importers: { .: { dependencies: null } }',
    'importers: { .: { devDependencies: null } }',
    'importers: { .: { optionalDependencies: null } }',
    'importers: { .: { dependencies: { foo: latest } } }',
    'importers: {}\ncatalogs: []',
    'importers: {}\noverrides: []',
    'importers: {}\ncatalogs: null',
    'importers: {}\noverrides: null'
  ]) {
    assert.throws(() =>
      checkDependencySpecifiers({
        path: 'pnpm-lock.yaml',
        content: content.startsWith('importers:') ? `lockfileVersion: '9.0'\n${content}` : content
      })
    );
  }
});

void test('accepts only supported lockfile versions and rejects a missing version', () => {
  for (const lockfileVersion of ['9.0', '9.1', 9, 9.1]) {
    assert.deepEqual(
      checkDependencySpecifiers({
        path: 'pnpm-lock.yaml',
        content: stringify({ lockfileVersion, importers: {} })
      }),
      []
    );
  }
  for (const lockfileVersion of [undefined, null, '8.0', '10.0', 'future', '9.x', '', true, {}]) {
    assert.throws(
      () =>
        checkDependencySpecifiers({
          path: 'pnpm-lock.yaml',
          content: stringify({ lockfileVersion, importers: {} })
        }),
      /unsupported or missing lockfileVersion.*expected 9\.x/
    );
  }
});

void test('rejects range-rewriting config when only a checksum survives in the lockfile', () => {
  for (const [field, source] of [
    ['packageExtensionsChecksum', 'packageExtensions'],
    ['pnpmfileChecksum', 'pnpmfile hooks']
  ] as const) {
    for (const checksum of ['ca0845776154b19f46dff58e8c2c3cbb', '', null]) {
      const failures = checkDependencySpecifiers({
        path: 'pnpm-lock.yaml',
        content: stringify({ lockfileVersion: '9.0', [field]: checksum, importers: {} })
      });
      assert.equal(failures.length, 1);
      assert.match(failures[0] ?? '', new RegExp(`${source} aren't validated.*check their ranges`));
    }
  }
});

void test('reports extensions alongside a missing or unsupported lockfile version', () => {
  for (const lockfileVersion of [undefined, '10.0']) {
    assert.throws(
      () =>
        checkDependencySpecifiers({
          path: 'pnpm-lock.yaml',
          content: stringify({
            lockfileVersion,
            packageExtensionsChecksum: 'checksum',
            importers: {}
          })
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /packageExtensions aren't validated/);
        assert.match(error.message, /unsupported or missing lockfileVersion/);
        return true;
      }
    );
  }
});

void test('unsupported lockfiles and package extensions cannot be baselined', async (t) => {
  const root = await fixture(t);
  const baselinePath = join(root, 'code-health-baseline.json');
  const baseline = await readFile(baselinePath, 'utf8');
  for (const content of [
    'importers: {}\n',
    "lockfileVersion: '10.0'\nimporters: {}\n",
    'importers: [',
    "lockfileVersion: '9.0'\npackageExtensionsChecksum: checksum\nimporters: {}\n"
  ]) {
    await writeFile(join(root, 'pnpm-lock.yaml'), content, 'utf8');
    for (const update of [false, true]) {
      if (content.includes('packageExtensionsChecksum')) {
        const result = await run({ root, update });
        assert.equal(result.updated, false);
        assert.match(result.failures.join('\n'), /packageExtensions aren't validated/);
      } else {
        await assert.rejects(run({ root, update }));
      }
      assert.equal(await readFile(baselinePath, 'utf8'), baseline);
    }
  }
});

void test('the current repository lockfile passes', async () => {
  const content = await readFile(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8');
  assert.deepEqual(checkDependencySpecifiers({ path: 'pnpm-lock.yaml', content }), []);
});

void test('lockfile violations block the gate and baseline updates', async (t) => {
  const root = await fixture(t);
  const baselinePath = join(root, 'code-health-baseline.json');
  const baseline = await readFile(baselinePath, 'utf8');
  await writeFile(
    join(root, 'pnpm-lock.yaml'),
    `
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      foo: { specifier: 'npm:foo@latest', version: 1.0.0 }
<<: { overrides: { bar: latest } }
catalogs:
  tools:
    baz: { specifier: '*', version: 1.0.0 }
`,
    'utf8'
  );
  for (const update of [false, true]) {
    const result = await run({ root, update });
    assert.equal(result.updated, false);
    assert.equal(result.failures.length, 3);
    assert.ok(result.failures.every((failure) => failure.startsWith('pnpm-lock.yaml:')));
    assert.equal(await readFile(baselinePath, 'utf8'), baseline);
  }
});

void test('a missing lockfile fails closed', async (t) => {
  const root = await fixture(t);
  await rm(join(root, 'pnpm-lock.yaml'));
  await assert.rejects(run({ root }), /pnpm-lock\.yaml/);
});
