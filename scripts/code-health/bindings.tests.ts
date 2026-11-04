import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

import { collectImports } from './policies/typescriptBindings.js';

function bindings(content: string) {
  return collectImports(ts.createSourceFile('bindings.ts', content, ts.ScriptTarget.Latest, true));
}

void test('process imports retain default, namespace and named exit aliases only at runtime', () => {
  const result = bindings(`
    import processObject, { exit, exit as terminate, env, type exit as typeExit } from 'process';
    import nodeProcess from 'node:process';
    import * as processNamespace from 'node:process';
    import type typeProcess from 'node:process';
    import type { exit as otherTypeExit } from 'process';
    import { exit as unrelatedExit } from 'unrelated';
    import 'process';
    const local = true;
  `);
  assert.deepEqual(
    [...result.processObjects],
    ['processObject', 'nodeProcess', 'processNamespace']
  );
  assert.deepEqual([...result.processExitFunctions], ['exit', 'terminate']);
});

void test('test imports preserve named aliases and namespaces while ignoring type-only imports', () => {
  const result = bindings(`
    import ignoredDefault, { test, it as spec, type describe as typeDescribe } from 'vitest';
    import * as tests from 'vitest';
    import type * as typeTests from 'vitest';
    import type { test as typeTest } from 'vitest';
    import { it as unrelatedIt } from 'unrelated';
    import 'vitest';
  `);
  assert.deepEqual(
    [...result.tests.namedRoots],
    [
      ['test', 'test'],
      ['spec', 'it']
    ]
  );
  assert.deepEqual([...result.tests.namespaces], ['tests']);
});
