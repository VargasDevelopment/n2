import type { ProjectedNode, ProjectedRelationship } from '@n2/contracts';
import { act, renderHook } from '@testing-library/react';
import type { ReactFlowInstance, Viewport } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasGraph } from './canvasGraph.js';
import {
  isKanbanCanvasView,
  isRoadmapCanvasView,
  isSwimlaneCanvasView,
  resolveCanvasView,
  type CanvasView
} from './canvasView.js';
import type { N2CanvasEdge } from './components/N2Edge.js';
import type { N2CanvasNode } from './canvasNodes.js';
import {
  canvasMinZoom,
  canvasViewportKey,
  useCanvasModeViewport
} from './useCanvasModeViewport.js';
import type { OwnViewportWrite } from './viewportAuthorship.js';

const writeOwnViewport: OwnViewportWrite = (flow, viewport) => void flow.setViewport(viewport);

const now = '2026-08-24T12:00:00.000Z';
const node: ProjectedNode = {
  id: 'node',
  reference: 'N2-1',
  title: 'Node',
  description: '',
  kind: 'task',
  requestedStatus: 'ready',
  effectiveStatus: 'ready',
  progress: 0,
  blockedBy: [],
  position: { x: 100, y: 200 },
  version: 1,
  createdAt: now,
  updatedAt: now
};
const graph: CanvasGraph = { nodes: [node], relationships: [] };
const freeform = resolveCanvasView(graph, new Set());
const kanbanView = resolveCanvasView(graph, new Set(['kanban']));
if (!isKanbanCanvasView(kanbanView)) throw new Error('Expected Kanban');
const kanban = kanbanView;
const roadmapView = resolveCanvasView(
  {
    nodes: [
      {
        ...node,
        planningPlacement: { kind: 'milestone', date: '2026-09-10' }
      }
    ],
    relationships: []
  },
  new Set(['roadmap'])
);
if (!isRoadmapCanvasView(roadmapView)) throw new Error('Expected Roadmap');
const roadmap = roadmapView;
const wideRoadmapView = resolveCanvasView(
  {
    nodes: [
      {
        ...node,
        id: 'near',
        planningPlacement: { kind: 'milestone', date: '2026-01-01' }
      },
      {
        ...node,
        id: 'far',
        planningPlacement: { kind: 'milestone', date: '2126-01-01' }
      }
    ],
    relationships: []
  },
  new Set(['roadmap'])
);
if (!isRoadmapCanvasView(wideRoadmapView)) throw new Error('Expected Roadmap');
const wideRoadmap = wideRoadmapView;
const rootGroup: ProjectedNode = {
  ...node,
  id: 'root',
  title: 'Root',
  kind: 'group',
  position: { x: 0, y: 0 }
};
const childGroup: ProjectedNode = {
  ...rootGroup,
  id: 'child',
  title: 'Child',
  position: { x: 0, y: 100 }
};
const childMembership: ProjectedRelationship = {
  id: 'child-root',
  kind: 'member_of',
  memberId: childGroup.id,
  groupId: rootGroup.id,
  createdAt: now,
  isBlocking: false
};
const swimlaneForScope = (scopeGroupId: string) => {
  const view = resolveCanvasView(
    { nodes: [rootGroup, childGroup, node], relationships: [childMembership] },
    new Set(['swimlane']),
    { swimlaneScopeId: scopeGroupId }
  );
  if (!isSwimlaneCanvasView(view)) throw new Error('Expected Swimlane');
  return view;
};
const rootSwimlane = swimlaneForScope(rootGroup.id);
const childSwimlane = swimlaneForScope(childGroup.id);
const savedViewport: Viewport = { x: -420, y: -190, zoom: 0.72 };

