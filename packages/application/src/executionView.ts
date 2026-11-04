import {
  ProjectExecutionSchema,
  type ExecutionAttempt,
  type ExecutionFingerprint,
  type Project,
  type ProjectExecution
} from '@n2/contracts';
import {
  executionFingerprint,
  type StoredExecutionAttempt,
  type StoredExecutionEligibility
} from './execution.js';
import { projectedNodeById, unfinishedDependencyIds } from './executionGraph.js';

const executionAttemptView = (
  project: Project,
  attempt: StoredExecutionAttempt
): ExecutionAttempt => {
  const task = project.nodes.find(({ id }) => id === attempt.taskId);
  return {
    ...attempt,
    newerInstructionsExist:
      task?.kind === 'task'
        ? executionFingerprint(project, attempt.taskId) !== attempt.claimedFingerprint
        : false,
    stopRequested: attempt.state === 'stop_requested'
  };
};

const executionEligibilityState = (
  eligibility: StoredExecutionEligibility | null,
  currentFingerprint: ExecutionFingerprint
): ProjectExecution['tasks'][number]['eligibility'] =>
  !eligibility?.enabled
    ? 'off'
    : eligibility.enabledFingerprint === currentFingerprint
      ? 'enabled'
      : 'instructions_changed';

export const projectExecution = (
  project: Project,
  eligibilities: readonly StoredExecutionEligibility[],
  storedAttempts: readonly StoredExecutionAttempt[],
  projectArchived: boolean
): ProjectExecution => {
  const projected = projectedNodeById(project);
  const eligibilityByTask = new Map(
    eligibilities.map((eligibility) => [eligibility.taskId, eligibility])
  );
  const attempts = storedAttempts.map((attempt) => executionAttemptView(project, attempt));
  const tasks = project.nodes
    .filter((node) => node.kind === 'task')
    .map((task) => {
      const eligibility = eligibilityByTask.get(task.id) ?? null;
      const currentFingerprint = executionFingerprint(project, task.id);
      const eligibilityState = executionEligibilityState(eligibility, currentFingerprint);
      const taskAttempts = attempts.filter((attempt) => attempt.taskId === task.id);
      const currentAttempt =
        taskAttempts.find((attempt) => ['active', 'stop_requested'].includes(attempt.state)) ??
        null;
      const latestAttempt = taskAttempts.at(-1) ?? null;
      const unfinished = unfinishedDependencyIds(project, task.id, projected);
      const claimBlockers: ProjectExecution['tasks'][number]['claimBlockers'] = [];
      if (eligibilityState === 'off') claimBlockers.push({ code: 'disabled', taskIds: [] });
      if (eligibilityState === 'instructions_changed') {
        claimBlockers.push({ code: 'instructions_changed', taskIds: [] });
      }
      if (task.requestedStatus === 'blocked') claimBlockers.push({ code: 'paused', taskIds: [] });
      if (task.requestedStatus === 'done') claimBlockers.push({ code: 'done', taskIds: [] });
      if (unfinished.length > 0) {
        claimBlockers.push({ code: 'unfinished_dependencies', taskIds: unfinished });
      }
      if (currentAttempt) claimBlockers.push({ code: 'active_attempt', taskIds: [] });
      // Claims into an Archived Project are rejected, so its Tasks are never dispatchable.
      if (projectArchived) claimBlockers.push({ code: 'project_archived', taskIds: [] });
      return {
        taskId: task.id,
        reference: task.reference,
        title: task.title,
        eligibility: eligibilityState,
        currentFingerprint,
        enabledFingerprint: eligibility?.enabledFingerprint ?? null,
        enablementId: eligibility?.enablementId ?? null,
        enabledAt: eligibility?.enabledAt ?? null,
        disabledAt: eligibility?.disabledAt ?? null,
        dispatchable: claimBlockers.length === 0,
        claimBlockers,
        activeAttempt: currentAttempt,
        latestAttempt
      };
    })
    .sort((left, right) => left.reference.localeCompare(right.reference));
  return ProjectExecutionSchema.parse({ projectId: project.id, tasks, attempts });
};
