import type {
  CreateNodeInput,
  CreateRelationshipInput,
  ExecutionFingerprint,
  NodePatch,
  Position,
  ProjectCommandInput as CanonicalProjectCommand,
  ProjectCommandResponse,
  ProjectedNode,
  ProjectedProject,
  ProjectedWorkNode
} from '@n2/contracts';
import { isWorkNode } from '@n2/contracts';
import { N2ProtocolError, N2TransportError } from '@n2/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import * as api from './api.js';
import { nextStatus } from './graphInteraction.js';

export const projectQueryKey = (projectId: string) => ['project', projectId] as const;
export const executionQueryKey = (projectId: string) => ['execution', projectId] as const;
export const PROJECT_LIBRARY_QUERY_KEY = ['project-library'] as const;

export type NodePositionMove = { nodeId: string; position: Position };

export type ProjectInteractionIntent =
  | { kind: 'create_node'; input: CreateNodeInput }
  | { kind: 'update_node'; nodeId: string; patch: NodePatch }
  | { kind: 'move_nodes'; moves: NodePositionMove[] }
  | { kind: 'cycle_status'; nodeId: string }
  | { kind: 'delete_node'; nodeId: string }
  | { kind: 'create_relationship'; input: CreateRelationshipInput }
  | { kind: 'delete_relationship'; relationshipId: string }
  | { kind: 'enable_task_for_agents'; taskId: string }
  | { kind: 'disable_task_for_agents'; taskId: string }
  | {
      kind: 'enable_group_for_agents';
      groupId: string;
      previewToken: ExecutionFingerprint;
      taskIds: string[];
    };

export type ProjectCommandResult =
  | { status: 'executed'; project: ProjectedProject }
  | { status: 'failed'; project: ProjectedProject | null }
  | { status: 'canceled'; project: ProjectedProject };

type ProjectCommandOptions = {
  /** Asked against the authoritative state the command will apply to, after queued writes. */
  confirm?: (project: ProjectedProject) => Promise<boolean>;
};

type ScopedProjectCommand = {
  projectId: string;
  command: ProjectInteractionIntent;
  options?: ProjectCommandOptions;
};

type ProjectCommandOutcome = {
  executed: boolean;
  project: ProjectedProject;
  completedGroups: readonly ProjectedGroup[];
};

const requireNode = (project: ProjectedProject, nodeId: string): ProjectedNode => {
  const node = project.nodes.find(({ id }) => id === nodeId);
  if (!node) throw new Error(`Node ${nodeId} is no longer in this project.`);
  return node;
};

const hasRelationship = (project: ProjectedProject, relationshipId: string): boolean =>
  project.relationships.some(({ id }) => id === relationshipId) ||
  project.warnings.some((warning) => warning.relationshipId === relationshipId);

const requireRelationship = (project: ProjectedProject, relationshipId: string): void => {
  if (!hasRelationship(project, relationshipId)) {
    throw new Error(`Relationship ${relationshipId} is no longer in this project.`);
  }
};

const deleteCommandIsAlreadyFulfilled = (
  project: ProjectedProject,
  command: ProjectInteractionIntent
): boolean =>
  (command.kind === 'delete_node' && !project.nodes.some(({ id }) => id === command.nodeId)) ||
  (command.kind === 'delete_relationship' && !hasRelationship(project, command.relationshipId));

export type ProjectedGroup = Extract<ProjectedWorkNode, { kind: 'group' }>;

/**
 * The receipt's Group Completions, resolved against the project it returned. Only the server knows
 * the state a command applied to, so the client never infers completions from its own cache.
 */
const reportedCompletions = ({ project, effects }: ProjectCommandResponse): ProjectedGroup[] =>
  effects.completedGroupIds.flatMap((groupId) => {
    const group = project.nodes.find(({ id }) => id === groupId);
    return group?.kind === 'group' ? [group] : [];
  });

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : 'Unknown error';

