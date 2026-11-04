import type { ProjectedNode } from '@n2/contracts';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createRoadmapRange } from './roadmapRange.js';
import { canvasReveal, useCanvasViewState } from './useCanvasViewState.js';

const now = '2026-08-21T12:00:00.000Z';
const task = (id: string, title: string, date: string): ProjectedNode => ({
  id,
  reference: `N2-${id}`,
  title,
  description: '',
  kind: 'task',
  requestedStatus: 'ready',
  effectiveStatus: 'ready',
  progress: 0,
  blockedBy: [],
  planningPlacement: { kind: 'milestone', date },
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: now,
  updatedAt: now
});

const project = {
  nodes: [task('inside', 'Alpha', '2026-08-25'), task('outside', 'Beta', '2026-09-15')],
  relationships: []
};
const unfiltered = { hiddenStatuses: new Set<never>(), textQuery: '' };
const alphaOnly = { ...unfiltered, textQuery: 'alpha' };
const roadmap = new Set(['roadmap'] as const);
const august = { roadmapRange: createRoadmapRange('2026-08-22', '2026-08-30') };

describe('canvasReveal', () => {
  it.each([
    ['an item that already shows', 'inside', alphaOnly, august, false, false],
    ['an item only the filters hide', 'outside', alphaOnly, {}, true, false],
    ['an item only the Roadmap range hides', 'outside', unfiltered, august, false, true],
    ['an item both hide', 'outside', alphaOnly, august, true, true]
  ])('resets the least view state for %s', (_, nodeId, filters, options, clear, reset) => {
    expect(canvasReveal(project, nodeId, filters, roadmap, options)).toEqual({
      clearFilters: clear,
      resetRoadmapRange: reset
    });
  });
});

describe('useCanvasViewState Note expansion', () => {
  const note = (id: string, title: string): ProjectedNode => ({
    id,
    reference: `N2-${id}`,
    title,
    content: 'Long enough to fold.',
    kind: 'note',
    position: { x: 0, y: 0 },
    version: 0,
    createdAt: now,
    updatedAt: now
  });
  const notesProject = {
    nodes: [...project.nodes, note('a', 'Gamma notes'), note('b', 'Delta notes')],
    relationships: []
  };
  const visibleIds = (view: ReturnType<typeof useCanvasViewState>) =>
    view.canvasView?.graph.nodes.map(({ id }) => id);

  it('keeps expanded Notes, and their order, through a search that hides them', () => {
    const { result } = renderHook(() => useCanvasViewState(notesProject));
    act(() => result.current.noteExpansion.toggleNoteFold('b'));
    act(() => result.current.noteExpansion.toggleNoteFold('a'));

    act(() => result.current.filterControls.onTextQueryChange('alpha'));
    expect(visibleIds(result.current)).toEqual(['inside']);
    expect(result.current.noteExpansion.expansion).toEqual(['b', 'a']);

    act(() => result.current.filterControls.onTextQueryChange(''));
    expect(visibleIds(result.current)).toContain('a');
    expect(result.current.noteExpansion.expansion).toEqual(['b', 'a']);
  });

  it('forgets an expanded Note once the Project no longer holds it', () => {
    const { result, rerender } = renderHook(({ current }) => useCanvasViewState(current), {
      initialProps: { current: notesProject }
    });
    act(() => result.current.noteExpansion.toggleNoteFold('a'));

    rerender({ current: { ...notesProject, nodes: project.nodes } });
    expect(result.current.noteExpansion.expansion).toEqual([]);
  });
});
