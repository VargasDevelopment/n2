import type { ProjectedNode, ProjectedRelationship } from '@n2/contracts';
import { describe, expect, it } from 'vitest';
import type { CanvasGraph } from './canvasGraph.js';
import {
  isKanbanCanvasView,
  isRoadmapCanvasView,
  isStructuredCanvasView,
  isSwimlaneCanvasView,
  resolveCanvasView,
  toggleCanvasTransformation
} from './canvasView.js';
import { SWIMLANE_LABEL_WIDTH, SWIMLANE_PADDING } from './swimlaneLayout.js';

const now = '2026-08-27T12:00:00.000Z';

const work = (
  id: string,
  kind: 'task' | 'group',
  position: { x: number; y: number },
  scheduled = false
): ProjectedNode => ({
  id,
  reference: 'N2-1',
  title: id,
  description: '',
  kind,
  requestedStatus: 'in_progress',
  effectiveStatus: 'in_progress',
  progress: 0,
  blockedBy: [],
  position,
  version: 0,
  createdAt: now,
  updatedAt: now,
  ...(scheduled
    ? {
        planningPlacement: {
          kind: 'window' as const,
          startDate: '2026-08-27' as const,
          endDate: '2026-08-28' as const
        }
      }
    : {})
});

const memberOf = (memberId: string, groupId: string): ProjectedRelationship => ({
  id: `${memberId}:${groupId}`,
  kind: 'member_of',
  memberId,
  groupId,
  createdAt: now,
  isBlocking: false
});

const scope = work('scope', 'group', { x: 0, y: 0 });
const alpha = work('alpha', 'group', { x: 0, y: 100 });
const beta = work('beta', 'group', { x: 0, y: 200 });
const shared = { ...work('shared', 'task', { x: 500, y: 300 }, true), reference: 'N2-42' };
const direct = work('direct', 'task', { x: 500, y: 400 });
const outside = work('outside', 'task', { x: 500, y: 500 });
const note: ProjectedNode = {
  id: 'note',
  reference: 'N2-9',
  title: 'Context',
  content: 'A thought',
  kind: 'note',
  position: { x: 900, y: 600 },
  version: 0,
  createdAt: now,
  updatedAt: now
};

const graph: CanvasGraph = {
  nodes: [scope, alpha, beta, shared, direct, outside, note],
  relationships: [
    memberOf(alpha.id, scope.id),
    memberOf(beta.id, scope.id),
    memberOf(shared.id, alpha.id),
    memberOf(shared.id, beta.id),
    memberOf(direct.id, scope.id)
  ]
};

const item = (view: ReturnType<typeof resolveCanvasView>, nodeId: string) => {
  const resolved = view.items.find(({ node }) => node.id === nodeId);
  if (!resolved) throw new Error(`Missing item ${nodeId}`);
  return resolved;
};

