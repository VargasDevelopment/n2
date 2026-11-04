import type { ProjectedNode } from '@n2/contracts';
import { describe, expect, it } from 'vitest';
import type { CanvasGraph } from './canvasGraph.js';
import type { RoadmapResolvedCanvasItem } from './resolvedCanvasItem.js';
import { createRoadmapRange } from './roadmapRange.js';
import {
  canvasCompositionKey,
  canvasTransformations,
  isKanbanCanvasView,
  isRoadmapCanvasView,
  KANBAN_CARD_GAP,
  KANBAN_NOTE_HEIGHT,
  kanbanStatusAtX,
  resolveCanvasView,
  toggleCanvasTransformation,
  toggleTransformationInSet,
  type CanvasView,
  type KanbanCanvasView,
  type RoadmapCanvasView
} from './canvasView.js';

const assertPlainKanban: (view: CanvasView) => asserts view is KanbanCanvasView = (view) => {
  if (!isKanbanCanvasView(view) || view.swimlaneModel) throw new Error('Expected plain Kanban');
};

const assertPlainRoadmap: (view: CanvasView) => asserts view is RoadmapCanvasView = (view) => {
  if (!isRoadmapCanvasView(view) || view.swimlaneModel) throw new Error('Expected plain Roadmap');
};

const now = '2026-08-24T12:00:00.000Z';
const task = (
  id: string,
  effectiveStatus: 'ready' | 'in_progress' | 'blocked' | 'done',
  x: number,
  y: number
): ProjectedNode => ({
  id,
  reference: 'N2-1',
  title: id,
  description: '',
  kind: 'task',
  requestedStatus: effectiveStatus,
  effectiveStatus,
  progress: effectiveStatus === 'done' ? 1 : 0,
  blockedBy: [],
  position: { x, y },
  version: 1,
  createdAt: now,
  updatedAt: now
});
const note: ProjectedNode = {
  id: 'note',
  reference: 'N2-9',
  title: 'Note',
  content: 'A durable thought',
  kind: 'note',
  position: { x: 900, y: 400 },
  version: 1,
  createdAt: now,
  updatedAt: now
};
const graph: CanvasGraph = {
  nodes: [
    task('later', 'ready', 10, 500),
    task('first', 'ready', 500, 10),
    task('done', 'done', 80, 80),
    note
  ],
  relationships: []
};

const itemPosition = (view: ReturnType<typeof resolveCanvasView>, nodeId: string) => {
  const item = view.items.find(({ node }) => node.id === nodeId);
  if (!item) throw new Error(`Missing resolved item ${nodeId}`);
  return item.position;
};

const itemById = (view: ReturnType<typeof resolveCanvasView>, nodeId: string) => {
  const item = view.items.find(({ node }) => node.id === nodeId);
  if (!item) throw new Error(`Missing resolved item ${nodeId}`);
  return item;
};

const roadmapItemById = (
  view: ReturnType<typeof resolveCanvasView>,
  nodeId: string
): RoadmapResolvedCanvasItem => {
  const item = itemById(view, nodeId);
  if (item.renderer !== 'roadmap') throw new Error(`Expected Roadmap item ${nodeId}`);
  return item;
};

