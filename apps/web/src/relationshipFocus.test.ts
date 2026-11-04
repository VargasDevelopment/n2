import type { ProjectedRelationship } from '@n2/contracts';
import { describe, expect, it } from 'vitest';
import { indexConnectionHighlights } from './connectionHighlight.js';
import { relationshipFocus } from './relationshipFocus.js';

const now = '2026-08-21T12:00:00.000Z';
const partOf = (memberId: string, groupId: string): ProjectedRelationship => ({
  id: `${memberId}-in-${groupId}`,
  kind: 'member_of',
  memberId,
  groupId,
  createdAt: now,
  isBlocking: false
});
const dependsOn = (dependentId: string, dependencyId: string): ProjectedRelationship => ({
  id: `${dependentId}-needs-${dependencyId}`,
  kind: 'depends_on',
  dependentId,
  dependencyId,
  createdAt: now,
  isBlocking: false
});

// task is part of feature, which is part of epic; task depends on other, in another Group.
const relationships = [
  partOf('task', 'feature'),
  partOf('feature', 'epic'),
  partOf('other', 'elsewhere'),
  dependsOn('task', 'other')
];
const highlights = indexConnectionHighlights(relationships);

describe('relationshipFocus', () => {
  it('reveals what the hover highlight would, and keeps it for the selection', () => {
    const focus = relationshipFocus({ nodeIds: ['task'], relationshipIds: [] }, highlights);

    expect([...focus.relationshipIds].sort()).toEqual(
      ['feature-in-epic', 'task-in-feature', 'task-needs-other'].sort()
    );
  });

  it('lights the Groups the selection is part of, transitively, but not its dependencies’', () => {
    const focus = relationshipFocus({ nodeIds: ['task'], relationshipIds: [] }, highlights);

    expect([...focus.groupIds].sort()).toEqual(['epic', 'feature', 'task']);
  });

  it('reveals a selected relationship on its own', () => {
    const focus = relationshipFocus(
      { nodeIds: [], relationshipIds: ['task-needs-other'] },
      highlights
    );

    expect([...focus.relationshipIds]).toEqual(['task-needs-other']);
    expect(focus.groupIds.size).toBe(0);
  });
});