const fixture = () => {
  const setViewport = vi.fn<(viewport: Viewport) => Promise<boolean>>().mockResolvedValue(true);
  const flow = {
    current: {
      getViewport: vi.fn(() => savedViewport),
      setViewport
    } as unknown as ReactFlowInstance<N2CanvasNode, N2CanvasEdge>
  };
  const canvasWrap = {
    current: {
      getBoundingClientRect: () => ({ width: 1_081 })
    } as HTMLElement
  };
  return { canvasWrap, flow, setViewport };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('useCanvasModeViewport', () => {
  it('restores the exact Freeform viewport after fitting a structured composition', async () => {
    vi.useFakeTimers();
    const { canvasWrap, flow, setViewport } = fixture();
    const { rerender } = renderHook(
      ({ view }: { view: CanvasView }) =>
        useCanvasModeViewport({ canvasWrap, flow, view, writeOwnViewport }),
      { initialProps: { view: freeform } }
    );

    rerender({ view: kanban });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    const fitted = setViewport.mock.calls.at(-1)?.[0];
    expect(fitted?.x).toBeTypeOf('number');
    expect(fitted?.y).toBe(52);
    expect(fitted?.zoom).toBeTypeOf('number');

    rerender({ view: freeform });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(setViewport).toHaveBeenLastCalledWith(savedViewport);
  });

  it('cancels a stale structured fit during a rapid round trip', async () => {
    vi.useFakeTimers();
    const { canvasWrap, flow, setViewport } = fixture();
    const { rerender } = renderHook(
      ({ view }: { view: CanvasView }) =>
        useCanvasModeViewport({ canvasWrap, flow, view, writeOwnViewport }),
      { initialProps: { view: freeform } }
    );

    rerender({ view: kanban });
    rerender({ view: freeform });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(setViewport).toHaveBeenCalledOnce();
    expect(setViewport).toHaveBeenCalledWith(savedViewport);
  });

  it('retains Freeform viewport ownership while switching between structured compositions', async () => {
    vi.useFakeTimers();
    const { canvasWrap, flow, setViewport } = fixture();
    const { rerender } = renderHook(
      ({ view }: { view: CanvasView }) =>
        useCanvasModeViewport({ canvasWrap, flow, view, writeOwnViewport }),
      { initialProps: { view: freeform } }
    );

    rerender({ view: kanban });
    await act(async () => vi.runOnlyPendingTimersAsync());
    rerender({ view: roadmap });
    await act(async () => vi.runOnlyPendingTimersAsync());
    rerender({ view: freeform });
    await act(async () => vi.runOnlyPendingTimersAsync());

    expect(setViewport).toHaveBeenCalledTimes(3);
    expect(setViewport).toHaveBeenLastCalledWith(savedViewport);
    expect(canvasViewportKey(roadmap)).not.toBe(canvasViewportKey(kanban));
  });

  it('fits a wide Roadmap below the Freeform zoom floor', async () => {
    vi.useFakeTimers();
    const { canvasWrap, flow, setViewport } = fixture();
    const { rerender } = renderHook(
      ({ view }: { view: CanvasView }) =>
        useCanvasModeViewport({ canvasWrap, flow, view, writeOwnViewport }),
      { initialProps: { view: freeform } }
    );

    rerender({ view: wideRoadmap });
    await act(async () => vi.runOnlyPendingTimersAsync());

    const fitted = setViewport.mock.calls.at(-1)?.[0];
    expect(canvasMinZoom(freeform)).toBe(0.3);
    expect(canvasMinZoom(wideRoadmap)).toBeLessThan(0.3);
    expect(fitted?.zoom).toBeCloseTo((1_081 - 64) / wideRoadmap.board.width);
    expect(fitted?.x).toBeCloseTo(32);
  });

  it('keeps a pending Kanban fit across a same-composition graph refresh', async () => {
    vi.useFakeTimers();
    const { canvasWrap, flow, setViewport } = fixture();
    const { rerender } = renderHook(
      ({ view }: { view: CanvasView }) =>
        useCanvasModeViewport({ canvasWrap, flow, view, writeOwnViewport }),
      { initialProps: { view: freeform } }
    );

    rerender({ view: kanban });
    rerender({ view: { ...kanban, graph: { ...kanban.graph } } });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(setViewport).toHaveBeenCalledOnce();
    expect(setViewport.mock.calls[0]?.[0].y).toBe(52);
  });

  it('does not reset the Kanban viewport when filtering changes only its height', async () => {
    vi.useFakeTimers();
    const { canvasWrap, flow, setViewport } = fixture();
    const { rerender } = renderHook(
      ({ view }: { view: CanvasView }) =>
        useCanvasModeViewport({ canvasWrap, flow, view, writeOwnViewport }),
      { initialProps: { view: freeform } }
    );

    rerender({ view: kanban });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    setViewport.mockClear();

    rerender({
      view: { ...kanban, board: { ...kanban.board, height: kanban.board.height + 100 } }
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(setViewport).not.toHaveBeenCalled();
  });

  it('reframes Swimlanes when scope or vertical layout extent changes', async () => {
    vi.useFakeTimers();
    const { canvasWrap, flow, setViewport } = fixture();
    const { rerender } = renderHook(
      ({ view }: { view: CanvasView }) =>
        useCanvasModeViewport({ canvasWrap, flow, view, writeOwnViewport }),
      { initialProps: { view: freeform } }
    );

    rerender({ view: rootSwimlane });
    await act(async () => vi.runOnlyPendingTimersAsync());
    rerender({ view: childSwimlane });
    await act(async () => vi.runOnlyPendingTimersAsync());
    rerender({
      view: {
        ...childSwimlane,
        board: { ...childSwimlane.board, height: childSwimlane.board.height + 100 }
      }
    });
    await act(async () => vi.runOnlyPendingTimersAsync());

    expect(setViewport).toHaveBeenCalledTimes(3);
    expect(canvasViewportKey(rootSwimlane)).not.toBe(canvasViewportKey(childSwimlane));
  });

  it('keys structured viewport ownership by composition and resolved bounds', () => {
    const widerKanban = {
      ...kanban,
      board: {
        ...kanban.board,
        width: kanban.board.width + 100
      }
    };

    expect(canvasViewportKey(freeform)).toBe('freeform');
    expect(canvasViewportKey(widerKanban)).not.toBe(canvasViewportKey(kanban));
  });
});
