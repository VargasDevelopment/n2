import type {
  GraphRelationship,
  Note,
  NodeStatus,
  Project,
  WorkNode,
  WorkNodeKind
} from '@n2/contracts';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeProjectRelationships,
  completedGroupIds,
  explainNode,
  projectGraph,
  validateRelationship,
  wouldCreateCycle
} from '../src/index.js';

const now = '2026-08-21T12:00:00.000Z';

const node = (
  id: string,
  requestedStatus: NodeStatus = 'ready',
  kind: WorkNodeKind = 'task'
): WorkNode => ({
  id,
  reference: `N2-${id}`,
  title: id,
  description: '',
  kind,
  requestedStatus,
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: now,
  updatedAt: now
});

const note = (id: string, content = ''): Note => ({
  id,
  reference: `N2-${id}`,
  title: id,
  content,
  kind: 'note',
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: now,
  updatedAt: now
});

const memberOf = (id: string, memberId: string, groupId: string): GraphRelationship => ({
  id,
  kind: 'member_of',
  memberId,
  groupId,
  createdAt: now
});

const dependsOn = (id: string, dependentId: string, dependencyId: string): GraphRelationship => ({
  id,
  kind: 'depends_on',
  dependentId,
  dependencyId,
  createdAt: now
});

const project = (nodes: Project['nodes'], relationships: GraphRelationship[]): Project => ({
  id: 'project',
  name: 'N2',
  referenceKey: 'N2',
  nodes,
  relationships
});

