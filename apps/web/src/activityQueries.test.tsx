import type { ProjectActivity } from '@n2/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activityQueryKey, useActivitySession } from './activityQueries.js';
import * as api from './api.js';
import { executionQueryKey, projectQueryKey } from './useProjectCommands.js';

vi.mock('./api.js', () => ({
  getActivity: vi.fn(),
  markActivitySeen: vi.fn()
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const activity = (latestSequence: number, seenSequence: number): ProjectActivity => ({
  projectId: 'project',
  latestSequence,
  seen: { sequence: seenSequence, seenAt: '2026-10-20T18:40:00.000Z' },
  unseenItemCount: latestSequence - seenSequence,
  runs: [],
  hasEarlier: false
});

const onClose = vi.fn();

/** Renders the session beside a graph that reflects `graphSequence` (by default, all of it). */
const renderSession = async (
  loaded: ProjectActivity,
  graphSequence: number = loaded.latestSequence
) => {
  vi.mocked(api.getActivity).mockResolvedValue(loaded);
  vi.mocked(api.markActivitySeen).mockResolvedValue({
    sequence: loaded.latestSequence,
    seenAt: '2026-10-21T09:30:00.000Z'
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Cached without observers, so an invalidation marks them stale rather than refetching.
  client.setQueryData(projectQueryKey('project'), { latestSequence: graphSequence });
  client.setQueryData(executionQueryKey('project'), {});
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const session = renderHook(() => useActivitySession('project', graphSequence, onClose), {
    wrapper
  });
  await waitFor(() => expect(session.result.current.activity).toEqual(loaded));
  return { ...session, client };
};

const staleQueries = (client: QueryClient) =>
  [projectQueryKey('project'), executionQueryKey('project')].filter(
    (queryKey) => client.getQueryState(queryKey)?.isInvalidated
  );

describe('Activity session', () => {
  it('marks what it showed as seen when it closes, not when it opens', async () => {
    const { result } = await renderSession(activity(7, 3));

    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    expect(api.markActivitySeen).not.toHaveBeenCalled();

    act(() => result.current.close());
    expect(result.current.open).toBe(false);
    expect(api.markActivitySeen).toHaveBeenCalledWith('project', 7);
  });

  it('writes nothing when there was nothing new', async () => {
    const { result } = await renderSession(activity(7, 7));

    act(() => result.current.toggle());
    act(() => result.current.close());

    expect(api.markActivitySeen).not.toHaveBeenCalled();
  });

  it('tells its owner each time it closes, by the close button or the toggle', async () => {
    const { result } = await renderSession(activity(7, 7));

    act(() => result.current.toggle());
    act(() => result.current.close());
    expect(onClose).toHaveBeenCalledOnce();
    act(() => result.current.toggle());
    act(() => result.current.toggle());

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('Activity keeps the canvas current', () => {
  it('refreshes a graph loaded before an agent’s command, even on Activity’s first response', async () => {
    // The graph loads at 4, an agent's command lands as 5, then Activity loads.
    const { client } = await renderSession(activity(5, 5), 4);

    await waitFor(() =>
      expect(staleQueries(client)).toEqual([
        projectQueryKey('project'),
        executionQueryKey('project')
      ])
    );
  });

  it('refreshes the graph when a later poll shows a newer command', async () => {
    const { client } = await renderSession(activity(5, 5));
    expect(staleQueries(client)).toEqual([]);

    vi.mocked(api.getActivity).mockResolvedValue(activity(6, 5));
    await act(() => client.refetchQueries({ queryKey: activityQueryKey('project') }));

    await waitFor(() => expect(staleQueries(client)).toHaveLength(2));
  });

  it('leaves a graph alone that already reflects the newest command, or is ahead of it', async () => {
    const current = await renderSession(activity(5, 5), 5);
    // A command response can carry the graph past an Activity poll still in flight.
    const ahead = await renderSession(activity(5, 5), 6);

    expect([staleQueries(current.client), staleQueries(ahead.client)]).toEqual([[], []]);
  });
});