describe('canvas view resolution', () => {
  it('preserves authoritative positions exactly in Freeform', () => {
    const view = resolveCanvasView(graph, new Set());
    expect(view.layout).toBe('freeform');
    expect(canvasTransformations(view)).toEqual([]);
    expect(view.capabilities).toEqual({
      nodeCreation: true,
      authoritativePositionWrites: true,
      statusColumnDrops: false,
      multiSelection: true
    });
    expect(itemPosition(view, 'later')).toEqual({ x: 10, y: 500 });
    expect(itemPosition(view, 'note')).toEqual({ x: 900, y: 400 });
    expect(view.items.every(({ draggable, focusable }) => draggable && focusable)).toBe(true);
  });

  it('derives a deterministic status board without mutating graph positions', () => {
    const view = resolveCanvasView(graph, new Set(['kanban']));
    expect(canvasCompositionKey(view)).toBe('kanban');
    assertPlainKanban(view);
    expect(view.items).toHaveLength(graph.nodes.length);
    expect(canvasTransformations(view)).toEqual(['kanban']);
    expect(view.capabilities).toEqual({
      nodeCreation: false,
      authoritativePositionWrites: false,
      statusColumnDrops: true,
      multiSelection: false
    });
    expect(itemPosition(view, 'first').y).toBeLessThan(itemPosition(view, 'later').y);
    expect(itemPosition(view, 'done').x).toBeGreaterThan(itemPosition(view, 'later').x);
    expect(itemPosition(view, 'note').x).toBeGreaterThan(itemPosition(view, 'done').x);
    expect(graph.nodes[0]!.position).toEqual({ x: 10, y: 500 });
    expect(view.board.columns.map(({ id, count }) => [id, count])).toEqual([
      ['ready', 2],
      ['in_progress', 0],
      ['blocked', 0],
      ['done', 1],
      ['notes', 1]
    ]);
  });

  it('maps a drop to status columns but not gaps or the Notes region', () => {
    const view = resolveCanvasView(graph, new Set(['kanban']));
    assertPlainKanban(view);
    expect(kanbanStatusAtX(100, view.board)).toBe('ready');
    expect(kanbanStatusAtX(280, view.board)).toBeNull();
    expect(kanbanStatusAtX(320, view.board)).toBe('in_progress');
    expect(kanbanStatusAtX(1_200, view.board)).toBeNull();
  });

  it('gives rich Notes a fixed folded footprint so their derived positions cannot overlap', () => {
    const headings = Array.from({ length: 12 }, (_, index) => `# Heading ${index}`).join('\n');
    const first = {
      ...note,
      id: 'rich-first',
      title: 'A deliberately long folded Note title '.repeat(7).slice(0, 240),
      content: headings,
      position: { x: 0, y: 0 }
    };
    const second = { ...note, id: 'rich-second', content: headings, position: { x: 0, y: 1 } };
    const view = resolveCanvasView(
      { nodes: [first, second], relationships: [] },
      new Set(['kanban'])
    );
    assertPlainKanban(view);

    expect(itemPosition(view, second.id).y - itemPosition(view, first.id).y).toBe(
      KANBAN_NOTE_HEIGHT + KANBAN_CARD_GAP
    );
    const resolvedFirst = view.items.find(({ node: item }) => item.id === first.id);
    expect(resolvedFirst?.height).toBe(KANBAN_NOTE_HEIGHT);
    expect(resolvedFirst?.draggable).toBe(false);
    expect(resolvedFirst?.focusable).toBe(false);
    expect(resolvedFirst?.className).toBe('n2-canvas-note--folded');
  });

  it('places scheduled work on a calendar while retaining explicit unscheduled and Notes regions', () => {
    const sameDayWindow = {
      ...task('window', 'in_progress', 900, 600),
      planningPlacement: {
        kind: 'window' as const,
        startDate: '2026-09-10',
        endDate: '2026-09-10'
      }
    };
    const milestone = {
      ...task('milestone', 'ready', 50, 40),
      planningPlacement: { kind: 'milestone' as const, date: '2026-09-15' }
    };
    const unscheduled = task('unscheduled', 'ready', 400, 300);
    const roadmapGraph = {
      nodes: [unscheduled, milestone, note, sameDayWindow],
      relationships: []
    };

    const view = resolveCanvasView(roadmapGraph, new Set(['roadmap']));
    expect(canvasCompositionKey(view)).toBe('roadmap');
    assertPlainRoadmap(view);

    expect(view.capabilities).toEqual({
      nodeCreation: false,
      authoritativePositionWrites: false,
      statusColumnDrops: false,
      multiSelection: false
    });
    expect(view.board.regions.map(({ id, count }) => [id, count])).toEqual([
      ['scheduled', 2],
      ['unscheduled', 1],
      ['notes', 1]
    ]);
    expect(view.board.axis).toMatchObject({
      startDate: '2026-09-07',
      endDate: '2026-09-18'
    });
    expect(roadmapItemById(view, 'window')).toMatchObject({
      renderer: 'roadmap',
      width: 64,
      presentation: {
        placementLabel: 'Sep 10 – Sep 10, 2026'
      }
    });
    const axis = view.board.axis;
    if (!axis) throw new Error('Expected Roadmap axis');
    const startBoundary = axis.ticks.find(({ date }) => date === '2026-09-10')?.x;
    const endBoundary = axis.ticks.find(({ date }) => date === '2026-09-11')?.x;
    expect(itemPosition(view, 'window').x).toBe(startBoundary);
    expect(itemPosition(view, 'window').x + itemById(view, 'window').width).toBe(endBoundary);
    expect(roadmapItemById(view, 'milestone')).toMatchObject({
      renderer: 'roadmap',
      width: 16,
      presentation: {
        placementLabel: 'Milestone Sep 15, 2026'
      }
    });
    expect(itemPosition(view, 'window')).not.toEqual(sameDayWindow.position);
    expect(itemPosition(view, 'unscheduled')).not.toEqual(unscheduled.position);
    expect(view.items.every(({ draggable, focusable }) => !draggable && !focusable)).toBe(true);
    expect(roadmapGraph.nodes.map(({ position }) => position)).toEqual([
      unscheduled.position,
      milestone.position,
      note.position,
      sameDayWindow.position
    ]);
  });

  it('renders empty Roadmap regions deterministically without inventing calendar dates', () => {
    const view = resolveCanvasView({ nodes: [note], relationships: [] }, new Set(['roadmap']));
    assertPlainRoadmap(view);

    expect(view.board.axis).toBeNull();
    expect(view.items.every(({ renderer }) => renderer === 'standard')).toBe(true);
    expect(view.board.regions.map(({ id, count }) => [id, count])).toEqual([
      ['scheduled', 0],
      ['unscheduled', 0],
      ['notes', 1]
    ]);
  });

  it('bounds Roadmap furniture for distant placements instead of producing an enormous canvas', () => {
    const distant = {
      ...task('distant', 'ready', 0, 0),
      planningPlacement: { kind: 'milestone' as const, date: '2126-01-01' }
    };
    const sameDay = {
      ...task('same-day', 'ready', 0, 0),
      planningPlacement: {
        kind: 'window' as const,
        startDate: '2026-01-01',
        endDate: '2026-01-01'
      }
    };
    const view = resolveCanvasView(
      { nodes: [sameDay, distant], relationships: [] },
      new Set(['roadmap'])
    );
    assertPlainRoadmap(view);

    expect(view.board.width).toBeLessThan(5_200);
    expect(view.board.axis?.ticks.length).toBeLessThan(100);
    const axis = view.board.axis;
    if (!axis) throw new Error('Expected Roadmap axis');
    const renderedPlacement = itemById(view, sameDay.id);
    expect(renderedPlacement.width).toBe(axis.dayWidth);
    const expectedTemporalCenter =
      axis.x +
      ((Date.parse('2026-01-01T00:00:00.000Z') - Date.parse(`${axis.startDate}T00:00:00.000Z`)) /
        86_400_000) *
        axis.dayWidth +
      axis.dayWidth / 2;
    expect(renderedPlacement.position.x + renderedPlacement.width / 2).toBe(expectedTemporalCenter);
  });

  it('omits a cadence-breaking endpoint label while retaining the exact axis boundary', () => {
    const mediumWindow = {
      ...task('medium-window', 'ready', 0, 0),
      planningPlacement: {
        kind: 'window' as const,
        startDate: '2026-01-01',
        endDate: '2026-02-28'
      }
    };
    const view = resolveCanvasView(
      { nodes: [mediumWindow], relationships: [] },
      new Set(['roadmap'])
    );
    assertPlainRoadmap(view);
    const axis = view.board.axis;
    if (!axis) throw new Error('Expected Roadmap axis');

    expect(axis.endDate).toBe('2026-03-03');
    expect(axis.ticks.at(-1)?.date).toBe('2026-03-02');
    expect(axis.ticks.some(({ date }) => date === axis.endDate)).toBe(false);
  });

  it('labels both endpoints of a cross-year Planning Window unambiguously', () => {
    const crossYear = {
      ...task('cross-year', 'ready', 0, 0),
      planningPlacement: {
        kind: 'window' as const,
        startDate: '2026-12-30',
        endDate: '2027-01-03'
      }
    };
    const view = resolveCanvasView({ nodes: [crossYear], relationships: [] }, new Set(['roadmap']));
    assertPlainRoadmap(view);

    expect(roadmapItemById(view, crossYear.id).presentation.placementLabel).toBe(
      'Dec 30, 2026 – Jan 3, 2027'
    );
  });

  it('preserves literal four-digit years below 0100 on the Roadmap calendar', () => {
    const ancientMilestone = {
      ...task('ancient', 'ready', 0, 0),
      planningPlacement: { kind: 'milestone' as const, date: '0099-05-10' }
    };
    const view = resolveCanvasView(
      { nodes: [ancientMilestone], relationships: [] },
      new Set(['roadmap'])
    );
    assertPlainRoadmap(view);

    expect(view.board.axis).toMatchObject({
      startDate: '0099-05-07',
      endDate: '0099-05-13'
    });
    expect(roadmapItemById(view, ancientMilestone.id).presentation.placementLabel).toBe(
      'Milestone May 10, 0099'
    );
  });

  it('clamps calendar padding to the Planning Date year bounds', () => {
    const lowerBound = {
      ...task('lower-bound', 'ready', 0, 0),
      planningPlacement: { kind: 'milestone' as const, date: '0000-01-01' }
    };
    const upperBound = {
      ...task('upper-bound', 'ready', 0, 0),
      planningPlacement: { kind: 'milestone' as const, date: '9999-12-31' }
    };
    const view = resolveCanvasView(
      { nodes: [lowerBound, upperBound], relationships: [] },
      new Set(['roadmap'])
    );
    assertPlainRoadmap(view);

    expect(view.board.axis).toMatchObject({
      startDate: '0000-01-01',
      endDate: '9999-12-31'
    });
    expect(view.items).toHaveLength(2);
    expect(
      view.items.map((item) => roadmapItemById(view, item.node.id).presentation.placementLabel)
    ).toEqual(['Milestone Jan 1, 0000', 'Milestone Dec 31, 9999']);
  });

  it('uses an explicit Roadmap range and clips overlapping windows without changing their label', () => {
    const spanning = {
      ...task('spanning', 'ready', 0, 0),
      planningPlacement: {
        kind: 'window' as const,
        startDate: '2026-08-20',
        endDate: '2026-09-02'
      }
    };
    const view = resolveCanvasView({ nodes: [spanning], relationships: [] }, new Set(['roadmap']), {
      roadmapRange: createRoadmapRange('2026-08-22', '2026-08-30')
    });
    assertPlainRoadmap(view);

    expect(view.board.axis).toMatchObject({
      startDate: '2026-08-22',
      endDate: '2026-08-30'
    });
    expect(roadmapItemById(view, spanning.id)).toMatchObject({
      position: { x: view.board.axis?.x },
      width: view.board.axis?.width,
      presentation: {
        placementLabel: 'Aug 20 – Sep 2, 2026',
        clippedAtStart: true,
        clippedAtEnd: true
      }
    });
    expect(spanning.planningPlacement).toEqual({
      kind: 'window',
      startDate: '2026-08-20',
      endDate: '2026-09-02'
    });
  });

  it('renders an explicit empty calendar range without inventing scheduled work', () => {
    const view = resolveCanvasView({ nodes: [note], relationships: [] }, new Set(['roadmap']), {
      roadmapRange: createRoadmapRange('2026-08-22', '2026-08-30')
    });
    assertPlainRoadmap(view);

    expect(view.board.axis).toMatchObject({
      startDate: '2026-08-22',
      endDate: '2026-08-30'
    });
    expect(view.board.regions[0]).toMatchObject({ id: 'scheduled', count: 0 });
  });

  it('rejects Kanban with Roadmap and replaces only their explicit incompatibility in UI state', () => {
    expect(() => resolveCanvasView(graph, new Set(['kanban', 'roadmap']))).toThrow(
      'Unsupported canvas transformation set: kanban, roadmap'
    );
    expect([...toggleCanvasTransformation(new Set(['kanban']), 'roadmap')]).toEqual(['roadmap']);
    expect([...toggleCanvasTransformation(new Set(['roadmap']), 'kanban')]).toEqual(['kanban']);
    expect([...toggleCanvasTransformation(new Set(['roadmap']), 'roadmap')]).toEqual([]);
  });

  it('preserves compatible transformations and removes every declared conflict', () => {
    type Transformation = 'focus' | 'kanban' | 'roadmap' | 'swimlane';
    const conflicts = [
      ['kanban', 'roadmap'],
      ['focus', 'roadmap']
    ] as const satisfies readonly (readonly [Transformation, Transformation])[];

    expect(
      [
        ...toggleTransformationInSet<Transformation>(
          new Set(['kanban', 'focus', 'swimlane']),
          'roadmap',
          conflicts
        )
      ].sort()
    ).toEqual(['roadmap', 'swimlane']);
    expect(
      [
        ...toggleTransformationInSet<Transformation>(new Set(['focus']), 'swimlane', conflicts)
      ].sort()
    ).toEqual(['focus', 'swimlane']);
    expect([
      ...toggleTransformationInSet<Transformation>(new Set(['roadmap']), 'focus', conflicts)
    ]).toEqual(['focus']);
  });
});
