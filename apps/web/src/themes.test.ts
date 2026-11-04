import { ThemeSchema } from '@n2/contracts';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_HINT_KEY, THEME_OPTIONS, type EffectiveTheme } from './theme.js';

// Reads tokens.css and themes.css as text and resolves each Theme's roles to palette hex values, so
// these checks see exactly what the browser would after the cascade.
const css = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8');
const tokensCss = css('./tokens.css');
const themesCss = css('./themes.css');

type Declarations = ReadonlyMap<string, string>;

const declarations = (block: string): Declarations =>
  new Map([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));

// The first rule body that follows `selector {` (rule bodies here never nest braces).
const ruleBody = (source: string, selector: string): string => {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No rule for ${selector}`);
  const open = source.indexOf('{', start);
  return source.slice(open + 1, source.indexOf('}', open));
};

const palette = declarations(ruleBody(tokensCss, '@layer tokens.palette {\n  :root'));
const midnight = declarations(ruleBody(tokensCss, "[data-theme='midnight']"));
const derived = declarations(ruleBody(tokensCss, '[data-theme]'));
const overrides = new Map(
  [...themesCss.matchAll(/\[data-theme='(\w+)'\] \{([^}]*)\}/g)].map((m) => [
    m[1]!,
    declarations(m[2]!)
  ])
);

// Roles a Theme must restate: every color and gradient, plus the native control scheme.
const THEMED_ROLE = /^--(?:color|gradient)-/;
const themedRoles = [...midnight.keys()].filter((name) => THEMED_ROLE.test(name)).sort();

const resolve = (theme: EffectiveTheme, name: string): string => {
  const value = overrides.get(theme)?.get(name) ?? midnight.get(name) ?? derived.get(name);
  const reference = value?.match(/^var\((--[\w-]+)\)$/)?.[1];
  if (reference) return palette.get(reference) ?? resolve(theme, reference);
  if (value === undefined) throw new Error(`${theme} does not resolve ${name}`);
  return value;
};

// Linear-light sRGB channels of a #rrggbb color. Anything else (short hex, color-mix, rgb()) fails
// loudly: a lenient parse would decode it as black and let a bad value pass every contrast floor.
const rgb = (color: string): [number, number, number] => {
  const channels = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!channels) throw new Error(`Expected a #rrggbb color, got ${color}`);
  const linear = (hex: string): number => {
    const c = Number.parseInt(hex, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [linear(channels[1]!), linear(channels[2]!), linear(channels[3]!)];
};
const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
// OKLab, where Euclidean distance tracks perceived difference.
const oklab = (hex: string): [number, number, number] => {
  const [r, g, b] = rgb(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
};
const distance = (a: string, b: string): number => {
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

// A role mixed with transparent at `share`, painted over `background`: browsers composite per
// gamma-encoded sRGB channel.
const composite = (color: string, background: string, share: number): string => {
  // rgb() rejects anything but #rrggbb, so a compound value cannot slip through as black.
  rgb(color);
  rgb(background);
  const channel = (hex: string, index: number): number =>
    Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const mixed = [0, 1, 2].map((index) =>
    Math.round(share * channel(color, index) + (1 - share) * channel(background, index))
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
};

// The resting region fill's share, read from the stylesheet that paints it.
const regionFillShare = (): number => {
  const share =
    /\.group-region__area \{\s*fill: color-mix\(in srgb, var\(--color-group-region\) (\d+)%/.exec(
      css('./components/GroupRegionLayer.css')
    )?.[1];
  if (share === undefined) throw new Error('No resting Group region fill in GroupRegionLayer.css');
  return Number(share) / 100;
};

// Body-text pairs held to WCAG AA (4.5:1). Status colors also label cards in small text.
const TEXT_PAIRS = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text-secondary', 'surface'],
  // Group region titles sit on the canvas when zoomed out.
  ['text-secondary', 'bg-canvas'],
  ['text-muted', 'bg'],
  ['text-muted', 'surface'],
  ['text-muted', 'surface-raised'],
  ['accent-text', 'surface'],
  ['text-on-accent', 'accent'],
  ['text-on-danger', 'danger-solid'],
  ['danger', 'surface'],
  ['warning-text', 'surface'],
  ['status-in-progress', 'surface'],
  ['status-blocked', 'surface'],
  ['status-done', 'surface'],
  ['note-text', 'note-surface'],
  ['note-text-muted', 'note-surface']
] as const;
const STATUSES = ['ready', 'in-progress', 'blocked', 'done'] as const;
// Mono separates statuses by glyph shape alone (ring, half ring, struck ring, disc).
const CHROMATIC_THEMES = ThemeSchema.options.filter(
  (theme) => theme !== 'mono' && theme !== 'system'
);

// Inputs come from the real stylesheets: code-health keeps raw colors out of every web source.
describe('the color decoder', () => {
  const surface = resolve('paper', '--color-surface');

  it.each([
    // The resolver passes compound values through unchanged; this one is a real Paper role.
    ['a compound expression', resolve('paper', '--color-border')],
    ['short hex', surface.slice(0, 4)]
  ])('rejects %s instead of decoding it as zero', (_label, color) => {
    expect(color).not.toMatch(/^#[0-9a-f]{6}$/i);
    expect(() => contrast(color, surface)).toThrow('Expected a #rrggbb color');
  });
});

describe('built-in Themes', () => {
  it('are the same set in the contract, the stylesheets, and the Settings switcher', () => {
    expect(['midnight', ...overrides.keys()].sort()).toEqual(
      ThemeSchema.options.filter((theme) => theme !== 'system').sort()
    );
    expect(THEME_OPTIONS.map(({ theme }) => theme)).toEqual(ThemeSchema.options);
  });

  it.each([...overrides])('%s restates every themed role of the default', (_theme, roles) => {
    expect([...roles.keys()].sort()).toEqual(themedRoles);
  });

  describe.each(ThemeSchema.options.filter((theme) => theme !== 'system'))('%s', (theme) => {
    it.each(TEXT_PAIRS)('keeps %s on %s at 4.5:1 or better', (text, background) => {
      expect(
        contrast(resolve(theme, `--color-${text}`), resolve(theme, `--color-${background}`))
      ).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps every status glyph visible against cards (3:1 for UI marks)', () => {
      for (const status of STATUSES) {
        const color = resolve(theme, `--color-status-${status}`);
        expect(contrast(color, resolve(theme, '--color-surface')), status).toBeGreaterThanOrEqual(
          3
        );
      }
    });

    // The edge is a region's quiet outline at rest; the emphasis marks the hovered or selected
    // card's Groups, so it must read as a UI mark. Both sit directly on the canvas.
    it.each([
      ['group-region-edge', 2],
      ['group-region-emphasis', 3]
    ] as const)('keeps %s visible on the canvas (%s:1)', (role, floor) => {
      expect(
        contrast(resolve(theme, `--color-${role}`), resolve(theme, '--color-bg-canvas'))
      ).toBeGreaterThanOrEqual(floor);
    });

    // The fill is the region role mixed thin over the canvas; on a light canvas a pale role washes
    // out entirely, which is how Paper regions vanished in the prototype.
    it('keeps the Group region fill distinguishable from the canvas', () => {
      const canvas = resolve(theme, '--color-bg-canvas');
      const fill = composite(resolve(theme, '--color-group-region'), canvas, regionFillShare());
      expect(distance(fill, canvas)).toBeGreaterThanOrEqual(0.035);
    });
  });

  it.each(CHROMATIC_THEMES)('%s gives each status a distinct color', (theme) => {
    const colors = STATUSES.map((status) => resolve(theme, `--color-status-${status}`));
    for (const [index, color] of colors.entries()) {
      for (const other of colors.slice(index + 1)) {
        expect(distance(color, other), `${color} vs ${other}`).toBeGreaterThan(0.1);
      }
    }
  });
});

// index.html cannot read the stylesheets before they load, so it carries each Theme's background.
describe('the first-paint browser chrome color', () => {
  const html = css('../index.html');
  const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  const themeColor = (): string | null | undefined =>
    document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('defaults to the product default Theme before any hint exists', () => {
    expect(/<meta name="theme-color" content="([^"]+)"/.exec(html)?.[1]).toBe(
      resolve('midnight', '--color-bg')
    );
  });

  // Every choice, including both System appearances, without the app having painted it first.
  it.each([
    ...ThemeSchema.options.flatMap((choice) =>
      choice === 'system' ? [] : [{ choice, dark: false, painted: choice }]
    ),
    { choice: 'system', dark: false, painted: 'paper' },
    { choice: 'system', dark: true, painted: 'midnight' }
  ] as const)('paints $choice (OS dark: $dark) with its stylesheet background', (example) => {
    vi.stubGlobal('matchMedia', () => ({ matches: example.dark }));
    document.head.innerHTML = '<meta name="theme-color" content="unset" />';
    localStorage.setItem(THEME_HINT_KEY, JSON.stringify({ theme: example.choice }));
    runInNewContext(inline, { window, document, localStorage });
    expect(document.documentElement.dataset.theme).toBe(example.painted);
    expect(themeColor()).toBe(resolve(example.painted, '--color-bg'));
  });
});
