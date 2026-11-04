// A drift guard over color literals in web source, not a data-flow proof of where colors come from.
import ts from 'typescript';

import { addOffense, lineNumber } from '../helpers.js';
import type { Metrics, RepositoryFile } from '../types.js';

// The only web source allowed to hold raw colors. Everything else references its tokens, so a
// theme is one override block instead of a hunt through component styles.
export const TOKEN_SOURCE = 'apps/web/src/tokens.css';
// Built-in Themes: tokens.semantic overrides of tokens declared in TOKEN_SOURCE, reading its palette.
export const THEME_SOURCE = 'apps/web/src/themes.css';
const WEB_SOURCE = 'apps/web/src/';
// Custom-property namespaces that tokens.css owns.
const OWNED_TOKEN = /^--(?:palette|color|gradient|font|radius)-/;
const PALETTE_TOKEN = /^--palette-/;
// tokens.css cascade layers. Raw colors live only in the palette, and only the semantic layer reads
// the palette, so overriding the semantic layer rethemes everything built on it.
const TOKEN_LAYERS = ['tokens.palette', 'tokens.semantic', 'tokens.derived'] as const;
type TokenLayer = (typeof TOKEN_LAYERS)[number];
// What each layer may read. References only stay level or point up the list, so no chain of
// references can loop across layers.
const READABLE_LAYERS: Readonly<Record<TokenLayer, readonly TokenLayer[]>> = {
  'tokens.palette': [],
  'tokens.semantic': ['tokens.palette', 'tokens.semantic'],
  'tokens.derived': ['tokens.semantic', 'tokens.derived']
};

