import type { ApplicationPreferences, EffectiveProjectSettings, Theme } from '@n2/contracts';
import { resolveEffectiveProjectSettings } from '@n2/contracts';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api.js';
import { projectPath } from './appLocation.js';
import { createQueryClient } from './queryClient.js';
import {
  APPLICATION_PREFERENCES_QUERY_KEY,
  applicationPreferencesQueryOptions,
  storeProjectSettings
} from './settingsQueries.js';
import {
  resolveDocumentTheme,
  resolveTheme,
  SYSTEM_THEME_QUERY,
  THEME_HINT_KEY,
  useDocumentTheme,
  type ScopeTheme,
  type ThemeHint
} from './theme.js';

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getApplicationPreferences: vi.fn(),
  getProjectSettings: vi.fn(),
  updateApplicationPreference: vi.fn()
}));

const preferences = (theme: Theme): ApplicationPreferences => ({
  values: { handleOrientation: 'horizontal', minimapVisible: true, theme },
  productDefaults: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
  storedValues: { theme }
});

const projectSettings = (
  projectId: string,
  applicationTheme: Theme,
  pinned?: Theme
): EffectiveProjectSettings =>
  resolveEffectiveProjectSettings({
    projectId,
    applicationValues: preferences(applicationTheme).values,
    overrides: pinned ? { theme: pinned } : {}
  });

// jsdom loads no stylesheets, so each Theme's background is stubbed from the painted data-theme.
const stubBackgrounds = (): void => {
  vi.spyOn(CSSStyleDeclaration.prototype, 'getPropertyValue').mockImplementation((name) =>
    name === '--color-bg' ? `${document.documentElement.dataset.theme}-background` : ''
  );
};

const themeColor = (): string | null =>
  document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;

const storedHint = (): unknown => JSON.parse(localStorage.getItem(THEME_HINT_KEY) ?? 'null');

function ThemedApp({ projectId }: { projectId?: string | undefined }) {
  useDocumentTheme(projectId);
  return null;
}

function renderThemedApp(projectId?: string, client = createQueryClient()) {
  const rendered = render(
    <QueryClientProvider client={client}>
      <ThemedApp projectId={projectId} />
    </QueryClientProvider>
  );
  return {
    client,
    ...rendered,
    navigate: (next?: string) =>
      rendered.rerender(
        <QueryClientProvider client={client}>
          <ThemedApp projectId={next} />
        </QueryClientProvider>
      )
  };
}

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="static-default" />';
  delete document.documentElement.dataset.theme;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function emulateAppearance(dark: boolean) {
  const appearance = Object.assign(new EventTarget(), {
    matches: dark,
    media: SYSTEM_THEME_QUERY,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn()
  }) satisfies MediaQueryList;
  const matchMedia = vi.fn(() => appearance);
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    appearance,
    matchMedia,
    change(this: void, dark: boolean) {
      appearance.matches = dark;
      act(() => {
        appearance.dispatchEvent(new Event('change'));
      });
    }
  };
}

function runPaintHint() {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../index.html'), 'utf8');
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  expect(inline).toContain(`'${THEME_HINT_KEY}'`);
  // Execute the exact pre-module source with the browser globals, including emulated media.
  runInNewContext(inline ?? '', { window, document, localStorage });
}

