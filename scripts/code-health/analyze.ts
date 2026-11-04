import { extname } from 'node:path';

import { LARGE_FILE_CATEGORIES, METRIC_NAMES, THRESHOLDS } from './config.js';
import { classifyFile, isCodeFile } from './files.js';
import { countLines, lineNumber, recordFromKeys } from './helpers.js';
import { analyzeComplexity } from './policies/complexity.js';
import { analyzeDesignTokens } from './policies/designTokens.js';
import { analyzeMarkdown, repositoryTargets } from './policies/markdown.js';
import { analyzeTypeScript } from './policies/typescript.js';
import type { FunctionComplexities, LargeFiles, Metrics, Report, RepositoryFile } from './types.js';

export { countLines, lineNumber };

export function analyze(
  files: RepositoryFile[],
  repositoryPaths: string[] = files.map((file) => file.path)
): Report {
  const functionComplexity: FunctionComplexities = {};
  const metrics: Metrics = recordFromKeys(METRIC_NAMES, () => []);
  const largeFiles: LargeFiles = recordFromKeys(LARGE_FILE_CATEGORIES, () => ({}));
  const allowedTargets = repositoryTargets(repositoryPaths);

  for (const file of files) {
    const category = classifyFile(file.path);
    if (category) {
      const lines = countLines(file.content);
      if (lines > THRESHOLDS.largeFileLines[category]) {
        largeFiles[category][file.path] = lines;
      }
    }
    if (isCodeFile(file.path)) {
      analyzeTypeScript(metrics, file);
      Object.assign(functionComplexity, analyzeComplexity(file));
    }
    if (extname(file.path).toLowerCase() === '.md') {
      analyzeMarkdown(metrics, file, allowedTargets);
    }
  }
  analyzeDesignTokens(metrics, files);
  for (const offenses of Object.values(metrics)) {
    offenses.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line);
  }
  return { largeFiles, metrics, functionComplexity };
}
