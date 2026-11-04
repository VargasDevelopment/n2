import type { LargeFileCategory, MetricName, THRESHOLDS } from './config.js';

export interface RepositoryFile {
  readonly path: string;
  readonly content: string;
}

export interface Offense {
  readonly path: string;
  readonly line: number;
  readonly message: string;
  readonly context: string;
}

export type Metrics = Record<MetricName, Offense[]>;
export type LargeFiles = Record<LargeFileCategory, Record<string, number>>;

export interface FunctionComplexity {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly score: number;
}

export type FunctionComplexities = Record<string, FunctionComplexity>;

export interface Report {
  readonly functionComplexity: FunctionComplexities;
  readonly largeFiles: LargeFiles;
  readonly metrics: Metrics;
}

export type BaselineMetrics = Record<MetricName, Record<string, number>>;

export interface Baseline {
  readonly version: number;
  readonly thresholds: typeof THRESHOLDS;
  readonly functionComplexity: Record<string, number>;
  readonly largeFiles: LargeFiles;
  readonly metrics: BaselineMetrics;
}

export interface RunResult {
  readonly report: Report;
  readonly failures: string[];
  readonly updated: boolean;
}
