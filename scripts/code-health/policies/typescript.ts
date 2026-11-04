import ts from 'typescript';

import { addOffense, lineNumber, normalizeContext } from '../helpers.js';
import type { Metrics, RepositoryFile } from '../types.js';
import { collectImports, type ImportBindings, type TestBindings } from './typescriptBindings.js';

const TS_LINE_SUPPRESSION = /^\/\/\/?\s*@(ts-expect-error|ts-ignore)\b/;
const TS_BLOCK_SUPPRESSION = /^(?:\/|\*)*\s*@(ts-expect-error|ts-ignore)\b/;
const TS_NOCHECK = /^\/\/\/?\s*@ts-nocheck(?=\s|:|$)/i;
const ESLINT_DISABLE = /^\s*eslint-disable(?:-next-line|-line)?\b/;
const ESLINT_OFF_RULE =
  /(?:^|,)\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[@\w./-]+)\s*:\s*(?:\[\s*)?(?:0|off|["']off["'])(?=\s*(?:[,}\]]|$))/gim;
const TEST_ROOTS = new Set(['describe', 'it', 'suite', 'test']);
const DISABLED_TEST_MODIFIERS = new Set(['runIf', 'skip', 'skipIf', 'todo']);
const EXCLUSIVE_TEST_MODIFIERS = new Set(['only']);
const DISABLED_TEST_OPTIONS = new Set(['skip', 'todo']);
const EXCLUSIVE_TEST_OPTIONS = new Set(['only']);
const DISABLED_TEST_ROOTS = new Set(['xdescribe', 'xit', 'xtest']);
const EXCLUSIVE_TEST_ROOTS = new Set(['fdescribe', 'fit']);
const NON_COMMENT_TEXT = new Set([
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail
]);

interface CallChain {
  readonly root: string;
  readonly modifiers: readonly string[];
}

interface SourceBindings extends ImportBindings {
  readonly staticOptionObjects: ReadonlyMap<string, ts.ObjectLiteralExpression>;
}

interface StatementRange {
  readonly node: ts.Statement;
  readonly start: number;
  readonly fullStart: number;
  readonly end: number;
}

interface CommentBody {
  readonly text: string;
  readonly offset: number;
}

function commentBody(comment: string): CommentBody {
  return comment.startsWith('//')
    ? { text: comment.slice(2), offset: 2 }
    : { text: comment.slice(2, -2), offset: 2 };
}

function typeScriptDirectiveOffsets(
  comment: string,
  kind: ts.SyntaxKind,
  leadingPragma: boolean
): readonly number[] {
  const offsets: number[] = [];
  if (kind === ts.SyntaxKind.SingleLineCommentTrivia) {
    const suppression = TS_LINE_SUPPRESSION.exec(comment);
    if (suppression) offsets.push(suppression.index + suppression[0].indexOf('@'));
    const noCheck = leadingPragma ? TS_NOCHECK.exec(comment) : null;
    if (noCheck) offsets.push(noCheck.index + noCheck[0].indexOf('@'));
    return offsets;
  }

  // TypeScript recognizes ignore/expect-error in only the final line of a block comment.
  const lastLineOffset = Math.max(comment.lastIndexOf('\n'), comment.lastIndexOf('\r')) + 1;
  const lastLine = comment.slice(lastLineOffset);
  const suppression = TS_BLOCK_SUPPRESSION.exec(lastLine);
  if (suppression) {
    offsets.push(lastLineOffset + suppression.index + suppression[0].indexOf('@'));
  }
  return offsets;
}

function semanticOwner(node: ts.Node, source: ts.SourceFile): ts.Node {
  let current: ts.Node = node;
  let fallback: ts.Node = node;
  while (current !== source) {
    if (ts.isStatement(current)) return current;
    if (ts.isDeclarationStatement(current) || ts.isCallExpression(current)) fallback = current;
    current = current.parent;
  }
  return fallback;
}

function ownerText(node: ts.Node, source: ts.SourceFile): string {
  return normalizeContext(semanticOwner(node, source).getText(source));
}

function buildOwnerIndex(source: ts.SourceFile, content: string): (range: ts.TextRange) => string {
  const statements: StatementRange[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStatement(node)) {
      statements.push({
        node,
        start: node.getStart(source),
        fullStart: node.getFullStart(),
        end: node.end
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  statements.sort((left, right) => left.start - right.start || left.end - right.end);

  return (range: ts.TextRange): string => {
    let containing: StatementRange | undefined;
    let previous: StatementRange | undefined;
    let following: StatementRange | undefined;
    for (const entry of statements) {
      if (entry.fullStart <= range.pos && entry.end >= range.end) {
        if (!containing || entry.end - entry.fullStart < containing.end - containing.fullStart) {
          containing = entry;
        }
      }
      if (
        entry.end <= range.pos &&
        lineNumber(content, entry.end) === lineNumber(content, range.pos) &&
        (!previous || entry.end > previous.end)
      ) {
        previous = entry;
      }
      if (!following && entry.start >= range.end) following = entry;
    }
    const owner = containing ?? previous ?? following;
    return owner ? ownerText(owner.node, source) : '<end-of-file>';
  };
}

function commentPolicies(metrics: Metrics, file: RepositoryFile, source: ts.SourceFile): void {
  const ranges = new Map<string, ts.CommentRange>();
  const excluded: Array<readonly [start: number, end: number]> = [];
  const leadingPragmas = new Set(
    (ts.getLeadingCommentRanges(file.content, 0) ?? []).map((item) => `${item.pos}:${item.end}`)
  );
  const collect = (items: readonly ts.CommentRange[] | undefined): void => {
    for (const item of items ?? []) ranges.set(`${item.pos}:${item.end}`, item);
  };
  const inspect = (node: ts.Node): void => {
    if (NON_COMMENT_TEXT.has(node.kind)) excluded.push([node.getStart(source), node.end]);
    collect(ts.getLeadingCommentRanges(file.content, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(file.content, node.end));
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  collect(ts.getLeadingCommentRanges(file.content, 0));
  const ownerFor = buildOwnerIndex(source, file.content);

  for (const range of ranges.values()) {
    if (excluded.some(([start, end]) => range.pos < end && range.end > start)) continue;
    const comment = file.content.slice(range.pos, range.end);
    const context = `${comment}|owner:${ownerFor(range)}`;
    const rangeKey = `${range.pos}:${range.end}`;
    for (const offset of typeScriptDirectiveOffsets(
      comment,
      range.kind,
      leadingPragmas.has(rangeKey)
    )) {
      addOffense(
        metrics.tsSuppressions,
        file,
        range.pos + offset,
        'TypeScript suppression comment',
        context
      );
    }
    const body = commentBody(comment);
    const eslintDisable = ESLINT_DISABLE.exec(body.text);
    if (eslintDisable) {
      addOffense(
        metrics.eslintDisables,
        file,
        range.pos + body.offset + eslintDisable.index,
        'ESLint disable comment',
        context
      );
    }
    const inlineConfig = /^\s*eslint\s+([\s\S]*)$/i.exec(body.text);
    if (inlineConfig) {
      const config = inlineConfig[1]?.split(/\s--\s/, 1)[0] ?? '';
      const configOffset = body.offset + body.text.indexOf(config);
      for (const match of config.matchAll(ESLINT_OFF_RULE)) {
        addOffense(
          metrics.eslintDisables,
          file,
          range.pos + configOffset + match.index,
          'ESLint inline rule disabled',
          context
        );
      }
    }
  }
}

function unwrapParentheses(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}

function callChain(expression: ts.Expression): CallChain | null {
  const modifiers: string[] = [];
  let current: ts.Expression = expression;
  for (;;) {
    current = unwrapParentheses(current);
    if (ts.isPropertyAccessExpression(current)) {
      modifiers.unshift(current.name.text);
      current = current.expression;
    } else if (
      ts.isElementAccessExpression(current) &&
      ts.isStringLiteralLike(current.argumentExpression)
    ) {
      modifiers.unshift(current.argumentExpression.text);
      current = current.expression;
    } else if (ts.isCallExpression(current)) {
      current = current.expression;
    } else if (ts.isTaggedTemplateExpression(current)) {
      current = current.tag;
    } else if (ts.isIdentifier(current)) {
      return { root: current.text, modifiers };
    } else {
      return null;
    }
  }
  return null;
}

function collectStaticOptionObjects(
  source: ts.SourceFile
): Map<string, ts.ObjectLiteralExpression> {
  const optionCandidates = new Map<string, ts.ObjectLiteralExpression>();
  const declarationCounts = new Map<string, number>();
  const collectOptionBindings = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      declarationCounts.set(name, (declarationCounts.get(name) ?? 0) + 1);
      if (
        node.initializer &&
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0
      ) {
        const initializer = unwrapTransparentExpression(node.initializer);
        if (ts.isObjectLiteralExpression(initializer)) optionCandidates.set(name, initializer);
      }
    }
    ts.forEachChild(node, collectOptionBindings);
  };
  collectOptionBindings(source);
  const staticOptionObjects = new Map(
    [...optionCandidates].filter(([name]) => declarationCounts.get(name) === 1)
  );

  return staticOptionObjects;
}

function canonicalTestChain(chain: CallChain, bindings: TestBindings): CallChain {
  const importedRoot = bindings.namedRoots.get(chain.root);
  if (importedRoot !== undefined) return { root: importedRoot, modifiers: chain.modifiers };
  const [namespaceRoot, ...modifiers] = chain.modifiers;
  return bindings.namespaces.has(chain.root) && namespaceRoot !== undefined
    ? { root: namespaceRoot, modifiers }
    : chain;
}

function isAssertion(node: ts.Node): node is ts.AsExpression | ts.TypeAssertion {
  return ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);
}

function isUnsafeAssertion(node: ts.Node): node is ts.AsExpression | ts.TypeAssertion {
  if (!isAssertion(node)) return false;
  if (node.type.kind === ts.SyntaxKind.AnyKeyword) return true;
  const inner = unwrapNonAssertionWrappers(node.expression);
  return isAssertion(inner) && inner.type.kind === ts.SyntaxKind.UnknownKeyword;
}

function processExitCall(expression: ts.Expression, bindings: SourceBindings): boolean {
  if (ts.isIdentifier(expression) && bindings.processExitFunctions.has(expression.text))
    return true;
  return (
    (ts.isPropertyAccessExpression(expression) &&
      expression.name.text === 'exit' &&
      ts.isIdentifier(expression.expression) &&
      (expression.expression.text === 'process' ||
        bindings.processObjects.has(expression.expression.text))) ||
    (ts.isElementAccessExpression(expression) &&
      ts.isStringLiteralLike(expression.argumentExpression) &&
      expression.argumentExpression.text === 'exit' &&
      ts.isIdentifier(expression.expression) &&
      (expression.expression.text === 'process' ||
        bindings.processObjects.has(expression.expression.text)))
  );
}

function propertyName(
  property: ts.PropertyAssignment | ts.ShorthandPropertyAssignment
): string | null {
  if (ts.isComputedPropertyName(property.name)) {
    const name = unwrapTransparentExpression(property.name.expression);
    return ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : null;
  }
  const name = property.name;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function unwrapNonAssertionWrappers(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function unwrapTransparentExpression(expression: ts.Expression): ts.Expression {
  let current = unwrapNonAssertionWrappers(expression);
  while (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
    current = current.expression;
    current = unwrapNonAssertionWrappers(current);
  }
  return current;
}

function hasEnabledOption(
  argumentsList: readonly ts.Expression[],
  optionNames: ReadonlySet<string>,
  staticOptionObjects: ReadonlyMap<string, ts.ObjectLiteralExpression>
): boolean {
  return argumentsList.some((argument) => {
    const expression = unwrapTransparentExpression(argument);
    const option = ts.isIdentifier(expression)
      ? staticOptionObjects.get(expression.text)
      : expression;
    return (
      option !== undefined &&
      ts.isObjectLiteralExpression(option) &&
      option.properties.some((property) => {
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
          return false;
        }
        const name = propertyName(property);
        if (name !== null && optionNames.has(name)) {
          return !(
            ts.isPropertyAssignment(property) &&
            unwrapTransparentExpression(property.initializer).kind === ts.SyntaxKind.FalseKeyword
          );
        }
        return false;
      })
    );
  });
}

export function analyzeTypeScript(metrics: Metrics, file: RepositoryFile): void {
  const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const bindings: SourceBindings = {
    ...collectImports(source),
    staticOptionObjects: collectStaticOptionObjects(source)
  };
  commentPolicies(metrics, file, source);
  const inspect = (node: ts.Node): void => {
    if (isUnsafeAssertion(node)) {
      addOffense(
        metrics.unsafeCasts,
        file,
        node.getStart(source),
        'unsafe TypeScript cast',
        ownerText(node, source)
      );
    }
    if (ts.isCallExpression(node)) {
      const expression = unwrapParentheses(node.expression);
      if (processExitCall(expression, bindings)) {
        addOffense(
          metrics.unsanctionedProcessExit,
          file,
          node.getStart(source),
          'use process.exitCode or throw instead of process.exit()',
          ownerText(node, source)
        );
      }
      const intermediate = ts.isCallExpression(node.parent) && node.parent.expression === node;
      if (!intermediate) {
        const rawChain = callChain(node.expression);
        const chain = rawChain ? canonicalTestChain(rawChain, bindings.tests) : null;
        if (chain && TEST_ROOTS.has(chain.root)) {
          if (
            chain.modifiers.some((modifier) => DISABLED_TEST_MODIFIERS.has(modifier)) ||
            hasEnabledOption(node.arguments, DISABLED_TEST_OPTIONS, bindings.staticOptionObjects)
          ) {
            addOffense(
              metrics.skippedTests,
              file,
              node.getStart(source),
              'skipped test',
              ownerText(node, source)
            );
          }
          if (
            chain.modifiers.some((modifier) => EXCLUSIVE_TEST_MODIFIERS.has(modifier)) ||
            hasEnabledOption(node.arguments, EXCLUSIVE_TEST_OPTIONS, bindings.staticOptionObjects)
          ) {
            addOffense(
              metrics.exclusiveTests,
              file,
              node.getStart(source),
              'exclusive test',
              ownerText(node, source)
            );
          }
        }
        if (chain && DISABLED_TEST_ROOTS.has(chain.root)) {
          addOffense(
            metrics.skippedTests,
            file,
            node.getStart(source),
            'skipped test',
            ownerText(node, source)
          );
        }
        if (chain && EXCLUSIVE_TEST_ROOTS.has(chain.root)) {
          addOffense(
            metrics.exclusiveTests,
            file,
            node.getStart(source),
            'exclusive test',
            ownerText(node, source)
          );
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
}
