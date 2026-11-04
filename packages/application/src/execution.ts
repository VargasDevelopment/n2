import { createHash } from 'node:crypto';
import {
  GroupEnablePreviewSchema,
  projectCommandOutcome,
  type ExecutionAttempt,
  type ExecutionAttemptState,
  type ExecutionConflictReason,
  type ExecutionFingerprint,
  type GroupEnablePreview,
  type Project,
  type ProjectCommand,
  type ProjectCommandOutcome
} from '@n2/contracts';
import {
  inputSnapshot,
  isDependsOn,
  projectedNodeById,
  unfinishedDependencyIds
} from './executionGraph.js';

export type StoredExecutionEligibility = {
  taskId: string;
  enabled: boolean;
  enablementId: string;
  enabledFingerprint: ExecutionFingerprint;
  enabledAt: string;
  disabledAt: string | null;
};

export type StoredExecutionAttempt = Omit<
  ExecutionAttempt,
  'newerInstructionsExist' | 'stopRequested'
>;

export interface ExecutionReader {
  getExecutionEligibilities(projectId: string): StoredExecutionEligibility[];
  getExecutionAttempts(projectId: string): StoredExecutionAttempt[];
}

export interface ExecutionWriter {
  getExecutionEligibility(taskId: string): StoredExecutionEligibility | null;
  getExecutionAttempt(attemptId: string): StoredExecutionAttempt | null;
  isExecutionAttemptIdReserved(attemptId: string): boolean;
  isEnablementIdReserved(enablementId: string): boolean;
  getExecutionAttempts(): StoredExecutionAttempt[];
  saveExecutionEligibility(eligibility: StoredExecutionEligibility): void;
  reserveEnablementId(enablementId: string, taskId: string, timestamp: string): void;
  requestExecutionStop(taskId: string, timestamp: string): void;
  createExecutionAttempt(attempt: StoredExecutionAttempt): void;
  heartbeatExecutionAttempt(attemptId: string, timestamp: string): void;
  progressExecutionAttempt(attemptId: string, progress: string, timestamp: string): void;
  finishExecutionAttempt(
    attemptId: string,
    state: Extract<ExecutionAttemptState, 'completed' | 'failed' | 'released' | 'stopped'>,
    progress: string | undefined,
    timestamp: string
  ): void;
}

