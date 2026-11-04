import { Range, validRange } from 'semver';
import { parse } from 'yaml';

import type { RepositoryFile } from '../types.js';

const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, location: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${location} must be an object`);
  return value;
}

export function checkSpecifier(spec: unknown): boolean {
  if (typeof spec !== 'string' || !spec.trim()) return false;
  const value = spec.trim();
  if (
    /^(?:workspace:|catalog:|link:|file:|github:|(?:git(?:\+(?:https?|ssh|file))?|https?|ssh):\/\/|git@)/i.test(
      value
    )
  ) {
    return true;
  }
  if (value.startsWith('npm:')) {
    const alias = /^npm:(?:@[^/@\s]+\/)?[^/@\s]+@(.+)$/.exec(value);
    return alias?.[1] !== undefined && checkSpecifier(alias[1]);
  }
  const range = validRange(value);
  if (range === null) return false;
  // Every OR branch needs an upper bound; an empty comparator denotes any version.
  return new Range(range).set.every((comparators) =>
    comparators.some(({ operator, value }) => value !== '' && ['', '<', '<='].includes(operator))
  );
}

// Config that rewrites dependency ranges but leaves only a checksum in the lockfile,
// so the ranges it introduces can't be checked here.
const CHECKSUM_ONLY_MUTATIONS = [
  { field: 'packageExtensionsChecksum', source: 'packageExtensions' },
  { field: 'pnpmfileChecksum', source: 'pnpmfile hooks' }
] as const;

export function checkDependencySpecifiers(file: RepositoryFile): string[] {
  // pnpm's resolved truth includes config merges, catalogs, and $ref overrides;
  // frozen installs keep this lockfile in sync with the manifests.
  const lockfile = record(parse(file.content, { merge: true }), file.path);
  const failures = CHECKSUM_ONLY_MUTATIONS.filter(({ field }) =>
    Object.hasOwn(lockfile, field)
  ).map(
    ({ source }) =>
      `${file.path}: ${source} aren't validated by this policy; teach it to check their ranges before adding any`
  );
  const version = lockfile.lockfileVersion;
  if (
    (typeof version !== 'string' && typeof version !== 'number') ||
    !/^9(?:\.\d+)?$/.test(String(version))
  ) {
    throw new Error(
      [
        ...failures,
        `${file.path}: unsupported or missing lockfileVersion ${JSON.stringify(version)}; expected 9.x`
      ].join('\n')
    );
  }
  const { importers, overrides = {}, catalogs = {} } = lockfile;
  const check = (specifier: unknown, location: string): void => {
    if (!checkSpecifier(specifier)) {
      failures.push(
        `${file.path}: ${location} has forbidden dependency specifier ${JSON.stringify(specifier)}; use a bounded semver range or an allowed protocol`
      );
    }
  };
  for (const [name, value] of Object.entries(record(importers, 'importers'))) {
    const importer = record(value, `importers.${name}`);
    for (const section of DEPENDENCY_SECTIONS) {
      const location = `importers.${name}.${section}`;
      const { [section]: dependencies = {} } = importer;
      for (const [dependency, entry] of Object.entries(record(dependencies, location))) {
        const path = `${location}.${dependency}.specifier`;
        check(record(entry, path).specifier, path);
      }
    }
  }
  for (const [selector, specifier] of Object.entries(record(overrides, 'overrides'))) {
    if (specifier !== '-') check(specifier, `overrides.${selector}`);
  }
  for (const [name, value] of Object.entries(record(catalogs, 'catalogs'))) {
    const location = `catalogs.${name}`;
    for (const [dependency, entry] of Object.entries(record(value, location))) {
      const path = `${location}.${dependency}.specifier`;
      check(record(entry, path).specifier, path);
    }
  }
  return failures;
}
