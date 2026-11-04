import { BUILD_COMMIT_HEADER } from '@n2/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api.js';
import { createUpdateWatch, updateWatch } from './appUpdate.js';
import type * as AppUpdate from './appUpdate.js';
import { UpdateBanner } from './components/UpdateBanner.js';

// This file plays a deployed tab: its bundle names a commit, read once at import.
const reload = vi.hoisted(() => {
  vi.stubEnv('N2_BUILD_COMMIT', 'bundle-commit');
  return vi.fn();
});
vi.mock('./appUpdate.js', async (importOriginal) => ({
  ...(await importOriginal<typeof AppUpdate>()),
  reloadForUpdate: reload
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  reload.mockClear();
});

describe('createUpdateWatch', () => {
  it.each([
    ['a development bundle', undefined, 'server-commit'],
    ['a development server', 'bundle-commit', null],
    ['the same build', 'bundle-commit', 'bundle-commit']
  ])('reports no update for %s', (_, bundleCommit, serverCommit) => {
    const watch = createUpdateWatch(bundleCommit);
    watch.observe(serverCommit);
    expect(watch.available()).toBe(false);
  });

  it('reports a different server build once, and keeps it', () => {
    const watch = createUpdateWatch('bundle-commit');
    const listener = vi.fn();
    watch.subscribe(listener);
    watch.observe('server-commit');
    watch.observe('bundle-commit');
    expect(watch.available()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// The module-level watch, like a real tab, learns of an update once and keeps it. Each test below
// observes the newer server itself, so none depends on another having run first.
describe('a tab whose server was updated', () => {
  it('learns of the update from the very response it is too old to parse', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { values: { theme: 'ember' }, newerField: true },
            { headers: { [BUILD_COMMIT_HEADER]: 'server-commit' } }
          )
        )
    );

    await expect(api.getApplicationPreferences()).rejects.toBeInstanceOf(api.LocalProtocolError);
    expect(updateWatch.available()).toBe(true);
  });

  it('shows one Reload that cannot be dismissed, and reloads only on request', async () => {
    updateWatch.observe('server-commit');
    render(<UpdateBanner />);
    const banner = screen.getByRole('status', { name: 'N² update' });
    expect(banner.querySelectorAll('button')).toHaveLength(1);
    expect(reload).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