describe('Theme application', () => {
  it('follows the Theme preference on the document, browser chrome, and paint hint', async () => {
    vi.mocked(api.getApplicationPreferences).mockResolvedValue(preferences('paper'));
    stubBackgrounds();
    renderThemedApp();

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('paper'));
    expect(themeColor()).toBe('paper-background');
    expect(storedHint()).toEqual({ theme: 'paper', projectThemes: {} });
  });

  it.each([
    ['a pinned Project', projectPath('Garden plan/2026'), 'mono'],
    ['a Project that inherits', projectPath('other'), 'ember'],
    ['the Library', '/', 'ember'],
    ['a malformed Project path', '/projects/%E0%A4%A', 'ember']
  ])('paints %s from its URL before the app loads', (_, path, expected) => {
    window.history.replaceState(null, '', path);
    localStorage.setItem(
      THEME_HINT_KEY,
      JSON.stringify({ theme: 'ember', projectThemes: { 'Garden plan/2026': 'mono' } })
    );

    runPaintHint();

    // themes.test.ts checks each Theme's browser chrome color against the stylesheets.
    expect(document.documentElement.dataset.theme).toBe(expected);
  });

  it.each([false, true])('resolves System for dark=%s while fixed choices remain fixed', (dark) => {
    expect(resolveTheme('system', dark)).toBe(dark ? 'midnight' : 'paper');
    for (const theme of ['midnight', 'paper', 'ember', 'mono'] as const) {
      expect(resolveTheme(theme, dark)).toBe(theme);
    }
  });

  it.each([false, true])('paints System from the current OS before app load (dark=%s)', (dark) => {
    emulateAppearance(dark);
    window.history.replaceState(null, '', projectPath('daylight'));
    localStorage.setItem(
      THEME_HINT_KEY,
      JSON.stringify({ theme: 'ember', projectThemes: { daylight: 'system' } })
    );
    runPaintHint();
    expect(document.documentElement.dataset.theme).toBe(dark ? 'midnight' : 'paper');
  });

  it('follows OS changes live, preserves System, and stops listening for fixed Themes or unmount', async () => {
    const { appearance, change, matchMedia } = emulateAppearance(false);
    const removeListener = vi.spyOn(appearance, 'removeEventListener');
    vi.mocked(api.getApplicationPreferences).mockResolvedValue(preferences('system'));
    stubBackgrounds();
    const { client, unmount } = renderThemedApp();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('paper'));
    expect(matchMedia).toHaveBeenCalledWith(SYSTEM_THEME_QUERY);
    expect(themeColor()).toBe('paper-background');
    change(true);
    expect(document.documentElement.dataset.theme).toBe('midnight');
    expect(themeColor()).toBe('midnight-background');
    expect(storedHint()).toEqual({ theme: 'system', projectThemes: {} });
    change(false);
    expect(document.documentElement.dataset.theme).toBe('paper');
    expect(themeColor()).toBe('paper-background');
    expect(api.updateApplicationPreference).not.toHaveBeenCalled();

    act(() => {
      client.setQueryData(APPLICATION_PREFERENCES_QUERY_KEY, preferences('ember'));
    });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('ember'));
    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function));
    change(true);
    expect(document.documentElement.dataset.theme).toBe('ember');
    act(() => {
      client.setQueryData(APPLICATION_PREFERENCES_QUERY_KEY, preferences('system'));
    });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('midnight'));
    unmount();
    expect(removeListener).toHaveBeenCalledTimes(2);
    change(false);
    expect(document.documentElement.dataset.theme).toBe('midnight');
  });

  it('still follows the OS when browser storage is unavailable', async () => {
    const { change, matchMedia } = emulateAppearance(true);
    vi.mocked(api.getApplicationPreferences).mockResolvedValue(preferences('system'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Unavailable');
    });
    renderThemedApp();
    // The product default is also Midnight, so wait for System itself to take over.
    await waitFor(() => expect(matchMedia).toHaveBeenCalled());
    expect(document.documentElement.dataset.theme).toBe('midnight');
    change(false);
    expect(document.documentElement.dataset.theme).toBe('paper');
  });
});

