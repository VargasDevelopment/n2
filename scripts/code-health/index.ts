#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyze } from './analyze.js';
import { compare, readBaseline, writeBaseline } from './baseline.js';
import { discoverPaths, isTextFile, readFiles } from './files.js';
import { errorMessage } from './helpers.js';
import { checkDependencySpecifiers } from './policies/dependencies.js';
import type { RunResult } from './types.js';

interface RunOptions {
  readonly root?: string;
  readonly update?: boolean;
}

export async function run({
  root = process.cwd(),
  update = false
}: RunOptions = {}): Promise<RunResult> {
  const repositoryPaths = discoverPaths(root);
  const paths = repositoryPaths.filter(isTextFile);
  const [files, [lockfile]] = await Promise.all([
    readFiles(root, paths),
    readFiles(root, ['pnpm-lock.yaml'])
  ]);
  if (!lockfile) throw new Error('pnpm-lock.yaml is required for the dependency policy');
  const failures = checkDependencySpecifiers(lockfile);
  const report = analyze(files, repositoryPaths);
  if (update) {
    if (failures.length) return { report, failures, updated: false };
    await writeBaseline(root, report);
    return { report, failures: [], updated: true };
  }
  failures.push(...compare(report, await readBaseline(root)));
  return { report, failures, updated: false };
}

async function main(): Promise<void> {
  const update = process.argv.slice(2).includes('--update');
  const unknown = process.argv.slice(2).filter((argument) => argument !== '--update');
  if (unknown.length) throw new Error(`unknown arguments: ${unknown.join(', ')}`);

  const result = await run({ update });
  if (result.updated) {
    console.log('Updated code-health-baseline.json; review and explain all increases.');
  } else if (result.failures.length) {
    console.error(`Code-health ratchet failed:\n${result.failures.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('Code-health ratchet passed.');
  }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Code-health analyzer error: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
