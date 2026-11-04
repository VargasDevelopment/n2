import type { ProjectedNode, ProjectedRelationship, ProjectedWorkNode } from '@n2/contracts';
import { describe, expect, it } from 'vitest';
import { directRelationships } from './directRelationships.js';

const now = '2026-08-21T12:00:00.000Z';

const task = (id: string, reference: string): ProjectedWorkNode => ({
  id,
  reference,
  title: id,
  description: '',
  kind: 'task',
  requestedStatus: 'ready',
  effectiveStatus: 'ready',
  progress: 0,
  blockedBy: [],
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: now,
  updatedAt: now
});

const dependsOn = (dependentId: string, dependencyId: string): ProjectedRelationship => ({
  id: `${dependentId}-needs-${dependencyId}`,
  kind: 'depends_on',
  dependentId,
  dependencyId,
  createdAt: now,
  isBlocking: false
});

const memberOf = (memberId: string, groupId: string): ProjectedRelationship => ({
  id: `${memberId}-in-${groupId}`,
  kind: 'member_of',
  memberId,
  groupId,
  createdAt: now,
  isBlocking: false
});

const nodes: ProjectedNode[] = [
  task('subject', 'N2-1'),
  task('dependency-10', 'N2-10'),
  task('dependency-9', 'N2-9'),
  task('dependent', 'N2-3'),
  { ...task('group', 'N2-4'), kind: 'group' },
  task('member', 'N2-5'),
  task('unrelated', 'N2-6')
];

const relationships: ProjectedRelationship[] = [
  dependsOn('subject', 'dependency-10'),
  dependsOn('subject', 'dependency-9'),
  dependsOn('dependent', 'subject'),
  dependsOn('unrelated', 'dependency-9'),
  memberOf('subject', 'group'),
  memberOf('member', 'subject')
];

const ids = (entries: { node: { id: string } }[]): string[] => entries.map(({ node }) => node.id);

describe('directRelationships', () => {
  it('reads each named endpoint role from the subject and orders entries by reference', () => {
    const result = directRelationships(
      { nodes, relationships },
      'subject',
      new Set(nodes.map(({ id }) => id))
    );

    expect(ids(result.dependencies)).toEqual(['dependency-9', 'dependency-10']);
    expect(ids(result.dependents)).toEqual(['dependent']);
    // "Part of" lists the Groups the subject is a member of; its own members are listed apart.
    expect(ids(result.groups)).toEqual(['group']);
    expect(ids(result.members)).toEqual(['member']);
  });

  it("lists a Group's direct members in reference order", () => {
    const result = directRelationships(
      {
        nodes,
        relationships: [
          memberOf('dependency-10', 'group'),
          memberOf('member', 'group'),
          memberOf('subject', 'group'),
          memberOf('group', 'unrelated')
        ]
      },
      'group',
      new Set(nodes.map(({ id }) => id))
    );

    expect(ids(result.members)).toEqual(['subject', 'member', 'dependency-10']);
    expect(ids(result.groups)).toEqual(['unrelated']);
  });

  it('keeps relationships to work hidden by the current view but marks them unselectable', () => {
    const result = directRelationships(
      { nodes, relationships },
      'subject',
      new Set(['subject', 'dependency-10'])
    );

    expect(result.dependencies.map(({ node, isVisible }) => [node.id, isVisible])).toEqual([
      ['dependency-9', false],
      ['dependency-10', true]
    ]);
  });
});