const canonicalProjectCommand = (
  project: ProjectedProject,
  command: ProjectInteractionIntent
): CanonicalProjectCommand => {
  const commandId = crypto.randomUUID();
  let canonicalCommand: CanonicalProjectCommand;
  switch (command.kind) {
    case 'create_node':
      canonicalCommand = {
        kind: 'create_node',
        commandId,
        nodeId: crypto.randomUUID(),
        input: command.input
      };
      break;
    case 'create_relationship':
      canonicalCommand = {
        kind: 'create_relationship',
        commandId,
        relationshipId: crypto.randomUUID(),
        input: command.input
      };
      break;
    case 'delete_relationship':
      requireRelationship(project, command.relationshipId);
      canonicalCommand = {
        kind: 'delete_relationship',
        commandId,
        relationshipId: command.relationshipId
      };
      break;
    case 'update_node': {
      const node = requireNode(project, command.nodeId);
      canonicalCommand = {
        kind: 'update_node',
        commandId,
        nodeId: node.id,
        expectedVersion: node.version,
        patch: command.patch
      };
      break;
    }
    case 'move_nodes':
      if (new Set(command.moves.map(({ nodeId }) => nodeId)).size !== command.moves.length) {
        throw new Error('Each node can appear only once in a move command.');
      }
      canonicalCommand = {
        kind: 'move_nodes',
        commandId,
        moves: Object.fromEntries(
          command.moves.map(({ nodeId, position }) => [
            nodeId,
            { position, expectedVersion: requireNode(project, nodeId).version }
          ])
        )
      };
      break;
    case 'cycle_status': {
      const node = requireNode(project, command.nodeId);
      if (!isWorkNode(node)) throw new Error('Notes do not have a work status to cycle.');
      canonicalCommand = {
        kind: 'update_node',
        commandId,
        nodeId: node.id,
        expectedVersion: node.version,
        patch: { requestedStatus: nextStatus(node.requestedStatus) }
      };
      break;
    }
    case 'delete_node': {
      const node = requireNode(project, command.nodeId);
      canonicalCommand = {
        kind: 'delete_node',
        commandId,
        nodeId: node.id,
        expectedVersion: node.version
      };
      break;
    }
    case 'enable_task_for_agents':
      canonicalCommand = {
        kind: 'enable_task_for_agents',
        commandId,
        taskId: command.taskId,
        enablementId: crypto.randomUUID()
      };
      break;
    case 'disable_task_for_agents':
      canonicalCommand = {
        kind: 'disable_task_for_agents',
        commandId,
        taskId: command.taskId
      };
      break;
    case 'enable_group_for_agents':
      canonicalCommand = {
        kind: 'enable_group_for_agents',
        commandId,
        groupId: command.groupId,
        previewToken: command.previewToken,
        taskEnablements: command.taskIds.map((taskId) => ({
          taskId,
          enablementId: crypto.randomUUID()
        }))
      };
      break;
  }
  return canonicalCommand;
};

