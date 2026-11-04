import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

import { GENERATED_DIRECTORY_NAMES } from './config.js';
import type { LargeFileCategory } from './config.js';
import { errorMessage } from './helpers.js';
import type { RepositoryFile } from './types.js';

export const CODE_EXTENSIONS = [
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx'
] as const;

const TEXT_EXTENSIONS = new Set<string>([
  ...CODE_EXTENSIONS,
  '.css',
  '.html',
  '.json',
  '.md',
  '.scss',
  '.yaml',
  '.yml'
]);
const CODE_EXTENSION_SET = new Set<string>(CODE_EXTENSIONS);
const TEST_DIRECTORY_NAMES = new Set([
  '__spec__',
  '__specs__',
  '__test__',
  '__tests__',
  'spec',
  'specs',
  'test',
  'tests'
]);
const TEST_STEM_SUFFIXES = ['.spec', '.specs', '.test', '.tests'] as const;
const GENERATED_DIRECTORIES = new Set<string>(GENERATED_DIRECTORY_NAMES);

export function isGenerated(path: string): boolean {
  const segments = path.split('/');
  return (
    segments.some((segment) => GENERATED_DIRECTORIES.has(segment)) || path === 'pnpm-lock.yaml'
  );
}

export function isTextFile(path: string): boolean {
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

export function isCodeFile(path: string): boolean {
  return CODE_EXTENSION_SET.has(extname(path).toLowerCase());
}

function hasTestFileSuffix(path: string): boolean {
  const extension = extname(path).toLowerCase();
  if (!CODE_EXTENSION_SET.has(extension)) return false;
  const stem = path.slice(0, -extension.length);
  return TEST_STEM_SUFFIXES.some((suffix) => stem.endsWith(suffix));
}

export function classifyFile(path: string): LargeFileCategory | null {
  if (path.startsWith('scripts/code-health/')) return 'analyzer';
  if (
    path.split('/').some((segment) => TEST_DIRECTORY_NAMES.has(segment)) ||
    hasTestFileSuffix(path)
  ) {
    return 'test';
  }
  if (/^(?:apps|packages)\/[^/]+\/src\//.test(path)) return 'production';
  return null;
}

export function resolveRepositoryPath(root: string, path: string): string {
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, path);
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`repository path escapes root: ${path}`);
  }
  return candidate;
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

interface RepositoryPathInspection {
  readonly candidate: string;
  readonly canonical: string;
  readonly symlink: boolean;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === code
  );
}

export function inspectRepositoryPath(root: string, path: string): RepositoryPathInspection | null {
  const candidate = resolveRepositoryPath(root, path);
  let entry;
  try {
    entry = lstatSync(candidate);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  }
  const canonicalRoot = realpathSync(resolve(root));
  let canonical;
  try {
    canonical = realpathSync(candidate);
  } catch (error) {
    throw new Error(`repository path cannot be resolved: ${path}: ${errorMessage(error)}`, {
      cause: error
    });
  }
  if (!isInside(canonicalRoot, canonical)) {
    throw new Error(`repository symlink escapes root: ${path} -> ${canonical}`);
  }
  const target = statSync(canonical);
  if (!target.isFile()) throw new Error(`repository path is not a regular file: ${path}`);
  return { candidate, canonical, symlink: entry.isSymbolicLink() };
}

export function discoverPaths(root: string): string[] {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(`git file discovery failed: ${result.stderr.trim() || 'unknown error'}`);
  }
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .filter((path) => inspectRepositoryPath(root, path) !== null)
    .filter((path) => !isGenerated(path))
    .sort();
}

export function discoverFiles(root: string): string[] {
  return discoverPaths(root).filter(isTextFile);
}

export async function readFiles(root: string, paths: string[]): Promise<RepositoryFile[]> {
  return Promise.all(
    paths.map(async (path) => {
      const inspected = inspectRepositoryPath(root, path);
      if (!inspected) throw new Error(`repository file disappeared before read: ${path}`);
      const handle = await open(inspected.canonical, 'r');
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new Error(`repository path is not a regular file: ${path}`);
        return { path, content: await handle.readFile('utf8') };
      } finally {
        await handle.close();
      }
    })
  );
}
