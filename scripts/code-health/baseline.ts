import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import {
  BASELINE_VERSION,
  LARGE_FILE_CATEGORIES,
  METRIC_NAMES,
  THRESHOLDS,
  type LargeFileCategory,
  type MetricName
} from './config.js';
import { errorMessage, recordFromKeys } from './helpers.js';
import type { Baseline, BaselineMetrics, LargeFiles, Offense, Report } from './types.js';

const BASELINE_FILE = 'code-health-baseline.json';

function sortedMap<Value>(map: Readonly<Record<string, Value>>): Record<string, Value> {
  return Object.fromEntries(
    Object.entries(map).sort(([left], [right]) => left.localeCompare(right))
  );
}

export function offenseFingerprint(metric: MetricName, offense: Offense): string {
  const digest = createHash('sha256')
    .update(`${metric}\0${offense.path}\0${offense.context}`)
    .digest('hex');
  return `${offense.path}#${digest}`;
}

export function snapshot(report: Report): Baseline {
  const largeFiles: LargeFiles = recordFromKeys(LARGE_FILE_CATEGORIES, (category) =>
    sortedMap(report.largeFiles[category])
  );
  const metrics: BaselineMetrics = recordFromKeys(METRIC_NAMES, (name) => {
    const fingerprints: Record<string, number> = {};
    for (const offense of report.metrics[name]) {
      const fingerprint = offenseFingerprint(name, offense);
      fingerprints[fingerprint] = (fingerprints[fingerprint] ?? 0) + 1;
    }
    return sortedMap(fingerprints);
  });
  return {
    version: BASELINE_VERSION,
    thresholds: THRESHOLDS,
    largeFiles,
    functionComplexity: sortedMap(
      Object.fromEntries(
        Object.entries(report.functionComplexity)
          .filter(([, item]) => item.score > THRESHOLDS.functionComplexity.max)
          .map(([id, item]) => [id, item.score])
      )
    ),
    metrics
  };
}

function totalValues(map: Readonly<Record<string, number>>): number {
  return Object.values(map).reduce((sum, value) => sum + value, 0);
}