export function useProjectCommands(
  projectId: string,
  reportError: (message: string) => void,
  onGroupsCompleted: (groups: readonly ProjectedGroup[]) => void = () => undefined
): {
  dispatch: (
    command: ProjectInteractionIntent,
    options?: ProjectCommandOptions
  ) => Promise<ProjectCommandResult>;
} {
  const queryClient = useQueryClient();
  const errorRevisionRef = useRef(0);
  // Callers (including the Inspector authorization guard) stay pending until fresh execution state
  // is installed, so controls never re-enable while still rendering pre-command eligibility.
  const refreshExecutionState = useCallback(
    (commandProjectId: string) =>
      queryClient.invalidateQueries({ queryKey: executionQueryKey(commandProjectId), exact: true }),
    [queryClient]
  );
  // The one owner of write order: commands run one at a time, in the order submitted, in a scope
  // that lives in the QueryClient and so outlives any workspace. Every submitted edit is sent and
  // the server decides what it changes; never skip one based on the cache, which can be stale.
  const mutation = useMutation({
    mutationKey: ['project-command'],
    scope: { id: 'project-writes' },
    mutationFn: async ({
      projectId: commandProjectId,
      command,
      options
    }: ScopedProjectCommand): Promise<ProjectCommandOutcome> => {
      const queryKey = projectQueryKey(commandProjectId);
      await queryClient.cancelQueries({ queryKey, exact: true });
      let project = queryClient.getQueryData<ProjectedProject>(queryKey);
      if (!project) {
        project = await api.getProject(commandProjectId);
        queryClient.setQueryData(queryKey, project);
      }
      // Confirmation comes first: a multi-node delete confirms the whole set on its first command,
      // which may itself already be gone while the rest of the set is not.
      if (options?.confirm && !(await options.confirm(project))) {
        return { executed: false, project, completedGroups: [] };
      }
      if (deleteCommandIsAlreadyFulfilled(project, command)) {
        return { executed: true, project, completedGroups: [] };
      }
      const canonicalCommand = canonicalProjectCommand(project, command);
      const settle = async (response: ProjectCommandResponse): Promise<ProjectCommandOutcome> => {
        queryClient.setQueryData(queryKey, response.project);
        await refreshExecutionState(commandProjectId);
        return {
          executed: true,
          project: response.project,
          completedGroups: reportedCompletions(response)
        };
      };

      try {
        return await settle(await api.executeProjectCommand(commandProjectId, canonicalCommand));
      } catch (cause) {
        let commandFailure = cause;
        if (cause instanceof N2TransportError || cause instanceof N2ProtocolError) {
          try {
            return await settle(
              await api.executeProjectCommand(commandProjectId, canonicalCommand)
            );
          } catch (retryCause) {
            commandFailure = retryCause;
          }
        }
        try {
          const authoritativeProject = await api.getProject(commandProjectId);
          queryClient.setQueryData(queryKey, authoritativeProject);
          await refreshExecutionState(commandProjectId);
          if (deleteCommandIsAlreadyFulfilled(authoritativeProject, command)) {
            return { executed: true, project: authoritativeProject, completedGroups: [] };
          }
        } catch (reconciliationCause) {
          queryClient.removeQueries({ queryKey, exact: true });
          throw new Error(
            `Command failed (${errorMessage(commandFailure)}). N2 could not verify the latest project state (${errorMessage(reconciliationCause)}).`,
            { cause: reconciliationCause }
          );
        }
        throw commandFailure;
      }
    }
  });
  const mutateAsync = mutation.mutateAsync;

  const dispatch = useCallback(
    async (
      command: ProjectInteractionIntent,
      options?: ProjectCommandOptions
    ): Promise<ProjectCommandResult> => {
      const commandProjectId = projectId;
      const errorRevisionAtDispatch = errorRevisionRef.current;
      try {
        const outcome = await mutateAsync({
          projectId: commandProjectId,
          command,
          ...(options ? { options } : {})
        });
        if (!outcome.executed) {
          return { status: 'canceled', project: outcome.project };
        }
        if (errorRevisionRef.current === errorRevisionAtDispatch) reportError('');
        if (outcome.completedGroups.length > 0) onGroupsCompleted(outcome.completedGroups);
        return { status: 'executed', project: outcome.project };
      } catch (cause) {
        errorRevisionRef.current += 1;
        reportError(cause instanceof Error ? cause.message : 'The project command failed.');
        return {
          status: 'failed',
          project:
            queryClient.getQueryData<ProjectedProject>(projectQueryKey(commandProjectId)) ?? null
        };
      }
    },
    [mutateAsync, onGroupsCompleted, projectId, queryClient, reportError]
  );

  return { dispatch };
}

export type ProjectCommandDispatch = ReturnType<typeof useProjectCommands>['dispatch'];
export type EditableNodePatch = NodePatch;
export type NodePosition = Position;
