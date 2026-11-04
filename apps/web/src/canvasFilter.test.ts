import type { ProjectedNode, ProjectedProject, ProjectedRelationship } from '@n2/contracts';
import { NODE_STATUSES, type NodeStatus } from '@n2/contracts';
import { describe, expect, it } from 'vitest';
import { filterCanvas, filterCanvasForRoadmapRange } from './canvasFilter.js';
import { createRoadmapRange } from './roadmapRange.js';

const now = '2026-08-21T12:00:00.000Z';

const workNode = (
  id: string,
  effectiveStatus: NodeStatus
): Extract<ProjectedNode, { kind: 'task' }> => ({
  id,
  reference: 'N2-1',
  title: id,
  description: '',
  kind: 'task',
  requestedStatus: effectiveStatus,
  effectiveStatus,
  progress: effectiveStatus === 'done' ? 1 : 0,
  blockedBy: [],
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: now,
  updatedAt: now
});

const requestedReadyButEffectivelyBlocked: ProjectedNode = {
  ...workNode('effectively-blocked', 'blocked'),
  requestedStatus: 'ready'
};

const note: ProjectedNode = {
  id: 'note',
  reference: 'N2-3',
  title: 'Context',
  content: 'Keep visible',
  kind: 'note',
  position: { x: 50, y: 50 },
  version: 0,
  createdAt: now,
  updatedAt: now
};

const relationship = (
  id: string,
  dependentId: string,
  dependencyId: string
): ProjectedRelationship => ({
  id,
  kind: 'depends_on',
  dependentId,
  dependencyId,
  isBlocking: false,
  createdAt: now
});

const project: ProjectedProject = {
  id: 'project',
  name: 'N²',
  referenceKey: 'N2',
  nodes: [workNode('ready', 'ready'), workNode('done', 'done'), note],
  relationships: [relationship('ready-to-done', 'ready', 'done')],
  warnings: [],
  latestSequence: 0
};

const filters = (hiddenStatuses = new Set<NodeStatus>(), textQuery = '') => ({
  hiddenStatuses,
  textQuery
});

describe('canvas filtering', () => {
  it('preserves the complete projected graph when no filters are active', () => {
    const graph = filterCanvas(project, filters());

    expect(graph.nodes).toBe(project.nodes);
    expect(graph.relationships).toBe(project.relationships);
    expect(graph).not.toHaveProperty('warnings');
  });

  it('hides matching Work Nodes and every relationship with a hidden endpoint', () => {
    const filtered = filterCanvas(project, filters(new Set<NodeStatus>(['done'])));

    expect(filtered.nodes.map(({ id }) => id)).toEqual(['ready', 'note']);
    expect(filtered.relationships).toEqual([]);
  });

  it('keeps Notes visible even when every work status is hidden', () => {
    const filtered = filterCanvas(project, filters(new Set(NODE_STATUSES)));

    expect(filtered.nodes).toEqual([note]);
    expect(filtered.nodes[0]?.position).toEqual({ x: 50, y: 50 });
    expect(project.nodes).toHaveLength(3);
  });

  it('filters Work Nodes by effective status rather than requested status', () => {
    const filtered = filterCanvas(
      { ...project, nodes: [...project.nodes, requestedReadyButEffectivelyBlocked] },
      filters(new Set<NodeStatus>(['blocked']))
    );

    expect(filtered.nodes.map(({ id }) => id)).not.toContain('effectively-blocked');
  });

  it('matches Task, Group, and Note titles with a trimmed case-insensitive query', () => {
    const group: ProjectedNode = {
      ...workNode('group', 'ready'),
      kind: 'group',
      title: 'SEARCH planning'
    };
    const searchableProject = {
      ...project,
      nodes: [
        { ...project.nodes[0]!, title: 'Make Search Boring' },
        group,
        { ...note, title: 'SEARCH decisions' }
      ]
    };

    const filtered = filterCanvas(searchableProject, filters(new Set(), '  search  '));

    expect(filtered.nodes.map(({ id }) => id)).toEqual(['ready', 'group', 'note']);
  });

  it('matches titles or references but not descriptions and removes hidden relationships', () => {
    const searchableProject = {
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === 'ready'
          ? { ...node, title: 'Visible task', description: 'needle in description' }
          : node.id === 'done'
            ? { ...node, title: 'Needle task' }
            : { ...node, title: 'Context', content: 'needle in note content' }
      )
    };

    const filtered = filterCanvas(searchableProject, filters(new Set(), 'needle'));

    expect(filtered.nodes.map(({ id }) => id)).toEqual(['done']);
    expect(filtered.relationships).toEqual([]);

    const byReference = filterCanvas(
      {
        ...searchableProject,
        nodes: searchableProject.nodes.map((node) =>
          node.id === 'ready' ? { ...node, reference: 'N2-42' } : node
        )
      },
      filters(new Set(), 'n2-42')
    );
    expect(byReference.nodes.map(({ id }) => id)).toEqual(['ready']);
  });

  it('composes text search with effective-status filtering', () => {
    const searchableProject = {
      ...project,
      nodes: project.nodes.map((node) => ({ ...node, title: `${node.title} match` }))
    };

    const filtered = filterCanvas(
      searchableProject,
      filters(new Set<NodeStatus>(['done']), 'match')
    );

    expect(filtered.nodes.map(({ id }) => id)).toEqual(['ready', 'note']);
  });

  it('composes a Roadmap range with other filters while retaining unscheduled work and Notes', () => {
    const before = {
      ...workNode('before', 'ready'),
      planningPlacement: { kind: 'milestone' as const, date: '2026-08-20' }
    };
    const overlapping = {
      ...workNode('overlapping', 'ready'),
      planningPlacement: {
        kind: 'window' as const,
        startDate: '2026-08-21',
        endDate: '2026-08-24'
      }
    };
    const hiddenDone = {
      ...workNode('hidden-done', 'done'),
      planningPlacement: { kind: 'milestone' as const, date: '2026-08-23' }
    };
    const rangedProject = {
      ...project,
      nodes: [before, overlapping, hiddenDone, project.nodes[0]!, note],
      relationships: [relationship('before-to-overlapping', 'before', 'overlapping')]
    };

    const statusFiltered = filterCanvas(rangedProject, {
      hiddenStatuses: new Set<NodeStatus>(['done']),
      textQuery: ''
    });
    const filtered = filterCanvasForRoadmapRange(
      statusFiltered,
      createRoadmapRange('2026-08-22', '2026-08-30')
    );

    expect(filtered.nodes.map(({ id }) => id)).toEqual(['overlapping', 'ready', 'note']);
    expect(filtered.relationships).toEqual([]);
  });
});