export async function writeBaseline(root: string, report: Report): Promise<void> {
  const destination = join(root, BASELINE_FILE);
  const temporary = join(root, `.${BASELINE_FILE}.${process.pid}.${randomUUID()}.tmp`);
  const content = `${JSON.stringify(snapshot(report), null, 2)}\n`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', 0o666);
    await handle.chmod(0o644);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, destination);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(
  value: unknown,
  expected: readonly string[],
  label: string
): asserts value is Record<string, unknown> {
  assertRecord(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} has unknown or missing keys`);
  }
}

function readFingerprintMap(value: unknown, metric: MetricName): Record<string, number> {
  const label = `baseline metric ${metric}`;
  assertRecord(value, label);
  const result: Record<string, number> = {};
  for (const [fingerprint, multiplicity] of Object.entries(value)) {
    if (
      !/^.+#[a-f0-9]{64}$/.test(fingerprint) ||
      !Number.isSafeInteger(multiplicity) ||
      typeof multiplicity !== 'number' ||
      multiplicity <= 0
    ) {
      throw new Error(`${label} has an invalid fingerprint map`);
    }
    result[fingerprint] = multiplicity;
  }
  return result;
}

function readLargeFileMap(value: unknown, category: LargeFileCategory): Record<string, number> {
  const label = `baseline largeFiles.${category}`;
  assertRecord(value, label);
  const result: Record<string, number> = {};
  for (const [path, lines] of Object.entries(value)) {
    if (
      !path ||
      !Number.isSafeInteger(lines) ||
      typeof lines !== 'number' ||
      lines <= THRESHOLDS.largeFileLines[category]
    ) {
      throw new Error(`${label} has an invalid path map`);
    }
    result[path] = lines;
  }
  return result;
}

function readComplexityMap(value: unknown): Record<string, number> {
  const label = 'baseline functionComplexity';
  assertRecord(value, label);
  const result: Record<string, number> = {};
  for (const [id, score] of Object.entries(value)) {
    if (
      !/^.+#[^#\s]+$/.test(id) ||
      typeof score !== 'number' ||
      !Number.isSafeInteger(score) ||
      score <= THRESHOLDS.functionComplexity.max
    ) {
      throw new Error(`${label} has an invalid function score map`);
    }
    result[id] = score;
  }
  return result;
}

export async function readBaseline(root: string): Promise<Baseline> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(root, BASELINE_FILE), 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`baseline is missing or malformed: ${errorMessage(error)}`, { cause: error });
  }
  assertExactKeys(
    parsed,
    ['version', 'thresholds', 'largeFiles', 'metrics', 'functionComplexity'],
    'baseline'
  );
  if (parsed.version !== BASELINE_VERSION) {
    throw new Error(`unsupported baseline version: ${String(parsed.version)}`);
  }
  if (JSON.stringify(parsed.thresholds) !== JSON.stringify(THRESHOLDS)) {
    throw new Error('baseline threshold drift; run the explicit update command and review it');
  }

  const parsedMetrics = parsed.metrics;
  assertExactKeys(parsedMetrics, METRIC_NAMES, 'baseline metrics');
  const metrics = recordFromKeys(METRIC_NAMES, (name) =>
    readFingerprintMap(parsedMetrics[name], name)
  );

  const parsedLargeFiles = parsed.largeFiles;
  assertExactKeys(parsedLargeFiles, LARGE_FILE_CATEGORIES, 'baseline largeFiles');
  const largeFiles = recordFromKeys(LARGE_FILE_CATEGORIES, (category) =>
    readLargeFileMap(parsedLargeFiles[category], category)
  );

  return {
    version: parsed.version,
    thresholds: THRESHOLDS,
    metrics,
    functionComplexity: readComplexityMap(parsed.functionComplexity),
    largeFiles
  };
}

export function compare(report: Report, baseline: Baseline): string[] {
  const failures: string[] = [];
  const current = snapshot(report);
  for (const name of METRIC_NAMES) {
    const currentMap = current.metrics[name];
    const ceiling = baseline.metrics[name];
    const currentCount = totalValues(currentMap);
    const ceilingCount = totalValues(ceiling);
    let regressed = false;
    if (currentCount > ceilingCount) {
      failures.push(`${name}: ${currentCount} exceeds aggregate baseline ${ceilingCount}`);
      regressed = true;
    }
    for (const [fingerprint, multiplicity] of Object.entries(currentMap)) {
      if (multiplicity > (ceiling[fingerprint] ?? 0)) {
        failures.push(
          `${name}: new or increased offense fingerprint ${fingerprint} (${multiplicity} > ${ceiling[fingerprint] ?? 0})`
        );
        regressed = true;
      }
    }
    if (regressed) {
      failures.push(
        ...report.metrics[name].map((item) => `  ${item.path}:${item.line} ${item.message}`)
      );
    }
  }

  for (const [id, item] of Object.entries(report.functionComplexity)) {
    const ceiling = baseline.functionComplexity[id] ?? THRESHOLDS.functionComplexity.max;
    if (item.score > THRESHOLDS.functionComplexity.max && item.score > ceiling) {
      failures.push(
        `${item.path}:${item.line}:${item.column} functionComplexity ${id}: ${item.score} exceeds ceiling ${ceiling}; simplify the function, or run pnpm code-health:update and review the baseline diff with justification`
      );
    }
  }

  for (const category of LARGE_FILE_CATEGORIES) {
    const currentFiles = current.largeFiles[category];
    const ceiling = baseline.largeFiles[category];
    const currentCount = Object.keys(currentFiles).length;
    const ceilingCount = Object.keys(ceiling).length;
    const currentLines = totalValues(currentFiles);
    const ceilingLines = totalValues(ceiling);
    if (currentCount > ceilingCount) {
      failures.push(
        `${category} large-file count: ${currentCount} exceeds baseline ${ceilingCount}`
      );
    }
    if (currentLines > ceilingLines) {
      failures.push(
        `${category} oversized aggregate lines: ${currentLines} exceeds baseline ${ceilingLines}`
      );
    }
    for (const [path, lines] of Object.entries(currentFiles)) {
      const previousLines = ceiling[path];
      if (previousLines === undefined) {
        failures.push(`${path}: new oversized ${category} file (${lines} lines)`);
      } else if (lines > previousLines) {
        failures.push(`${path}: grew to ${lines} lines from baseline ${previousLines}`);
      }
    }
  }
  return failures;
}
