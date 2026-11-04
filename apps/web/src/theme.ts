import { PRODUCT_DEFAULT_SETTINGS, ThemeSchema, type Theme } from '@n2/contracts';
import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';
import {
  applicationPreferencesQueryOptions,
  projectSettingsQueryOptions
} from './settingsQueries.js';

// Read by the inline script in index.html, which paints the right Theme for the URL before the app
// loads. It holds only server-confirmed choices: the application Theme and the Themes pinned by
// Projects this browser has opened. resolveDocumentTheme alone decides what it holds.
export const THEME_HINT_KEY = 'n2.theme';

export const THEME_OPTIONS = [
  { theme: 'midnight', label: 'Midnight', description: 'Deep ink. The default.' },
  { theme: 'mono', label: 'Mono', description: 'Maximum contrast.' },
  { theme: 'paper', label: 'Paper', description: 'Warm paper for daylight.' },
  { theme: 'ember', label: 'Ember', description: 'Charcoal lit by amber.' },
  { theme: 'system', label: 'System', description: 'Follows OS light and dark.' }
] as const satisfies readonly { theme: Theme; label: string; description: string }[];

export const themeLabel = (theme: Theme): string =>
  THEME_OPTIONS.find((option) => option.theme === theme)?.label ?? theme;

export type EffectiveTheme = Exclude<Theme, 'system'>;

export const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

export function resolveTheme(theme: Theme, dark: boolean): EffectiveTheme {
  return theme === 'system' ? (dark ? 'midnight' : 'paper') : theme;
}

export type ThemeHint = { theme?: Theme; projectThemes: Record<string, Theme> };

// What the current scope's settings snapshot says about Theme. In a Project, the pin and the
// application Theme it inherited come from the same response; in the Library there is no pin.
export type ScopeTheme = { application: Theme; pinned?: Theme | undefined };

function recordSnapshot(
  hint: ThemeHint,
  projectId: string | undefined,
  { application, pinned }: ScopeTheme
): ThemeHint {
  if (projectId === undefined) return { ...hint, theme: application };
  const otherPins = Object.fromEntries(
    Object.entries(hint.projectThemes).filter(([id]) => id !== projectId)
  );
  return {
    theme: application,
    projectThemes: pinned ? { ...otherPins, [projectId]: pinned } : otherPins
  };
}

/**
 * The one place that decides both the document Theme and the hint index.html paints from next.
 *
 * A confirmed snapshot of the current scope updates the hint. Without one, while it loads or after
 * it fails to load, the cached hint stands; a failed refresh keeps the last snapshot. The document then paints exactly what the inline script paints from that hint
 * at this URL: this Project's pin, else the application Theme. In a Project with a snapshot, that is
 * its effective Theme. Another Project's pin never applies, and a reload paints what is shown now.
 */
export function resolveDocumentTheme({
  projectId,
  snapshot,
  hint
}: {
  projectId: string | undefined;
  snapshot: ScopeTheme | undefined;
  hint: ThemeHint;
}): { theme: Theme; hint: ThemeHint } {
  const next = snapshot ? recordSnapshot(hint, projectId, snapshot) : hint;
  const pin =
    projectId !== undefined && Object.hasOwn(next.projectThemes, projectId)
      ? next.projectThemes[projectId]
      : undefined;
  return { theme: pin ?? next.theme ?? PRODUCT_DEFAULT_SETTINGS.theme, hint: next };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// Tolerant by design: a hint from an older build, or one edited by hand, only loses what is invalid.
function readThemeHint(): ThemeHint {
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(THEME_HINT_KEY) ?? 'null');
  } catch {
    // Unreadable storage or JSON is an empty hint.
  }
  const hint: ThemeHint = { projectThemes: {} };
  if (!isRecord(stored)) return hint;
  const theme = ThemeSchema.safeParse(stored.theme);
  if (theme.success) hint.theme = theme.data;
  if (isRecord(stored.projectThemes)) {
    for (const [projectId, value] of Object.entries(stored.projectThemes)) {
      const pinned = ThemeSchema.safeParse(value);
      if (pinned.success) hint.projectThemes[projectId] = pinned.data;
    }
  }
  return hint;
}

function writeThemeHint(serialized: string): void {
  try {
    localStorage.setItem(THEME_HINT_KEY, serialized);
  } catch {
    // Storage can be unavailable (private mode, quota); only the next load's first paint suffers.
  }
}

// Browser chrome reads <meta name="theme-color">, which CSS cannot reach, so it copies the
// painted Theme's background.
function applyTheme(theme: Theme, dark = false): void {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(theme, dark);
  const background = getComputedStyle(root).getPropertyValue('--color-bg').trim();
  if (background) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
  }
}

/** Keeps the document and its paint hint on resolveDocumentTheme for where the user is. */
export function useDocumentTheme(projectId: string | undefined): void {
  // Each query is enabled only in its scope, so entering a scope refetches its stale snapshot even
  // when another view keeps the query mounted.
  const application = useQuery({
    ...applicationPreferencesQueryOptions,
    enabled: projectId === undefined,
    select: (preferences): ScopeTheme => ({ application: preferences.values.theme })
  });
  const project = useQuery({
    ...projectSettingsQueryOptions(projectId),
    select: (settings): ScopeTheme => ({
      application: settings.applicationValues.theme,
      pinned: settings.overrides.theme
    })
  });
  const resolved = resolveDocumentTheme({
    projectId,
    snapshot: (projectId === undefined ? application : project).data,
    hint: readThemeHint()
  });
  const { theme } = resolved;
  const hint = JSON.stringify(resolved.hint);

  useLayoutEffect(() => {
    writeThemeHint(hint);
    if (theme !== 'system') {
      applyTheme(theme);
      return;
    }
    const appearance = window.matchMedia(SYSTEM_THEME_QUERY);
    const update = (): void => applyTheme(theme, appearance.matches);
    update();
    appearance.addEventListener('change', update);
    return () => appearance.removeEventListener('change', update);
  }, [theme, hint]);
}