export class ExecutionConflictError extends Error {
  constructor(
    readonly reason: ExecutionConflictReason,
    message: string,
    readonly details: {
      taskId?: string;
      groupId?: string;
      attemptId?: string;
      taskIds?: string[];
    } = {}
  ) {
    super(message);
  }
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const sha256 = (value: unknown): ExecutionFingerprint =>
  `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;

export const executionFingerprint = (project: Project, taskId: string): ExecutionFingerprint => {
  const task = project.nodes.find(({ id }) => id === taskId);
  if (task?.kind !== 'task') {
    throw new ExecutionConflictError(
      'task_required',
      'Agent execution eligibility requires a Task.',
      {
        taskId
      }
    );
  }
  const dependencies = project.relationships
    .filter(isDependsOn)
    .filter((relationship) => relationship.dependentId === taskId)
    .map(({ dependentId, dependencyId }) => ({ dependentId, dependencyId }))
    .sort((left, right) =>
      `${left.dependentId}\0${left.dependencyId}`.localeCompare(
        `${right.dependentId}\0${right.dependencyId}`
      )
    );
  const dependents = project.relationships
    .filter(isDependsOn)
    .filter((relationship) => relationship.dependencyId === taskId)
    .map(({ dependentId, dependencyId }) => ({ dependentId, dependencyId }))
    .sort((left, right) =>
      `${left.dependentId}\0${left.dependencyId}`.localeCompare(
        `${right.dependentId}\0${right.dependencyId}`
      )
    );
  return sha256({
    version: 1,
    title: task.title,
    description: task.description,
    dependencies,
    dependents
  });
};

export const reachableTaskIds = (project: Project, groupId: string): string[] => {
  const group = project.nodes.find(({ id }) => id === groupId);
  if (group?.kind !== 'group') {
    throw new ExecutionConflictError('group_required', 'Group enablement requires a Group.', {
      groupId
    });
  }
  const nodeById = new Map(project.nodes.map((node) => [node.id, node]));
  const membersByGroup = new Map<string, string[]>();
  for (const relationship of project.relationships) {
    if (relationship.kind !== 'member_of') continue;
    membersByGroup.set(relationship.groupId, [
      ...(membersByGroup.get(relationship.groupId) ?? []),
      relationship.memberId
    ]);
  }
  const visitedGroups = new Set<string>();
  const tasks = new Set<string>();
  const pending = [groupId];
  while (pending.length > 0) {
    const currentGroupId = pending.pop();
    if (!currentGroupId || visitedGroups.has(currentGroupId)) continue;
    visitedGroups.add(currentGroupId);
    for (const memberId of membersByGroup.get(currentGroupId) ?? []) {
      const member = nodeById.get(memberId);
      if (member?.kind === 'task') tasks.add(member.id);
      else if (member?.kind === 'group' && !visitedGroups.has(member.id)) pending.push(member.id);
    }
  }
  return [...tasks].sort();
};

const previewToken = (projectId: string, groupId: string, taskIds: readonly string[]) =>
  sha256({ version: 1, projectId, groupId, taskIds: [...taskIds].sort() });

export const previewGroupEnablement = (project: Project, groupId: string): GroupEnablePreview => {
  const taskIds = reachableTaskIds(project, groupId);
  const tasks = taskIds.map((taskId) => {
    const task = project.nodes.find(({ id }) => id === taskId);
    if (task?.kind !== 'task') throw new Error(`Reachable Task ${taskId} disappeared.`);
    return { taskId, reference: task.reference, title: task.title };
  });
  return GroupEnablePreviewSchema.parse({
    projectId: project.id,
    groupId,
    previewToken: previewToken(project.id, groupId, taskIds),
    tasks
  });
};

const activeAttempt = (attempts: readonly StoredExecutionAttempt[], taskId: string) =>
  attempts.find(
    (attempt) => attempt.taskId === taskId && ['active', 'stop_requested'].includes(attempt.state)
  ) ?? null;

const requireOwnedAttempt = (
  writer: ExecutionWriter,
  attemptId: string,
  workerId: string
): StoredExecutionAttempt => {
  const attempt = writer.getExecutionAttempt(attemptId);
  if (!attempt) {
    throw new ExecutionConflictError('attempt_superseded', `Attempt ${attemptId} is not current.`, {
      attemptId
    });
  }
  if (attempt.workerId !== workerId) {
    throw new ExecutionConflictError(
      'attempt_owner_mismatch',
      `Attempt ${attemptId} is owned by another worker.`,
      { attemptId, taskId: attempt.taskId }
    );
  }
  return attempt;
};

const attemptWasSuperseded = (
  attempts: readonly StoredExecutionAttempt[],
  attempt: StoredExecutionAttempt
): boolean => {
  const position = attempts.findIndex(({ attemptId }) => attemptId === attempt.attemptId);
  return attempts.some(
    (candidate, index) => index > position && candidate.taskId === attempt.taskId
  );
};

type ExecutionCommand = Exclude<
  ProjectCommand,
  | Extract<ProjectCommand, { kind: 'create_node' }>
  | Extract<ProjectCommand, { kind: 'update_node' }>
  | Extract<ProjectCommand, { kind: 'move_nodes' }>
  | Extract<ProjectCommand, { kind: 'delete_node' }>
  | Extract<ProjectCommand, { kind: 'create_relationship' }>
  | Extract<ProjectCommand, { kind: 'delete_relationship' }>
>;

const claimTask = (
  project: Project,
  command: Extract<ExecutionCommand, { kind: 'claim_task' }>,
  writer: ExecutionWriter,
  timestamp: string
): void => {
  const task = project.nodes.find(({ id }) => id === command.taskId);
  if (task?.kind !== 'task') {
    throw new ExecutionConflictError('task_required', 'Only a Task can be claimed.', {
      taskId: command.taskId
    });
  }
  if (writer.isExecutionAttemptIdReserved(command.attemptId)) {
    throw new ExecutionConflictError(
      'attempt_id_conflict',
      `Attempt ID ${command.attemptId} is already in use.`,
      { attemptId: command.attemptId, taskId: command.taskId }
    );
  }
  const currentFingerprint = executionFingerprint(project, task.id);
  const eligibility = writer.getExecutionEligibility(task.id);
  if (!eligibility?.enabled) {
    throw new ExecutionConflictError(
      'eligibility_disabled',
      'This Task is not enabled for agents.',
      { taskId: task.id }
    );
  }
  if (command.expectedFingerprint !== currentFingerprint) {
    throw new ExecutionConflictError(
      'stale_fingerprint',
      'The claim expected an older execution fingerprint.',
      { taskId: task.id }
    );
  }
  if (command.expectedEnablementId !== eligibility.enablementId) {
    throw new ExecutionConflictError(
      'stale_enablement',
      'The claim expected an older Enablement.',
      { taskId: task.id }
    );
  }
  if (eligibility.enabledFingerprint !== currentFingerprint) {
    throw new ExecutionConflictError(
      'instructions_changed',
      'Instructions changed since this Task was enabled; re-enable it to authorize execution.',
      { taskId: task.id }
    );
  }
  if (task.requestedStatus === 'blocked') {
    throw new ExecutionConflictError('task_paused', 'This Task is paused.', {
      taskId: task.id
    });
  }
  if (task.requestedStatus === 'done') {
    throw new ExecutionConflictError('task_done', 'This Task is already Done.', {
      taskId: task.id
    });
  }
  const projected = projectedNodeById(project);
  const unfinished = unfinishedDependencyIds(project, task.id, projected);
  if (unfinished.length > 0) {
    throw new ExecutionConflictError(
      'prerequisite_incomplete',
      'All Depends on dependencies must be Done before this Task can be claimed.',
      { taskId: task.id, taskIds: unfinished }
    );
  }
  if (activeAttempt(writer.getExecutionAttempts(), task.id)) {
    throw new ExecutionConflictError(
      'attempt_active',
      'This Task already has an active Execution Attempt.',
      { taskId: task.id }
    );
  }
  writer.createExecutionAttempt({
    attemptId: command.attemptId,
    taskId: task.id,
    workerId: command.workerId,
    claimedFingerprint: currentFingerprint,
    enablementId: eligibility.enablementId,
    inputSnapshot: inputSnapshot(project, task.id, projected),
    state: 'active',
    progress: null,
    claimedAt: timestamp,
    heartbeatAt: timestamp,
    stopRequestedAt: null,
    finishedAt: null
  });
};

export const executeExecutionCommand = (
  projectId: string,
  project: Project,
  command: ExecutionCommand,
  writer: ExecutionWriter
): ProjectCommandOutcome => {
  const timestamp = new Date().toISOString();
  switch (command.kind) {
    case 'enable_task_for_agents': {
      const fingerprint = executionFingerprint(project, command.taskId);
      if (writer.isEnablementIdReserved(command.enablementId)) {
        throw new ExecutionConflictError(
          'enablement_id_conflict',
          `Enablement ID ${command.enablementId} was already used.`,
          { taskId: command.taskId }
        );
      }
      writer.reserveEnablementId(command.enablementId, command.taskId, timestamp);
      writer.saveExecutionEligibility({
        taskId: command.taskId,
        enabled: true,
        enablementId: command.enablementId,
        enabledFingerprint: fingerprint,
        enabledAt: timestamp,
        disabledAt: null
      });
      break;
    }
    case 'disable_task_for_agents': {
      executionFingerprint(project, command.taskId);
      const existing = writer.getExecutionEligibility(command.taskId);
      if (existing) {
        writer.saveExecutionEligibility({
          ...existing,
          enabled: false,
          disabledAt: timestamp
        });
      }
      writer.requestExecutionStop(command.taskId, timestamp);
      break;
    }
    case 'enable_group_for_agents': {
      const taskIds = reachableTaskIds(project, command.groupId);
      const commandedTaskIds = command.taskEnablements.map(({ taskId }) => taskId).sort();
      const expectedToken = previewToken(projectId, command.groupId, taskIds);
      if (
        command.previewToken !== expectedToken ||
        JSON.stringify(commandedTaskIds) !== JSON.stringify(taskIds)
      ) {
        throw new ExecutionConflictError(
          'preview_changed',
          'Reachable Tasks changed after the enablement preview; preview the Group again.',
          { taskIds }
        );
      }
      const reused = command.taskEnablements.filter(({ enablementId }) =>
        writer.isEnablementIdReserved(enablementId)
      );
      if (reused.length > 0) {
        throw new ExecutionConflictError(
          'enablement_id_conflict',
          `Enablement ID ${reused[0]!.enablementId} was already used.`,
          { taskIds: reused.map(({ taskId }) => taskId) }
        );
      }
      for (const { taskId, enablementId } of command.taskEnablements) {
        writer.reserveEnablementId(enablementId, taskId, timestamp);
        writer.saveExecutionEligibility({
          taskId,
          enabled: true,
          enablementId,
          enabledFingerprint: executionFingerprint(project, taskId),
          enabledAt: timestamp,
          disabledAt: null
        });
      }
      break;
    }
    case 'claim_task': {
      claimTask(project, command, writer, timestamp);
      break;
    }
    case 'heartbeat_attempt':
    case 'record_attempt_progress': {
      const attempt = requireOwnedAttempt(writer, command.attemptId, command.workerId);
      if (!['active', 'stop_requested'].includes(attempt.state)) {
        const superseded = attemptWasSuperseded(writer.getExecutionAttempts(), attempt);
        throw new ExecutionConflictError(
          superseded ? 'attempt_superseded' : 'attempt_not_active',
          `Attempt ${command.attemptId} is no longer active.`,
          { attemptId: command.attemptId, taskId: attempt.taskId }
        );
      }
      if (command.kind === 'heartbeat_attempt') {
        writer.heartbeatExecutionAttempt(command.attemptId, timestamp);
      } else {
        writer.progressExecutionAttempt(command.attemptId, command.progress, timestamp);
      }
      break;
    }
    case 'complete_attempt':
    case 'fail_attempt':
    case 'release_attempt':
    case 'confirm_attempt_stopped': {
      const attempt = requireOwnedAttempt(writer, command.attemptId, command.workerId);
      if (command.kind === 'confirm_attempt_stopped') {
        if (attempt.state !== 'stop_requested') {
          throw new ExecutionConflictError(
            'stop_not_requested',
            `Attempt ${command.attemptId} has no pending Stop Request.`,
            { attemptId: command.attemptId, taskId: attempt.taskId }
          );
        }
        writer.finishExecutionAttempt(command.attemptId, 'stopped', undefined, timestamp);
        break;
      }
      if (attempt.state !== 'active') {
        const superseded = attemptWasSuperseded(writer.getExecutionAttempts(), attempt);
        throw new ExecutionConflictError(
          superseded ? 'attempt_superseded' : 'attempt_not_active',
          `Attempt ${command.attemptId} is no longer active.`,
          { attemptId: command.attemptId, taskId: attempt.taskId }
        );
      }
      const state =
        command.kind === 'complete_attempt'
          ? 'completed'
          : command.kind === 'fail_attempt'
            ? 'failed'
            : 'released';
      writer.finishExecutionAttempt(
        command.attemptId,
        state,
        command.kind === 'fail_attempt' ? command.error : undefined,
        timestamp
      );
      break;
    }
  }
  return projectCommandOutcome(command);
};