describe('Project Themes', () => {
  it('uses a Project pin inside the Project and the application Theme in the Library', async () => {
    vi.mocked(api.getApplicationPreferences).mockResolvedValue(preferences('midnight'));
    vi.mocked(api.getProjectSettings).mockResolvedValue(
      projectSettings('pinned', 'midnight', 'paper')
    );
    stubBackgrounds();
    const { navigate } = renderThemedApp('pinned');

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('paper'));
    expect(themeColor()).toBe('paper-background');
    expect(storedHint()).toEqual({ theme: 'midnight', projectThemes: { pinned: 'paper' } });

    navigate(undefined);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('midnight'));
    expect(themeColor()).toBe('midnight-background');
  });

  it("paints a cleared pin's acknowledgment, and the Library catches up on entry", async () => {
    vi.mocked(api.getApplicationPreferences).mockResolvedValue(preferences('midnight'));
    vi.mocked(api.getProjectSettings).mockResolvedValue(
      projectSettings('pinned', 'midnight', 'paper')
    );
    const { client, navigate } = renderThemedApp();
    await waitFor(() => expect(storedHint()).toEqual({ theme: 'midnight', projectThemes: {} }));
    navigate('pinned');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('paper'));

    // Another device moved the application Theme to Ember; this tab still caches Midnight. The
    // acknowledgment of clearing the pin carries the server's resolution, which is what shows.
    vi.mocked(api.getApplicationPreferences).mockResolvedValue(preferences('ember'));
    vi.mocked(api.getProjectSettings).mockResolvedValue(projectSettings('pinned', 'ember'));
    await act(() => storeProjectSettings(client, projectSettings('pinned', 'ember')));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('ember'));
    expect(storedHint()).toEqual({ theme: 'ember', projectThemes: {} });
    window.history.replaceState(null, '', projectPath('pinned'));
    delete document.documentElement.dataset.theme;
    runPaintHint();
    expect(document.documentElement.dataset.theme).toBe('ember');

    // The Library refetches its snapshot on entry, so Ember survives leaving the Project.
    navigate(undefined);
    await waitFor(() =>
      expect(
        client.getQueryData<ApplicationPreferences>(APPLICATION_PREFERENCES_QUERY_KEY)?.values.theme
      ).toBe('ember')
    );
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('ember'));
    expect(storedHint()).toEqual({ theme: 'ember', projectThemes: {} });
  });

  it('refetches the snapshot on every scope entry, even while another view keeps it mounted', async () => {
    vi.mocked(api.getApplicationPreferences).mockClear().mockResolvedValue(preferences('midnight'));
    vi.mocked(api.getProjectSettings)
      .mockClear()
      .mockResolvedValue(projectSettings('a', 'midnight'));
    // The app's QueryClient keeps most data fresh for ten seconds; settings must not be.
    const client = createQueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } });
    function MountedElsewhere() {
      useQuery(applicationPreferencesQueryOptions);
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <MountedElsewhere />
      </QueryClientProvider>
    );
    const { navigate } = renderThemedApp(undefined, client);
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const reads = () => [
      vi.mocked(api.getApplicationPreferences).mock.calls.length,
      vi.mocked(api.getProjectSettings).mock.calls.length
    ];
    expect(reads()).toEqual([1, 0]);

    for (const [scope, expected] of [
      ['a', [1, 1]],
      [undefined, [2, 1]],
      ['a', [2, 2]]
    ] as const) {
      navigate(scope);
      await waitFor(() => expect(reads()).toEqual(expected));
    }
  });

  it('shows a Project whose settings failed as inheriting, not as the last Project', async () => {
    vi.mocked(api.getApplicationPreferences).mockResolvedValue(preferences('midnight'));
    vi.mocked(api.getProjectSettings).mockImplementation((projectId) =>
      projectId === 'a'
        ? Promise.resolve(projectSettings('a', 'midnight', 'paper'))
        : Promise.reject(new Error('Unavailable'))
    );
    const { navigate } = renderThemedApp(
      'a',
      createQueryClient({ defaultOptions: { queries: { retry: false } } })
    );
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('paper'));

    navigate('b');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('midnight'));
    expect(storedHint()).toEqual({ theme: 'midnight', projectThemes: { a: 'paper' } });
  });

  it('switches to a cached pin at once instead of flashing through the application Theme', async () => {
    vi.mocked(api.getApplicationPreferences).mockResolvedValue(preferences('midnight'));
    let respond: (settings: EffectiveProjectSettings) => void = () => undefined;
    vi.mocked(api.getProjectSettings).mockReturnValue(
      new Promise((resolve) => {
        respond = resolve;
      })
    );
    localStorage.setItem(THEME_HINT_KEY, JSON.stringify({ projectThemes: { pinned: 'mono' } }));
    const { navigate } = renderThemedApp();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('midnight'));

    const painted: (string | undefined)[] = [];
    const observer = new MutationObserver(() => {
      painted.push(document.documentElement.dataset.theme);
    });
    observer.observe(document.documentElement, { attributes: true });
    navigate('pinned');
    expect(document.documentElement.dataset.theme).toBe('mono');

    // The server is authoritative: a pin changed on another device replaces the cached one.
    act(() => respond(projectSettings('pinned', 'midnight', 'ember')));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('ember'));
    await Promise.resolve();
    observer.disconnect();
    expect(painted).not.toContain('midnight');
    expect(storedHint()).toMatchObject({ projectThemes: { pinned: 'ember' } });
  });
});

