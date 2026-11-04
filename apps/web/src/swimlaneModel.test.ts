import type { ProjectedNode, ProjectedRelationship } from '@n2/contracts';
import { describe, expect, it } from 'vitest';
import type { CanvasGraph } from './canvasGraph.js';
import { defaultLaneScopeId, resolveLaneScopeId, resolveSwimlaneModel } from './swimlaneModel.js';

const now = '2026-08-27T12:00:00.000Z';
const work = (id: string, kind: 'task' | 'group', x = 0, y = 0): ProjectedNode => ({
  id,
  reference: 'N2-1',
  title: id,
  description: '',
  kind,
  requestedStatus: 'ready',
  effectiveStatus: 'ready',
  progress: 0,
  blockedBy: [],
  position: { x, y },
  version: 0,
  createdAt: now,
  updatedAt: now
});
const note: ProjectedNode = {
  id: 'note',
  reference: 'N2-9',
  title: 'Context',
  content: '',
  kind: 'note',
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: now,
  updatedAt: now
};
const memberOf = (memberId: string, groupId: string): ProjectedRelationship => ({
  id: `${memberId}-${groupId}`,
  kind: 'member_of',
  memberId,
  groupId,
  createdAt: now,
  isBlocking: false
});

const graph: CanvasGraph = {
  nodes: [
    work('outside', 'task'),
    work('scope', 'group'),
    work('later-lane', 'group', 0, 200),
    work('first-lane', 'group', 0, 100),
    work('nested', 'group'),
    work('shared', 'task'),
    work('direct', 'task'),
    note
  ],
  relationships: [
    memberOf('later-lane', 'scope'),
    memberOf('first-lane', 'scope'),
    memberOf('nested', 'first-lane'),
    memberOf('shared', 'nested'),
    memberOf('shared', 'later-lane'),
    memberOf('direct', 'scope')
  ]
};

describe('Swimlane model', () => {
  it('selects a visible root Group by authoritative position and falls back from stale scope', () => {
    expect(defaultLaneScopeId(graph)).toBe('scope');
    expect(resolveLaneScopeId(graph, 'later-lane')).toBe('later-lane');
    expect(resolveLaneScopeId(graph, 'missing')).toBe('scope');
  });

  it('derives ordered direct-Group lanes and assigns nested multi-membership by reachability', () => {
    const model = resolveSwimlaneModel(graph, 'scope');

    expect(model.lanes.map(({ id, count }) => [id, count])).toEqual([
      ['scope:scope', 4],
      ['group:first-lane', 2],
      ['group:later-lane', 1],
      ['outside:scope', 1],
      ['notes', 1]
    ]);
    const lane = (id: string) => model.lanes.find((candidate) => candidate.id === id);
    expect(lane('group:first-lane')?.primaryNodeIds).toContain('shared');
    expect(lane('group:later-lane')?.referenceNodeIds).toEqual(['shared']);
    expect(lane('scope:scope')?.primaryNodeIds).toEqual(
      expect.arrayContaining(['direct', 'first-lane'])
    );
    expect(lane('outside:scope')?.primaryNodeIds).toEqual(['outside']);
    expect(lane('notes')?.primaryNodeIds).toEqual(['note']);
  });

  it('rejects a hidden or non-Group Lane Scope instead of consulting another graph', () => {
    expect(() => resolveSwimlaneModel(graph, 'missing')).toThrow(
      'Swimlane scope must be a visible Group: missing'
    );
    expect(() => resolveSwimlaneModel(graph, 'shared')).toThrow(
      'Swimlane scope must be a visible Group: shared'
    );
  });

  it('keeps filtered work usable when no Group remains visible', () => {
    const filteredGraph: CanvasGraph = {
      nodes: [work('visible', 'task'), note],
      relationships: []
    };

    expect(resolveSwimlaneModel(filteredGraph, null)).toEqual({
      scopeGroupId: null,
      lanes: [
        {
          id: 'unscoped',
          kind: 'unscoped',
          label: 'Visible work',
          count: 1,
          primaryNodeIds: ['visible'],
          referenceNodeIds: []
        },
        {
          id: 'notes',
          kind: 'notes',
          label: 'Notes',
          count: 1,
          primaryNodeIds: ['note'],
          referenceNodeIds: []
        }
      ]
    });
  });
});