const HEX = /(?<![\w#&/-])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{3,4})(?![\w-])/gi;
const COLOR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;
const WORD = /(?<![\w-])[a-z]+(?![\w-])/gi;
const DECLARATION = /([-\w]+)\s*:\s*([^;{}]*)(?=[;}])/g;
const VAR_REFERENCE = /var\(\s*(--[\w-]+)/g;
const LAYER_BLOCK = /@layer\s+([\w.-]+)\s*\{/g;
// Comments, strings, and url() bodies can mention colors without painting them.
const CSS_NON_VALUE = /\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|url\([^)]*\)/g;
// `--name:` inside a string, as in cssText or a template that builds a style sheet.
const CUSTOM_PROPERTY_DECLARATION = /(--[\w-]+)\s*:/g;
// url(#id) points at an SVG fragment such as a gradient or marker, not at a color.
const FRAGMENT_URL = /url\(\s*['"]?#[^)]*\)/g;
// `color-scheme:` declared inside a string, as in cssText.
const COLOR_SCHEME_PROPERTIES = new Set(['colorScheme', 'color-scheme']);
const COLOR_SCHEME_DECLARATION = /(?<![\w-])color-scheme\s*:/i;
const SCHEME_FROM_CSS = `color-scheme comes only from CSS through var(--color-scheme) in ${TOKEN_SOURCE}`;
const TS_ALLOW = /^[ \t]*\/\/[ \t]*design-tokens-allow:[ \t]*\S.*$/gm;
// CSS named colors. transparent, currentColor, and the CSS-wide keywords are deliberately absent:
// they never need a theme.
const NAMED_COLORS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
  brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue
  darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange
  darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise
  darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia
  gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo
  ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue
  lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon
  mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
  mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
  navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
  paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
  rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue
  slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
  whitesmoke yellow yellowgreen`.split(/\s+/)
);

interface Site {
  readonly name: string;
  readonly index: number;
  readonly text: string;
}

// What a web file contributes to the cross-file token check.
interface TokenUse {
  readonly file: RepositoryFile;
  readonly references: readonly Site[];
  readonly declarations: readonly Site[];
}

function isWebSource(path: string): boolean {
  return path.startsWith(WEB_SOURCE) && /\.(?:css|tsx?)$/.test(path);
}

// Replaces matches with spaces so offsets and line numbers still point at the original text.
function blank(content: string, pattern: RegExp): string {
  return content.replace(pattern, (match) => match.replace(/[^\n]/g, ' '));
}

function namedColors(value: string): RegExpExecArray[] {
  return [...value.matchAll(WORD)].filter((word) => NAMED_COLORS.has(word[0].toLowerCase()));
}

function sites(content: string, pattern: RegExp, offset = 0): Site[] {
  return [...content.matchAll(pattern)].map((match) => ({
    name: match[1] ?? '',
    index: offset + match.index,
    text: match[0]
  }));
}

const COLOR_SCHEME_ROLE = /^\s*var\(\s*--color-scheme\s*\)\s*$/;

function rawColorsInCss(metrics: Metrics, file: RepositoryFile, content: string): void {
  for (const declaration of content.matchAll(DECLARATION)) {
    const value = declaration[2] ?? '';
    const valueStart = declaration.index + declaration[0].length - value.length;
    // Native controls follow color-scheme, so a theme has to own it like any color: only the
    // designated role is accepted, not any custom property that could hold a literal scheme.
    if (declaration[1] === 'color-scheme' && !COLOR_SCHEME_ROLE.test(value)) {
      addOffense(
        metrics.rawColorLiterals,
        file,
        valueStart,
        `color-scheme ${value.trim()} bypasses the theme; use var(--color-scheme) from ${TOKEN_SOURCE}`,
        declaration[0]
      );
    }
    const literals = [
      ...value.matchAll(HEX),
      ...value.matchAll(COLOR_FUNCTION),
      ...namedColors(value)
    ];
    for (const literal of literals) {
      addOffense(
        metrics.rawColorLiterals,
        file,
        valueStart + literal.index,
        `raw color ${literal[0]} in ${declaration[1]}; use a token from ${TOKEN_SOURCE}`,
        declaration[0]
      );
    }
  }
}

function inspectCss(metrics: Metrics, file: RepositoryFile): TokenUse {
  const content = blank(file.content, CSS_NON_VALUE);
  rawColorsInCss(metrics, file, content);
  return {
    file,
    references: sites(content, VAR_REFERENCE),
    declarations: sites(content, /(--[\w-]+)\s*:/g)
  };
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text;
  }
  return null;
}

const ASSIGNMENT_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken
]);

// The static property name a node writes: an object-literal key or shorthand, an assignment target
// such as `x.name =` or `x['name'] =`, or setProperty's first argument. Reads never match.
function writtenProperty(node: ts.Node): { name: string; at: ts.Node } | null {
  if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
    const name = propertyNameText(node.name);
    return name === null ? null : { name, at: node.name };
  }
  if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)) {
    const target = node.left;
    if (ts.isPropertyAccessExpression(target)) return { name: target.name.text, at: target.name };
    if (ts.isElementAccessExpression(target) && ts.isStringLiteralLike(target.argumentExpression)) {
      return { name: target.argumentExpression.text, at: target.argumentExpression };
    }
    return null;
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'setProperty'
  ) {
    const [first] = node.arguments;
    return first && ts.isStringLiteralLike(first) ? { name: first.text, at: first } : null;
  }
  return null;
}

interface Allowance {
  readonly index: number;
  used: boolean;
}

// `// design-tokens-allow: <reason>` exempts the next line. Each one is a counted escape hatch
// whose fingerprint includes the exempted line, like ESLint disables and their owners, so editing
// or retargeting that line needs a fresh baseline. One that exempts nothing is an offense.
function allowances(metrics: Metrics, file: RepositoryFile): Map<number, Allowance> {
  const allowed = new Map<number, Allowance>();
  const lines = file.content.split(/\r?\n/);
  for (const match of file.content.matchAll(TS_ALLOW)) {
    const line = lineNumber(file.content, match.index);
    const exempted = lines[line] ?? '<end-of-file>';
    addOffense(
      metrics.designTokenAllowances,
      file,
      match.index,
      match[0].trim(),
      `${match[0]}|exempts:${exempted}`
    );
    allowed.set(line + 1, { index: match.index, used: false });
  }
  return allowed;
}

// TS strings reach the DOM through too many paths (props, style objects, canvas, cssText,
// constants) to tell painted text from prose by context, so every string literal and template
// chunk is checked for an embedded hex, color function, or named color. color-scheme comes only
// from CSS through var(--color-scheme), so TS may not set it at all. Comments never count; a
// legitimate exception takes a design-tokens-allow comment.
function inspectTypeScript(metrics: Metrics, file: RepositoryFile): TokenUse {
  const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const allowed = allowances(metrics, file);
  // Call only for an actual offense, so an allowance is spent only when it suppresses one.
  const exempt = (index: number): boolean => {
    const allowance = allowed.get(lineNumber(file.content, index));
    if (allowance) allowance.used = true;
    return allowance !== undefined;
  };
  const report = (index: number, message: string, context: string): void => {
    if (!exempt(index)) addOffense(metrics.rawColorLiterals, file, index, message, context);
  };
  const references: Site[] = [];
  const declarations: Site[] = [];
  // Only tokens.css may declare an owned token, so every owned declaration in TS is an offense.
  const declare = (site: Site): void => {
    if (OWNED_TOKEN.test(site.name) && !exempt(site.index)) declarations.push(site);
  };
  const inspect = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
      const start = node.getStart(source);
      const text = blank(node.text, FRAGMENT_URL);
      const literals = [
        ...text.matchAll(HEX),
        ...text.matchAll(COLOR_FUNCTION),
        ...namedColors(text)
      ];
      for (const literal of literals) {
        report(
          start,
          `raw color ${literal[0]} in string ${JSON.stringify(node.text)}; use var(--token) from ${TOKEN_SOURCE}`,
          node.text
        );
      }
      if (COLOR_SCHEME_DECLARATION.test(text)) {
        report(
          start,
          `color-scheme in string ${JSON.stringify(node.text)}; ${SCHEME_FROM_CSS}`,
          node.text
        );
      }
      for (const site of sites(text, CUSTOM_PROPERTY_DECLARATION))
        declare({ ...site, index: start });
      references.push(...sites(text, VAR_REFERENCE).map((site) => ({ ...site, index: start })));
    }
    const written = writtenProperty(node);
    if (written?.name.startsWith('--')) {
      declare({ name: written.name, index: written.at.getStart(source), text: written.name });
    } else if (written && COLOR_SCHEME_PROPERTIES.has(written.name)) {
      report(
        written.at.getStart(source),
        `color-scheme set from TS; ${SCHEME_FROM_CSS}`,
        node.getText(source)
      );
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  for (const { index, used } of allowed.values()) {
    if (!used) {
      addOffense(
        metrics.designTokenReferences,
        file,
        index,
        'design-tokens-allow comment exempts nothing on the next line',
        file.content.slice(index, file.content.indexOf('\n', index))
      );
    }
  }
  return { file, references, declarations };
}

interface LayeredDeclaration extends Site {
  readonly layer: TokenLayer | null;
  readonly value: string;
}

interface LayerRange {
  readonly layer: string;
  readonly start: number;
  readonly end: number;
}

function layerRanges(content: string): LayerRange[] {
  const ranges: LayerRange[] = [];
  for (const match of content.matchAll(LAYER_BLOCK)) {
    let depth = 0;
    let end = content.length;
    for (let index = match.index + match[0].length - 1; index < content.length; index += 1) {
      if (content[index] === '{') depth += 1;
      if (content[index] === '}' && --depth === 0) {
        end = index;
        break;
      }
    }
    ranges.push({ layer: match[1] ?? '', start: match.index, end });
  }
  return ranges;
}

// Assigns every tokens.css declaration to the cascade layer that encloses it, if any.
function layeredDeclarations(content: string, ranges: readonly LayerRange[]): LayeredDeclaration[] {
  return [...content.matchAll(/(--[\w-]+)\s*:\s*([^;{}]*)(?=[;}])/g)].map((match) => {
    const layer = ranges.find(
      (range) => range.start < match.index && match.index < range.end
    )?.layer;
    return {
      name: match[1] ?? '',
      index: match.index,
      text: match[0],
      value: match[2] ?? '',
      layer: TOKEN_LAYERS.find((name) => name === layer) ?? null
    };
  });
}

type TokenLayers = ReadonlyMap<string, TokenLayer | null>;

function tokenSourceLayers(
  metrics: Metrics,
  file: RepositoryFile
): TokenUse & { layers: TokenLayers } {
  const content = blank(file.content, CSS_NON_VALUE);
  const offenses = metrics.designTokenReferences;
  const ranges = layerRanges(content);
  const declarations = layeredDeclarations(content, ranges);
  // Only the palette may spell colors out.
  const outsidePalette = ranges
    .filter((range) => range.layer === 'tokens.palette')
    .reduce(
      (text, range) =>
        text.slice(0, range.start) +
        text.slice(range.start, range.end).replace(/[^\n]/g, ' ') +
        text.slice(range.end),
      content
    );
  rawColorsInCss(metrics, file, outsidePalette);
  const layerOf = new Map(declarations.map((declaration) => [declaration.name, declaration.layer]));
  for (const declaration of declarations) {
    const { name, index, text, layer, value } = declaration;
    if (layer === null) {
      addOffense(
        offenses,
        file,
        index,
        `design token ${name} declared outside a tokens.* layer`,
        text
      );
    } else if ((layer === 'tokens.palette') !== PALETTE_TOKEN.test(name)) {
      addOffense(offenses, file, index, `${name} does not belong in ${layer}`, text);
    }
    if (layer === null) continue;
    for (const reference of sites(value, VAR_REFERENCE, index + text.length - value.length)) {
      const read = layerOf.get(reference.name);
      if (read && !READABLE_LAYERS[layer].includes(read)) {
        addOffense(
          offenses,
          file,
          reference.index,
          `${name} in ${layer} reads ${reference.name} from ${read}; ${layer} may read only ${READABLE_LAYERS[layer].join(' and ') || 'raw values'}`,
          text
        );
      }
    }
  }
  return { file, references: sites(content, VAR_REFERENCE), declarations, layers: layerOf };
}

// A Theme may only re-declare tokens.semantic roles that TOKEN_SOURCE declares, with the same read
// rules, so it can neither add a token nor bypass the palette. Its declarations are overrides, not
// new tokens, so it reports none to the cross-file check.
function themeSourceLayers(metrics: Metrics, file: RepositoryFile, base: TokenLayers): TokenUse {
  const content = blank(file.content, CSS_NON_VALUE);
  rawColorsInCss(metrics, file, content);
  const offenses = metrics.designTokenReferences;
  const semantic = 'tokens.semantic';
  for (const { name, index, text, layer, value } of layeredDeclarations(
    content,
    layerRanges(content)
  )) {
    if (layer !== semantic || base.get(name) !== semantic) {
      addOffense(
        offenses,
        file,
        index,
        `${name} is not a ${semantic} override of a ${semantic} token in ${TOKEN_SOURCE}`,
        text
      );
    }
    for (const reference of sites(value, VAR_REFERENCE, index + text.length - value.length)) {
      const read = base.get(reference.name);
      if (read && !READABLE_LAYERS[semantic].includes(read)) {
        addOffense(
          offenses,
          file,
          reference.index,
          `${name} in ${THEME_SOURCE} reads ${reference.name} from ${read}; ${semantic} may read only ${READABLE_LAYERS[semantic].join(' and ')}`,
          text
        );
      }
    }
  }
  return { file, references: sites(content, VAR_REFERENCE), declarations: [] };
}

function tokenReferences(metrics: Metrics, uses: readonly TokenUse[]): void {
  const offenses = metrics.designTokenReferences;
  const source = uses.find((use) => use.file.path === TOKEN_SOURCE);
  const declared = new Map((source?.declarations ?? []).map((site) => [site.name, site]));
  const referenced = new Set(uses.flatMap((use) => use.references.map((site) => site.name)));
  for (const { file, references, declarations } of uses) {
    for (const { name, index, text } of references) {
      if (!OWNED_TOKEN.test(name)) continue;
      if (!declared.has(name)) {
        addOffense(offenses, file, index, `undefined design token ${name}`, text);
      } else if (PALETTE_TOKEN.test(name) && file !== source?.file && file.path !== THEME_SOURCE) {
        addOffense(
          offenses,
          file,
          index,
          `palette token ${name} used outside ${TOKEN_SOURCE} and ${THEME_SOURCE}`,
          text
        );
      }
    }
    if (file === source?.file) continue;
    for (const { name, index, text } of declarations) {
      if (OWNED_TOKEN.test(name)) {
        addOffense(
          offenses,
          file,
          index,
          `design token ${name} declared outside ${TOKEN_SOURCE}`,
          text
        );
      }
    }
  }
  if (!source) return;
  for (const { name, index } of declared.values()) {
    if (!referenced.has(name)) {
      addOffense(offenses, source.file, index, `unused design token ${name}`, name);
    }
  }
}

export function analyzeDesignTokens(metrics: Metrics, files: readonly RepositoryFile[]): void {
  const web = files.filter((file) => isWebSource(file.path));
  const sourceFile = web.find((file) => file.path === TOKEN_SOURCE);
  const source = sourceFile ? tokenSourceLayers(metrics, sourceFile) : null;
  const uses = web.map((file) => {
    if (source && file === source.file) return source;
    if (file.path === THEME_SOURCE)
      return themeSourceLayers(metrics, file, source?.layers ?? new Map());
    return file.path.endsWith('.css')
      ? inspectCss(metrics, file)
      : inspectTypeScript(metrics, file);
  });
  tokenReferences(metrics, uses);
}