describe('projectGraph', () => {
  it('bubbles member progress and completion into a group', () => {
    const result = projectGraph(
      project(
        [node('group', 'ready', 'group'), node('done', 'done'), node('open')],
        [memberOf('a', 'done', 'group'), memberOf('b', 'open', 'group')]
      )
    );

    expect(result.nodes.find(({ id }) => id === 'group')).toMatchObject({
      effectiveStatus: 'in_progress',
      progress: 0.5
    });
  });

  it('marks a group done only when every member is done', () => {
    const result = projectGraph(
      project(
        [node('group', 'ready', 'group'), node('one', 'done'), node('two', 'done')],
        [memberOf('a', 'one', 'group'), memberOf('b', 'two', 'group')]
      )
    );

    expect(result.nodes.find(({ id }) => id === 'group')).toMatchObject({
      effectiveStatus: 'done',
      progress: 1
    });
    expect(explainNode(result, 'group')).toMatchObject({
      status: { effective: 'done', basis: 'all_members_done', blockers: [] },
      progress: {
        value: 1,
        basis: 'member_average',
        members: [
          { node: { id: 'one' }, contribution: 1 },
          { node: { id: 'two' }, contribution: 1 }
        ]
      }
    });
  });

  it('explains when incomplete members override a requested group completion', () => {
    const result = projectGraph(
      project(
        [node('group', 'done', 'group'), node('member', 'ready')],
        [memberOf('membership', 'member', 'group')]
      )
    );

    expect(explainNode(result, 'group')).toMatchObject({
      node: { effectiveStatus: 'ready' },
      status: { requested: 'done', effective: 'ready', basis: 'member_statuses' }
    });
  });

  it('does not confuse unfinished dependencies with blockers', () => {
    const result = projectGraph(
      project(
        [node('dependency', 'in_progress'), node('dependent', 'in_progress')],
        [dependsOn('dependency', 'dependent', 'dependency')]
      )
    );

    expect(result.nodes.find(({ id }) => id === 'dependent')).toMatchObject({
      effectiveStatus: 'in_progress',
      blockedBy: []
    });
    expect(result.relationships[0]).toMatchObject({ isBlocking: false });
  });

  it('propagates a blocked dependency into its dependent and marks the relationship', () => {
    const result = projectGraph(
      project(
        [node('dependency', 'blocked'), node('dependent', 'in_progress')],
        [dependsOn('dependency', 'dependent', 'dependency')]
      )
    );

    expect(result.nodes.find(({ id }) => id === 'dependent')).toMatchObject({
      effectiveStatus: 'blocked',
      blockedBy: ['dependency']
    });
    expect(result.relationships[0]).toMatchObject({ isBlocking: true });
  });

  it('bubbles a blocked member into its group and onward to a dependent', () => {
    const result = projectGraph(
      project(
        [node('group', 'ready', 'group'), node('member', 'blocked'), node('dependent', 'ready')],
        [memberOf('membership', 'member', 'group'), dependsOn('dependency', 'dependent', 'group')]
      )
    );

    expect(result.nodes.find(({ id }) => id === 'group')).toMatchObject({
      effectiveStatus: 'blocked',
      blockedBy: ['member']
    });
    expect(result.nodes.find(({ id }) => id === 'dependent')).toMatchObject({
      effectiveStatus: 'blocked',
      blockedBy: ['group']
    });
    expect(result.relationships).toMatchObject([
      { id: 'membership', isBlocking: true },
      { id: 'dependency', isBlocking: true }
    ]);
  });

  it('reports cycles and remains deterministic instead of recursing forever', () => {
    const input = project(
      [node('a', 'in_progress', 'group'), node('b', 'ready', 'group')],
      [memberOf('one', 'a', 'b'), memberOf('two', 'b', 'a')]
    );

    expect(projectGraph(input)).toEqual(projectGraph(input));
    expect(projectGraph(input).warnings).toContainEqual(
      expect.objectContaining({
        kind: 'invalid_relationship',
        relationshipId: 'two',
        violation: 'cycle'
      })
    );
  });

  it('canonicalizes overlapping memberships without constructing the projected read model', () => {
    const input = project(
      [node('one', 'ready', 'group'), node('two', 'ready', 'group'), node('task')],
      [memberOf('one-membership', 'task', 'one'), memberOf('two-membership', 'task', 'two')]
    );

    const canonical = canonicalizeProjectRelationships(input);

    expect(canonical.project).toEqual(input);
    expect(canonical.warnings).toEqual([]);
    expect(canonical.project.nodes[0]).not.toHaveProperty('effectiveStatus');
  });

  it('derives each direct group and every ancestor path in an overlapping membership DAG', () => {
    const input = project(
      [
        node('root', 'ready', 'group'),
        node('frontend', 'ready', 'group'),
        node('backend', 'ready', 'group'),
        node('shared-bug', 'done')
      ],
      [
        memberOf('bug-frontend', 'shared-bug', 'frontend'),
        memberOf('bug-backend', 'shared-bug', 'backend'),
        memberOf('frontend-root', 'frontend', 'root'),
        memberOf('backend-root', 'backend', 'root')
      ]
    );

    const result = projectGraph(input);

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'frontend', effectiveStatus: 'done', progress: 1 }),
        expect.objectContaining({ id: 'backend', effectiveStatus: 'done', progress: 1 }),
        expect.objectContaining({ id: 'root', effectiveStatus: 'done', progress: 1 })
      ])
    );
    const sharedBugGroups = explainNode(result, 'shared-bug')?.relationships.groups.map(
      ({ relationshipId, node: group }) => ({ relationshipId, groupId: group.id })
    );
    expect(sharedBugGroups).toEqual([
      { relationshipId: 'bug-backend', groupId: 'backend' },
      { relationshipId: 'bug-frontend', groupId: 'frontend' }
    ]);
    const rootProgress = explainNode(result, 'root')?.progress.members.map(
      ({ node: member, contribution }) => ({ memberId: member.id, contribution })
    );
    expect(rootProgress).toEqual([
      { memberId: 'backend', contribution: 1 },
      { memberId: 'frontend', contribution: 1 }
    ]);
  });

  it('bubbles a shared blocked member into every direct group', () => {
    const result = projectGraph(
      project(
        [
          node('frontend', 'ready', 'group'),
          node('backend', 'ready', 'group'),
          node('shared-bug', 'blocked')
        ],
        [
          memberOf('bug-frontend', 'shared-bug', 'frontend'),
          memberOf('bug-backend', 'shared-bug', 'backend')
        ]
      )
    );

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'frontend',
          effectiveStatus: 'blocked',
          blockedBy: ['shared-bug']
        }),
        expect.objectContaining({
          id: 'backend',
          effectiveStatus: 'blocked',
          blockedBy: ['shared-bug']
        })
      ])
    );
    expect(result.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'bug-frontend', isBlocking: true }),
        expect.objectContaining({ id: 'bug-backend', isBlocking: true })
      ])
    );
  });

  it('rejects a candidate relationship that introduces a mixed cycle', () => {
    const input = project(
      [node('group', 'ready', 'group'), node('task')],
      [memberOf('membership', 'task', 'group')]
    );
    const candidate = dependsOn('dependency', 'task', 'group');

    expect(wouldCreateCycle(input, candidate)).toBe(true);
  });

  it('accepts a second membership while preserving duplicate and cycle protection', () => {
    const input = project(
      [node('one', 'ready', 'group'), node('two', 'ready', 'group'), node('task')],
      [memberOf('membership', 'task', 'one')]
    );

    expect(validateRelationship(input, memberOf('candidate', 'task', 'two'))).toEqual({ ok: true });
    expect(validateRelationship(input, memberOf('duplicate', 'task', 'one'))).toMatchObject({
      ok: false,
      violation: 'duplicate_relationship'
    });
  });

  it('requires the object of a membership relationship to be a group', () => {
    const input = project([node('task'), node('other')], []);

    expect(validateRelationship(input, memberOf('candidate', 'task', 'other'))).toMatchObject({
      ok: false,
      violation: 'group_required'
    });
  });

  it('passes notes through projection without inventing work state', () => {
    const annotation = note('annotation', '# Remember this');
    const result = projectGraph(project([node('group', 'ready', 'group'), annotation], []));

    expect(result.nodes.find(({ id }) => id === annotation.id)).toEqual(annotation);
    expect(explainNode(result, annotation.id)).toBeUndefined();
    expect(result.nodes.find(({ id }) => id === 'group')).toMatchObject({
      progress: 0,
      effectiveStatus: 'ready'
    });
  });

  it('rejects relationships with a note at either endpoint', () => {
    const input = project([node('task'), node('group', 'ready', 'group'), note('annotation')], []);

    expect(validateRelationship(input, dependsOn('first', 'task', 'annotation'))).toMatchObject({
      ok: false,
      violation: 'work_node_required'
    });
    expect(validateRelationship(input, memberOf('second', 'annotation', 'group'))).toMatchObject({
      ok: false,
      violation: 'work_node_required'
    });
  });
});

describe('completedGroupIds', () => {
  it('reports Groups that became done, outermost first, and not ones already done', () => {
    const relationships = [
      memberOf('task-in-inner', 'task', 'inner'),
      memberOf('inner-in-outer', 'inner', 'outer'),
      memberOf('done-in-finished', 'done', 'finished')
    ];
    const groups = [node('inner', 'ready', 'group'), node('outer', 'ready', 'group')];
    const finished = [node('finished', 'ready', 'group'), node('done', 'done')];

    expect(
      completedGroupIds(
        projectGraph(project([...groups, ...finished, node('task')], relationships)),
        projectGraph(project([...groups, ...finished, node('task', 'done')], relationships))
      )
    ).toEqual(['outer', 'inner']);
  });
});
