import ts from 'typescript';

export interface TestBindings {
  readonly namedRoots: ReadonlyMap<string, string>;
  readonly namespaces: ReadonlySet<string>;
}

export interface ImportBindings {
  readonly processExitFunctions: ReadonlySet<string>;
  readonly processObjects: ReadonlySet<string>;
  readonly tests: TestBindings;
}

function collectProcessImport(
  clause: ts.ImportClause | undefined,
  objects: Set<string>,
  exits: Set<string>
): void {
  if (clause?.name) objects.add(clause.name.text);
  const bindings = clause?.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) objects.add(bindings.name.text);
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      if (!element.isTypeOnly && (element.propertyName?.text ?? element.name.text) === 'exit') {
        exits.add(element.name.text);
      }
    }
  }
}

function collectTestImport(
  bindings: ts.NamedImportBindings | undefined,
  namedRoots: Map<string, string>,
  namespaces: Set<string>
): void {
  if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      if (!element.isTypeOnly) {
        namedRoots.set(element.name.text, element.propertyName?.text ?? element.name.text);
      }
    }
  }
}

export function collectImports(source: ts.SourceFile): ImportBindings {
  const namedRoots = new Map<string, string>();
  const namespaces = new Set<string>();
  const processExitFunctions = new Set<string>();
  const processObjects = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause?.isTypeOnly
    ) {
      continue;
    }
    const moduleName = statement.moduleSpecifier.text;
    if (moduleName === 'node:process' || moduleName === 'process') {
      collectProcessImport(statement.importClause, processObjects, processExitFunctions);
    }
    if (moduleName === 'vitest') {
      collectTestImport(statement.importClause?.namedBindings, namedRoots, namespaces);
    }
  }
  return { processExitFunctions, processObjects, tests: { namedRoots, namespaces } };
}
