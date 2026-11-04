import type { Offense, RepositoryFile } from './types.js';

const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/g;

export function lineNumber(content: string, index: number): number {
  return 1 + [...content.slice(0, index).matchAll(LINE_BREAK)].length;
}

export function countLines(content: string): number {
  if (content.length === 0) return 0;
  const breaks = [...content.matchAll(LINE_BREAK)];
  if (!breaks.length) return 1;
  const last = breaks[breaks.length - 1];
  if (!last) return 1;
  return breaks.length + (last.index + last[0].length === content.length ? 0 : 1);
}

export function normalizeContext(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function addOffense(
  offenses: Offense[],
  file: RepositoryFile,
  index: number,
  message: string,
  context: string
): void {
  offenses.push({
    path: file.path,
    line: lineNumber(file.content, index),
    message,
    context: normalizeContext(context)
  });
}

export function recordFromKeys<Key extends string, Value>(
  keys: readonly Key[],
  create: (key: Key) => Value
): Record<Key, Value> {
  return Object.fromEntries(keys.map((key) => [key, create(key)])) as Record<Key, Value>;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