describe('resolveDocumentTheme', () => {
  // Each source has its own Theme, so the result names the source that won.
  const SNAPSHOT_APPLICATION = 'ember';
  const SNAPSHOT_PIN = 'paper';
  const CACHED_APPLICATION = 'mono';
  const THIS_PIN = 'midnight';
  const OTHER_PIN = 'system';

  // Loading and failing to load both leave no snapshot; a failed refresh keeps the last one.
  const snapshots: [string, ScopeTheme | undefined][] = [
    ['none', undefined],
    ['inherits', { application: SNAPSHOT_APPLICATION }],
    ['pins', { application: SNAPSHOT_APPLICATION, pinned: SNAPSHOT_PIN }]
  ];
  const hints: Record<string, ThemeHint> = {
    'no pin': { theme: CACHED_APPLICATION, projectThemes: {} },
    'a pin for this Project': { theme: CACHED_APPLICATION, projectThemes: { open: THIS_PIN } },
    'a pin for another Project': { theme: CACHED_APPLICATION, projectThemes: { other: OTHER_PIN } }
  };
  const cases = [undefined, 'open'].flatMap((projectId) =>
    snapshots.flatMap(([snapshotLabel, snapshot]) =>
      Object.entries(hints).map(([hintLabel, hint]) => ({
        label: `${projectId ? 'Project' : 'Library'}, snapshot ${snapshotLabel}, ${hintLabel}`,
        input: { projectId, snapshot, hint }
      }))
    )
  );

  // The rule: this scope's snapshot, else the cached hint for this scope. In a Project, its pin
  // wins over the application Theme.
  it.each(cases)('$label', ({ input }) => {
    const { projectId, snapshot, hint } = input;
    const resolved = resolveDocumentTheme(input);
    const pin =
      projectId === undefined ? undefined : snapshot ? snapshot.pinned : hint.projectThemes.open;
    const application = snapshot ? SNAPSHOT_APPLICATION : CACHED_APPLICATION;
    expect(resolved.theme).toBe(pin ?? application);
    expect(resolved.hint.projectThemes.other).toBe(hint.projectThemes.other);

    // The invariant that keeps reload and paint in step: the real startup script, given the
    // returned hint at this URL, paints the Theme the document shows.
    localStorage.setItem(THEME_HINT_KEY, JSON.stringify(resolved.hint));
    window.history.replaceState(null, '', projectId ? projectPath(projectId) : '/');
    for (const dark of [false, true]) {
      emulateAppearance(dark);
      delete document.documentElement.dataset.theme;
      runPaintHint();
      expect(document.documentElement.dataset.theme).toBe(resolveTheme(resolved.theme, dark));
    }
  });

  it('records a Project snapshot as the hint, setting or deleting only its pin', () => {
    const hint = hints['a pin for this Project']!;
    const resolve = (snapshot: ScopeTheme) =>
      resolveDocumentTheme({ projectId: 'open', snapshot, hint }).hint;

    expect(resolve({ application: 'ember', pinned: 'paper' })).toEqual({
      theme: 'ember',
      projectThemes: { open: 'paper' }
    });
    expect(resolve({ application: 'ember' })).toEqual({ theme: 'ember', projectThemes: {} });
  });

  it('changes nothing without a snapshot, and paints the product default', () => {
    const empty: ThemeHint = { projectThemes: {} };
    expect(resolveDocumentTheme({ projectId: 'open', snapshot: undefined, hint: empty })).toEqual({
      theme: 'midnight',
      hint: empty
    });
  });

  it('ignores inherited object keys as Project pins', () => {
    expect(
      resolveDocumentTheme({
        projectId: 'constructor',
        snapshot: undefined,
        hint: { theme: 'ember', projectThemes: {} }
      }).theme
    ).toBe('ember');
  });
});