describe('Swimlane canvas compositions', () => {
  it('lays out every entity once and renders extra memberships as read-only references', () => {
    const view = resolveCanvasView(graph, new Set(['swimlane']), { swimlaneScopeId: scope.id });
    if (!isSwimlaneCanvasView(view)) throw new Error('Expected Swimlane');

    expect(view.items.map(({ node }) => node.id)).toEqual(graph.nodes.map(({ id }) => id));
    expect(new Set(view.items.map(({ node }) => node.id)).size).toBe(graph.nodes.length);
    expect(view.board.lanes.map(({ id }) => id)).toEqual([
      'scope:scope',
      'group:alpha',
      'group:beta',
      'outside:scope',
      'notes'
    ]);
    expect(view.board.references).toEqual([
      expect.objectContaining({
        laneId: 'group:beta',
        nodeId: shared.id,
        reference: 'N2-42',
        title: shared.title
      })
    ]);
    expect(item(view, shared.id).position).not.toEqual(shared.position);
    expect(item(view, shared.id).draggable).toBe(false);
  });

  it('composes status columns with membership rows without changing Kanban drop semantics', () => {
    const view = resolveCanvasView(graph, new Set(['kanban', 'swimlane']), {
      swimlaneScopeId: scope.id
    });
    if (!isKanbanCanvasView(view) || !view.swimlaneModel) {
      throw new Error('Expected Kanban + Swimlane');
    }

    const inProgressColumn = view.board.columns.find(({ id }) => id === 'in_progress');
    const alphaLane = view.board.lanes.find(({ id }) => id === 'group:alpha');
    if (!inProgressColumn || !alphaLane) throw new Error('Expected status column and Group lane');
    expect(item(view, shared.id).position.x).toBeGreaterThan(inProgressColumn.x);
    expect(item(view, shared.id).position.x).toBeLessThan(
      inProgressColumn.x + inProgressColumn.width
    );
    expect(item(view, shared.id).position.y).toBeGreaterThanOrEqual(alphaLane.y);
    expect(item(view, shared.id).position.y).toBeLessThan(alphaLane.y + alphaLane.height);
    expect(item(view, shared.id).draggable).toBe(true);
    expect(view.board.references).toContainEqual(
      expect.objectContaining({ laneId: 'group:beta', nodeId: shared.id, reference: 'N2-42' })
    );
  });

  it('adds Roadmap lane rows with a reserved label gutter and flat lower regions', () => {
    const plain = resolveCanvasView(graph, new Set(['roadmap']));
    const composed = resolveCanvasView(graph, new Set(['roadmap', 'swimlane']), {
      swimlaneScopeId: scope.id
    });
    if (!isRoadmapCanvasView(plain) || plain.swimlaneModel) throw new Error('Expected Roadmap');
    if (!isRoadmapCanvasView(composed) || !composed.swimlaneModel) {
      throw new Error('Expected Roadmap + Swimlane');
    }

    expect(item(composed, shared.id)).toMatchObject({
      renderer: 'roadmap',
      width: item(plain, shared.id).width
    });
    expect(item(composed, shared.id).position.x).toBeGreaterThan(item(plain, shared.id).position.x);
    expect(composed.board.axis?.x).toBeGreaterThanOrEqual(SWIMLANE_LABEL_WIDTH + SWIMLANE_PADDING);
    expect(item(composed, direct.id).renderer).toBe('standard');
    expect(item(composed, note.id).renderer).toBe('standard');
    const reference = composed.board.references.find(({ nodeId }) => nodeId === shared.id);
    expect(reference).toMatchObject({
      laneId: 'group:beta',
      nodeId: shared.id,
      reference: 'N2-42',
      x: item(composed, shared.id).position.x,
      width: item(plain, shared.id).width,
      placementKind: 'window'
    });
    if (reference?.presentation !== 'temporal') throw new Error('Expected temporal reference');
    expect(reference.caption).toMatchObject({ width: 320 });
  });

  it('retains Swimlanes while replacing the incompatible primary structured view', () => {
    const swimlaneKanban = new Set(['kanban', 'swimlane'] as const);
    expect([...toggleCanvasTransformation(swimlaneKanban, 'roadmap')].sort()).toEqual([
      'roadmap',
      'swimlane'
    ]);
    expect([...toggleCanvasTransformation(swimlaneKanban, 'swimlane')]).toEqual(['kanban']);
  });

  it('keeps every composition valid when filters leave no visible Group', () => {
    const filteredGraph: CanvasGraph = { nodes: [shared, outside, note], relationships: [] };

    for (const transformations of [
      new Set(['swimlane'] as const),
      new Set(['kanban', 'swimlane'] as const),
      new Set(['roadmap', 'swimlane'] as const)
    ]) {
      const view = resolveCanvasView(filteredGraph, transformations, {
        swimlaneScopeId: scope.id
      });
      if (!isStructuredCanvasView(view)) throw new Error('Expected a structured view');
      if (!view.swimlaneModel) throw new Error('Expected active Swimlanes');
      expect(view.swimlaneModel.scopeGroupId).toBeNull();
      expect(view.items.map(({ node }) => node.id)).toEqual(
        filteredGraph.nodes.map(({ id }) => id)
      );
      expect(view.board.lanes).toContainEqual(
        expect.objectContaining({ id: 'unscoped', label: 'Visible work' })
      );
    }
  });
});
