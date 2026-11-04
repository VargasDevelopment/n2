import { AST_NODE_TYPES as T, type TSESTree } from '@typescript-eslint/utils';
import { Linter, type Rule } from 'eslint';
import { builtinRules } from 'eslint/use-at-your-own-risk';
import { parser } from 'typescript-eslint';

import { THRESHOLDS } from '../config.js';
import type { FunctionComplexities, FunctionComplexity, RepositoryFile } from '../types.js';

type Variant = 'classic' | 'modified';
type Node = TSESTree.Node;

// Only names and structural roles belong in IDs: never stringify an expression's body.
function name(node: Node): string {
  switch (node.type) {
    case T.JSXIdentifier:
    case T.Identifier:
    case T.PrivateIdentifier:
      return node.type === T.PrivateIdentifier ? `#${node.name}` : node.name;
    case T.Literal:
      return typeof node.value === 'bigint' ? `${node.value}n` : JSON.stringify(node.value);
    case T.MemberExpression:
      return `${name(node.object)}.${name(node.property)}`;
    case T.CallExpression:
    case T.NewExpression:
      return `${name(node.callee)}()`;
    case T.TSAsExpression:
    case T.TSSatisfiesExpression:
    case T.TSNonNullExpression:
    case T.ChainExpression:
      return name(node.expression);
    case T.AssignmentPattern:
      return name(node.left);
    case T.ObjectPattern:
      return `{${node.properties.map(name).join(',')}}`;
    case T.ArrayPattern:
      return `[${node.elements.map((element) => (element ? name(element) : '')).join(',')}]`;
    case T.Property:
      return name(node.value);
    case T.RestElement:
      return `...${name(node.argument)}`;
    default:
      return `<${node.type}>`;
  }
}

function owner(node: Node, child: Node | undefined): string | undefined {
  switch (node.type) {
    case T.FunctionDeclaration:
    case T.FunctionExpression:
    case T.ClassDeclaration:
    case T.ClassExpression:
      return node.id?.name;
    case T.VariableDeclarator:
      return name(node.id);
    case T.Property:
      return `${node.kind}:${name(node.key)}`;
    case T.MethodDefinition:
    case T.PropertyDefinition:
    case T.AccessorProperty:
      return `${node.static ? 'static:' : ''}${node.type === T.MethodDefinition ? node.kind + ':' : ''}${name(node.key)}`;
    case T.CallExpression:
    case T.NewExpression: {
      const index = node.arguments.findIndex((argument) => argument === child);
      return index >= 0 ? `${name(node.callee)}:arg${index}` : undefined;
    }
    case T.AssignmentPattern:
      return child === node.right ? name(node.left) : undefined;
    case T.TSModuleDeclaration:
      return name(node.id);
    case T.AssignmentExpression:
      return child === node.right ? name(node.left) : undefined;
    case T.JSXAttribute:
      return `jsx:${name(node.name)}`;
    case T.ExportDefaultDeclaration:
      return 'default';
    case T.StaticBlock:
      return 'static-block';
    case T.ReturnStatement:
      return 'return';
    case T.ArrayExpression:
      return `element${node.elements.findIndex((element) => element === child)}`;
    case T.ConditionalExpression:
      return child === node.test ? 'test' : child === node.consequent ? 'then' : 'else';
    default:
      return undefined;
  }
}

function stableId(
  file: string,
  node: Exclude<Node, TSESTree.Program>,
  origin: Rule.CodePathOrigin
): string {
  const parts: string[] = [];
  // An implicit initializer's expression is its body, not part of its lexical identity.
  const initializer = origin === 'class-field-initializer';
  let child: Node | undefined = initializer ? node : undefined;
  let current: Node = initializer ? node.parent : node;
  while (current.type !== T.Program) {
    const part = owner(current, child);
    if (part) parts.unshift(encodeURIComponent(part));
    child = current;
    current = current.parent;
  }
  if (origin === 'class-field-initializer') parts.push('initializer');
  return `${file}#${parts.join('/') || 'anonymous'}`;
}

export interface Measurement extends FunctionComplexity {
  readonly id: string;
}

export function measureComplexity(
  file: RepositoryFile,
  variant: Variant = THRESHOLDS.functionComplexity.variant
): Measurement[] {
  const core = builtinRules.get('complexity');
  if (!core) throw new Error('installed ESLint is missing the core complexity rule');
  const measurements: Measurement[] = [];
  const adapter: Rule.RuleModule = {
    meta: core.meta ?? {},
    create(context) {
      let origin: Rule.CodePathOrigin = 'program';
      const listeners = core.create({
        ...context,
        sourceCode: context.sourceCode,
        options: [{ max: 0, variant }],
        report(descriptor) {
          const score = Number(descriptor.data?.complexity);
          if (!('node' in descriptor) || !Number.isSafeInteger(score) || score < 1) {
            throw new Error(
              'installed ESLint complexity report format changed; update the adapter'
            );
          }
          // The configured TypeScript parser supplies TSESTree nodes, including TS-only owners.
          const node = descriptor.node as Node;
          if (node.type === T.Program) {
            throw new Error('installed ESLint complexity unexpectedly reported a program');
          }
          measurements.push({
            id: stableId(file.path, node, origin),
            path: file.path,
            line: node.loc.start.line,
            column: node.loc.start.column + 1,
            score
          });
        }
      });
      return {
        ...listeners,
        onCodePathEnd(codePath, node) {
          origin = codePath.origin;
          listeners.onCodePathEnd?.(codePath, node);
        }
      };
    }
  };
  const messages = new Linter().verify(
    file.content,
    [
      {
        files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
        languageOptions: {
          parser,
          ecmaVersion: 'latest',
          sourceType: 'module',
          parserOptions: { ecmaFeatures: { jsx: true } }
        },
        plugins: { measurement: { rules: { complexity: adapter } } },
        rules: { 'measurement/complexity': 'error' }
      }
    ],
    // Discovery accepts mixed-case extensions; ESLint's config globs are case-sensitive.
    { filename: file.path.toLowerCase(), allowInlineConfig: false }
  );
  if (messages.length) {
    throw new Error(
      `${file.path}: complexity measurement failed: ${messages.map((message) => message.message).join('; ')}`
    );
  }
  return measurements;
}

export function analyzeComplexity(file: RepositoryFile): FunctionComplexities {
  const measurements = measureComplexity(file);
  const counts = new Map<string, number>();
  for (const { id } of measurements) counts.set(id, (counts.get(id) ?? 0) + 1);
  const ambiguous = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  const debt = measurements.filter(({ score }) => score > THRESHOLDS.functionComplexity.max);
  for (const item of debt) {
    // Small anonymous siblings need no names until one incurs debt, but can never share its ceiling.
    const duplicate = ambiguous.find((id) => item.id === id || item.id.startsWith(`${id}/`));
    if (duplicate) {
      throw new Error(
        `${file.path}:${item.line}:${item.column}: ambiguous functionComplexity ID ${duplicate}; give the callbacks or owners distinct names before checking or updating the baseline`
      );
    }
  }
  return Object.fromEntries(debt.map(({ id, ...measurement }) => [id, measurement]));
}
