import { posix } from 'node:path';

import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit, type BuildVisitor } from 'unist-util-visit';

import { addOffense } from '../helpers.js';
import type { Metrics, RepositoryFile } from '../types.js';

const markdownParser = unified().use(remarkParse);

type MarkdownRoot = ReturnType<typeof markdownParser.parse>;
type MarkdownNode = Parameters<BuildVisitor<MarkdownRoot>>[0];
type DefinitionNode = Extract<MarkdownNode, { type: 'definition' }>;

interface NormalizedTarget {
  readonly invalid: boolean;
  readonly path: string;
}

export function repositoryTargets(paths: readonly string[]): Set<string> {
  const targets = new Set(['.', ...paths]);
  for (const path of paths) {
    let directory = posix.dirname(path);
    while (directory !== '.') {
      targets.add(directory);
      directory = posix.dirname(directory);
    }
  }
  return targets;
}

function normalizedTarget(filePath: string, rawTarget: string): NormalizedTarget | null {
  if (
    /^[a-z][a-z\d+.-]*:/i.test(rawTarget) ||
    rawTarget.startsWith('#') ||
    rawTarget.startsWith('//')
  ) {
    return null;
  }
  const pathPart = rawTarget.split(/[?#]/, 1)[0];
  if (!pathPart) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathPart).replace(/\\([ ()])/g, '$1');
  } catch {
    return { invalid: true, path: rawTarget };
  }
  const normalizedCandidate = decoded.startsWith('/')
    ? posix.normalize(decoded.slice(1))
    : posix.normalize(posix.join(posix.dirname(filePath), decoded));
  if (
    normalizedCandidate === '..' ||
    normalizedCandidate.startsWith('../') ||
    posix.isAbsolute(normalizedCandidate)
  ) {
    return { invalid: true, path: normalizedCandidate };
  }
  const candidate = normalizedCandidate.replace(/\/+$/, '') || '.';
  return { invalid: false, path: candidate };
}

function escaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

interface FallbackReference {
  readonly identifier: string;
  readonly raw: string;
  readonly start: number;
}

function closingBracket(source: string, open: number): number | null {
  let nested = 0;
  for (let cursor = open + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === '\r' || character === '\n') return null;
    if (escaped(source, cursor)) continue;
    if (character === '[') nested += 1;
    if (character === ']' && nested === 0) return cursor;
    if (character === ']') nested -= 1;
  }
  return null;
}

function referenceIdentifier(label: string): string | null {
  const candidate = markdownParser.parse(`[${label}]: ./`);
  const definition = candidate.children[0];
  return candidate.children.length === 1 && definition?.type === 'definition'
    ? definition.identifier.toLowerCase()
    : null;
}

function fallbackReferences(source: string): readonly FallbackReference[] {
  const references: FallbackReference[] = [];
  for (let open = 0; open < source.length; open += 1) {
    if (source[open] !== '[' || escaped(source, open)) continue;
    const labelEnd = closingBracket(source, open);
    if (labelEnd === null || source[labelEnd + 1] !== '[') continue;
    const identifierOpen = labelEnd + 1;
    const identifierEnd = closingBracket(source, identifierOpen);
    if (identifierEnd === null) continue;

    const label = source.slice(open + 1, labelEnd);
    if (label.length === 0) continue;
    const explicitIdentifier = source.slice(identifierOpen + 1, identifierEnd);
    const identifier = referenceIdentifier(
      explicitIdentifier.length === 0 ? label : explicitIdentifier
    );
    if (identifier === null) {
      open = identifierEnd;
      continue;
    }
    const start =
      open > 0 && source[open - 1] === '!' && !escaped(source, open - 1) ? open - 1 : open;
    references.push({ identifier, raw: source.slice(start, identifierEnd + 1), start });
    open = identifierEnd;
  }
  return references;
}

export function analyzeMarkdown(
  metrics: Metrics,
  file: RepositoryFile,
  allowedTargets: ReadonlySet<string>
): void {
  const tree = markdownParser.parse(file.content);
  const definitions = new Map<string, DefinitionNode>();
  visit(tree, 'definition', (node) => {
    const identifier = node.identifier.toLowerCase();
    if (!definitions.has(identifier)) definitions.set(identifier, node);
  });
  const raw = (node: MarkdownNode): string => {
    const start = node.position?.start.offset ?? 0;
    return file.content.slice(start, node.position?.end.offset ?? start);
  };
  const validate = (node: MarkdownNode, targetText: string, owner?: MarkdownNode): void => {
    const target = normalizedTarget(file.path, targetText);
    if (target && (target.invalid || !allowedTargets.has(target.path))) {
      addOffense(
        metrics.brokenRelativeMarkdownLinks,
        file,
        node.position?.start.offset ?? 0,
        `broken local Markdown link: ${targetText}`,
        `${node.type}:${targetText}:${raw(owner ?? node)}`
      );
    }
  };

  visit(tree, (node, _index, parent) => {
    if (node.type === 'link' || node.type === 'image') validate(node, node.url, parent);
    if (node.type === 'definition' && definitions.get(node.identifier.toLowerCase()) === node) {
      validate(node, node.url, node);
    }
    if (
      (node.type === 'linkReference' || node.type === 'imageReference') &&
      !definitions.has(node.identifier.toLowerCase())
    ) {
      addOffense(
        metrics.brokenRelativeMarkdownLinks,
        file,
        node.position?.start.offset ?? 0,
        `undefined Markdown link reference: ${node.identifier.toLowerCase()}`,
        `${node.type}:${node.identifier.toLowerCase()}:${raw(parent ?? node)}`
      );
    }
    if (node.type !== 'text') return;
    const source = raw(node);
    for (const reference of fallbackReferences(source)) {
      const { identifier } = reference;
      if (!definitions.has(identifier)) {
        addOffense(
          metrics.brokenRelativeMarkdownLinks,
          file,
          (node.position?.start.offset ?? 0) + reference.start,
          `undefined Markdown link reference: ${identifier}`,
          `reference:${identifier}:${reference.raw}:${raw(parent ?? node)}`
        );
      }
    }
  });
}
