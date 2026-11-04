import type { ProjectedRelationship } from '@n2/contracts';
import { describe, expect, it } from 'vitest';
import { indexConnectionHighlights } from './connectionHighlight.js';

const now = '2026-08-21T12:00:00.000Z';

const relationships: ProjectedRelationship[] = [
  {
    id: 'a-depends-b',
    kind: 'depends_on',
    dependentId: 'a',
    dependencyId: 'b',
    createdAt: now,
    isBlocking: false
  },
  {
    id: 'a-member-c',
    kind: 'member_of',
    memberId: 'a',
    groupId: 'c',
    createdAt: now,
    isBlocking: false
  },
  {
    id: 'a-member-b',
    kind: 'member_of',
    memberId: 'a',
    groupId: 'b',
    createdAt: now,
    isBlocking: false
  },
  {
    id: 'b-depends-d',
    kind: 'depends_on',
    dependentId: 'b',
    dependencyId: 'd',
    createdAt: now,
    isBlocking: false
  },
  {
    id: 'c-member-root',
    kind: 'member_of',
    memberId: 'c',
    groupId: 'root',
    createdAt: now,
    isBlocking: false
  }
];

describe('connection highlighting', () => {
  it('indexes direct neighbors and every incident relationship without traversing onward', () => {
    const index = indexConnectionHighlights(relationships);
    const highlight = index.get('a');

    expect([...highlight.connectedNodeIds].sort()).toEqual(['b', 'c', 'root']);
    expect([...highlight.relationshipIds].sort()).toEqual([
      'a-depends-b',
      'a-member-b',
      'a-member-c',
      'c-member-root'
    ]);
    expect(highlight.connectedNodeIds.has('d')).toBe(false);
    expect(highlight.relationshipIds.has('b-depends-d')).toBe(false);
  });

  it('continues membership upward for context without traversing dependency chains', () => {
    const highlight = indexConnectionHighlights(relationships).get('a');

    expect(highlight.connectedNodeIds.has('root')).toBe(true);
    expect(highlight.relationshipIds.has('c-member-root')).toBe(true);
    expect([...highlight.ancestorGroupIds].sort()).toEqual(['b', 'c', 'root']);
    expect(highlight.connectedNodeIds.has('d')).toBe(false);
    expect(highlight.relationshipIds.has('b-depends-d')).toBe(false);
  });

  it('keeps membership descendants beyond the direct child out of a group network', () => {
    const highlight = indexConnectionHighlights(relationships).get('root');

    expect(highlight.connectedNodeIds.has('c')).toBe(true);
    expect(highlight.relationshipIds.has('c-member-root')).toBe(true);
    expect(highlight.connectedNodeIds.has('a')).toBe(false);
    expect(highlight.relationshipIds.has('a-member-c')).toBe(false);
  });

  it('treats relationship direction symmetrically for visual connection lookup', () => {
    const index = indexConnectionHighlights(relationships);

    expect([...index.get('b').connectedNodeIds].sort()).toEqual(['a', 'd']);
    expect([...index.get('b').relationshipIds].sort()).toEqual([
      'a-depends-b',
      'a-member-b',
      'b-depends-d'
    ]);
  });
});
