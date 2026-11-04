export const BASELINE_VERSION = 2;

export const LARGE_FILE_CATEGORIES = ['analyzer', 'production', 'test'] as const;
export type LargeFileCategory = (typeof LARGE_FILE_CATEGORIES)[number];

export const THRESHOLDS = Object.freeze({
  largeFileLines: Object.freeze({ analyzer: 500, production: 500, test: 700 }),
  functionComplexity: Object.freeze({ variant: 'modified', max: 20 } as const)
}) satisfies Readonly<{
  largeFileLines: Readonly<Record<LargeFileCategory, number>>;
  functionComplexity: Readonly<{ variant: 'modified'; max: number }>;
}>;

export const METRIC_NAMES = Object.freeze([
  'tsSuppressions',
  'unsafeCasts',
  'eslintDisables',
  'skippedTests',
  'exclusiveTests',
  'brokenRelativeMarkdownLinks',
  'unsanctionedProcessExit',
  'rawColorLiterals',
  'designTokenReferences',
  'designTokenAllowances'
] as const);
export type MetricName = (typeof METRIC_NAMES)[number];

export const GENERATED_DIRECTORY_NAMES = Object.freeze([
  '.next',
  '.pnpm-store',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'out'
] as const);
