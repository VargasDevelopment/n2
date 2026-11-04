import type { ProjectedNode } from '@n2/contracts';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noSelection, nodeSelection } from './graphInteraction.js';
import {
  DELETED_ITEM_NOTICE,
  useCanvasNavigation,
  type NavigationIntent
} from './useCanvasNavigation.js';

const note = (id: string): ProjectedNode => ({
  id,
  reference: 'N2-1',
  title: id,
  content: '',
  kind: 'note',
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: '2026-10-21T09:00:00.000Z',
  updatedAt: '2026-10-21T09:00:00.000Z'
});
const graph = (latestSequence: number, ...ids: string[]) => ({
  nodes: ids.map(note),
  relationships: [],
  latestSequence
});
type Graph = ReturnType<typeof graph>;
const toNew = { nodeId: 'new', placement: 'left', sequence: 5 } as const;

const renderNavigation = (initial: Graph, initialIntent: NavigationIntent | null = null) => {
  const reveal = vi.fn((nodeId: string) => `Cleared the filters to show ${nodeId}.`);
  const announce = vi.fn();
  const hook = renderHook(
    ({ project }: { project: Graph }) => {
      const [selection, setSelection] = useState(noSelection);
      const navigation = useCanvasNavigation({
        project,
        selection,
        setSelection,
        reveal,
        announce,
        initialIntent
      });
      return { selection, setSelection, ...navigation };
    },
    { initialProps: { project: initial } }
  );
  return { ...hook, reveal, announce };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCanvasNavigation', () => {
  it('carries out an item followed from another page once the graph reaches it', () => {
    const { rerender, result } = renderNavigation(graph(4, 'old'), toNew);

    expect(result.current.pending).toEqual(toNew);
    rerender({ project: graph(5, 'old', 'new') });
    expect(result.current.selection).toEqual(nodeSelection('new', 'left'));
    expect(result.current.focusRequest).toEqual({ nodeId: 'new' });
  });

  it.each([
    ['lacks the item', graph(4, 'old')],
    // Holding the item is not enough: the change the link reports may still be on its way.
    ['holds the item from before the change', graph(4, 'old', 'new')]
  ])(
    'waits while the graph %s, however long it takes, then reveals and selects it',
    (_name, cached) => {
      const { announce, rerender, result, reveal } = renderNavigation(cached);

      act(() => result.current.navigate(toNew));
      // Far past any render wait: only the graph decides when the item can be shown.
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect([result.current.focusRequest, result.current.selection]).toEqual([null, noSelection]);
      expect(result.current.pending).toEqual(toNew);
      expect(reveal).not.toHaveBeenCalled();

      rerender({ project: graph(5, 'old', 'new') });

      expect(reveal).toHaveBeenCalledWith('new');
      expect(result.current.selection).toEqual(nodeSelection('new', 'left'));
      expect(result.current.focusRequest).toEqual({ nodeId: 'new' });
      expect(result.current.pending).toBeNull();
      expect(announce).toHaveBeenCalledExactlyOnceWith('Cleared the filters to show new.');
    }
  );

  it('goes at once when the graph already reflects the link', () => {
    const { result } = renderNavigation(graph(5, 'new'));

    act(() => result.current.navigate(toNew));

    expect(result.current.focusRequest).toEqual({ nodeId: 'new' });
  });

  it('gives up, and says why, once the graph reflects the link without the item', () => {
    const { announce, rerender, result } = renderNavigation(graph(4, 'old'));

    act(() => result.current.navigate(toNew));
    rerender({ project: graph(6, 'old') });
    rerender({ project: graph(7, 'old', 'new') });

    expect([result.current.focusRequest, result.current.selection]).toEqual([null, noSelection]);
    expect(result.current.pending).toBeNull();
    expect(announce).toHaveBeenCalledExactlyOnceWith(DELETED_ITEM_NOTICE);
  });

  it.each([
    ['waiting for the graph', graph(4, 'old')],
    ['focusing', graph(5, 'new')]
  ])('ends when the person moves the viewport while %s', (_name, initial) => {
    const { rerender, result } = renderNavigation(initial);

    act(() => result.current.navigate(toNew));
    act(() => result.current.personMovedViewport());
    rerender({ project: graph(5, 'old', 'new') });

    expect([result.current.focusRequest, result.current.pending]).toEqual([null, null]);
  });

  it('ends when the person selects something else while it waits', () => {
    const { rerender, result } = renderNavigation(graph(4, 'old'));

    act(() => result.current.navigate(toNew));
    act(() => result.current.setSelection(nodeSelection('old')));
    rerender({ project: graph(5, 'old', 'new') });

    expect([result.current.focusRequest, result.current.selection]).toEqual([
      null,
      nodeSelection('old')
    ]);
    expect(result.current.pending).toBeNull();
  });

  it('drops a waiting link when its source is withdrawn, but not a focus already under way', () => {
    const waiting = renderNavigation(graph(4, 'old'));
    act(() => waiting.result.current.navigate(toNew));
    act(() => waiting.result.current.withdraw());
    waiting.rerender({ project: graph(5, 'old', 'new') });

    const focusing = renderNavigation(graph(5, 'new'));
    act(() => focusing.result.current.navigate(toNew));
    act(() => focusing.result.current.withdraw());

    expect([waiting.result.current.focusRequest, waiting.result.current.selection]).toEqual([
      null,
      noSelection
    ]);
    expect(focusing.result.current.focusRequest).toEqual({ nodeId: 'new' });
  });

  it('lets go of a focus request once the canvas settles that same request', () => {
    const { result } = renderNavigation(graph(5, 'new'));
    act(() => result.current.navigate(toNew));
    const first = result.current.focusRequest ?? { nodeId: 'unset' };
    act(() => result.current.navigate(toNew));
    const second = result.current.focusRequest ?? { nodeId: 'unset' };
    expect(second).not.toBe(first);

    // A late report about the replaced request leaves the new one alone.
    act(() => result.current.focusSettled(first));
    expect(result.current.focusRequest).toBe(second);
    act(() => result.current.focusSettled(second));

    expect(result.current.focusRequest).toBeNull();
    expect(result.current.selection).toEqual(nodeSelection('new', 'left'));
  });
});
