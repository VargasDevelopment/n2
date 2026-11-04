import type { GraphRelationship, Project, WorkNode } from '@n2/contracts';
import * as domain from '@n2/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  executionFingerprint,
  type StoredExecutionAttempt,
  type StoredExecutionEligibility
} from '../src/execution.js';
import { projectExecution } from '../src/executionView.js';

const timestamp = '2026-10-15T00:00:00.000Z';
const enablementId = '00000000-0000-4000-8000-000000000001';
const node = (
  id: string,
  sequence: number,
  kind: WorkNode['kind'] = 'task',
  requestedStatus: WorkNode['requestedStatus'] = 'ready'
): WorkNode => ({
  id,
  reference: `PERF-${sequence}`,
  kind,
  title: id,
  description: `Instructions for ${id}`,
  requestedStatus,
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: timestamp,
  updatedAt: timestamp
});

const memberOf = (memberId: string, groupId: string): GraphRelationship => ({
  id: `${memberId}-in-${groupId}`,
  kind: 'member_of',
  memberId,
  groupId,
  createdAt: timestamp
});
const dependsOn = (dependentId: string, dependencyId: string): GraphRelationship => ({
  id: `${dependentId}-needs-${dependencyId}`,
  kind: 'depends_on',
  dependentId,
  dependencyId,
  createdAt: timestamp
});

const fixture = (): Project => ({
  id: 'project',
  name: 'Execution projection fixture',
  referenceKey: 'PERF',
  nodes: [
    node('outer', 1, 'group'),
    node('inner', 2, 'group'),
    node('paused', 3, 'task', 'blocked'),
    node('done', 4, 'task', 'done'),
    node('dependent', 5),
    node('chained', 6),
    node('enabled', 10),
    node('changed', 9),
    node('disabled', 8),
    node('dispatchable', 11)
  ],
  relationships: [
    memberOf('inner', 'outer'),
    memberOf('paused', 'inner'),
    memberOf('done', 'inner'),
    memberOf('done', 'outer'),
    dependsOn('dependent', 'outer'),
    dependsOn('chained', 'dependent'),
    dependsOn('chained', 'done'),
    dependsOn('enabled', 'done'),
    dependsOn('dispatchable', 'done')
  ]
});

const eligibility = (project: Project, taskId: string): StoredExecutionEligibility => ({
  taskId,
  enabled: taskId !== 'disabled',
  enablementId,
  enabledFingerprint: executionFingerprint(project, taskId),
  enabledAt: timestamp,
  disabledAt: taskId === 'disabled' ? timestamp : null
});

const attempt = (
  taskId: string,
  sequence: number,
  state: StoredExecutionAttempt['state'],
  claimedFingerprint: string
): StoredExecutionAttempt => ({
  attemptId: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
  taskId,
  workerId: 'fixture-worker',
  claimedFingerprint,
  enablementId,
  inputSnapshot: {
    taskId,
    reference: 'PERF-10',
    title: taskId,
    description: 'Frozen instructions',
    dependencies: [],
    dependents: []
  },
  state,
  progress: null,
  claimedAt: timestamp,
  heartbeatAt: timestamp,
  stopRequestedAt: state === 'stop_requested' ? timestamp : null,
  finishedAt: state === 'completed' ? timestamp : null
});

afterEach(() => vi.restoreAllMocks());

describe('execution projection', () => {
  it.each([false, true])('preserves the baseline response bytes (archived: %s)', (archived) => {
    const project = fixture();
    const eligibilities = ['enabled', 'changed', 'disabled', 'chained', 'dispatchable'].map(
      (taskId) => eligibility(project, taskId)
    );
    const fingerprint = executionFingerprint(project, 'enabled');
    const attempts = [
      attempt('enabled', 2, 'completed', fingerprint),
      attempt('changed', 3, 'stop_requested', executionFingerprint(project, 'changed')),
      attempt('enabled', 4, 'active', fingerprint),
      attempt('deleted-task', 5, 'completed', fingerprint)
    ];
    project.nodes = project.nodes.map((task) =>
      task.id === 'changed' ? { ...task, title: 'Changed instructions' } : task
    );
    const result = projectExecution(project, eligibilities, attempts, archived);

    // Frozen from main at 67a4f93 before optimizing: checks every field and its order.
    expect(JSON.stringify(result, null, 2)).toMatchSnapshot();
    expect(result.tasks.find(({ taskId }) => taskId === 'dependent')?.claimBlockers).toEqual([
      { code: 'disabled', taskIds: [] },
      { code: 'unfinished_dependencies', taskIds: ['outer'] },
      ...(archived ? [{ code: 'project_archived', taskIds: [] }] : [])
    ]);
    expect(result.tasks.find(({ taskId }) => taskId === 'dispatchable')).toMatchObject({
      dispatchable: !archived,
      claimBlockers: archived ? [{ code: 'project_archived', taskIds: [] }] : []
    });
    expect(result.tasks.find(({ taskId }) => taskId === 'chained')?.claimBlockers).toEqual([
      { code: 'unfinished_dependencies', taskIds: ['dependent'] },
      ...(archived ? [{ code: 'project_archived', taskIds: [] }] : [])
    ]);
  });

  it.each([33, 335])('derives the graph once for %i cards, independent of Task count', (size) => {
    const project: Project = {
      ...fixture(),
      nodes: [node('group', 1, 'group')],
      relationships: []
    };
    for (let index = 1; index < size; index += 1) {
      const taskId = `task-${index}`;
      project.nodes.push(node(taskId, index + 1));
      project.relationships.push(memberOf(taskId, 'group'));
    }
    // Include a real prerequisite so skipping projection on membership-only graphs cannot mask it.
    project.relationships.push(dependsOn('task-2', 'task-1'));
    const derive = vi.spyOn(domain, 'projectGraph');
    const result = projectExecution(project, [], [], false);

    expect(result.tasks).toHaveLength(size - 1);
    expect(derive).toHaveBeenCalledTimes(1);
    expect(result.tasks.find(({ taskId }) => taskId === 'task-2')?.claimBlockers).toContainEqual({
      code: 'unfinished_dependencies',
      taskIds: ['task-1']
    });
  });
});
