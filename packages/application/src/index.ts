import {
  CreateProjectInputSchema,
  MarkLibraryActivitySeenInputSchema,
  type MarkLibraryActivitySeenInput,
  RenameProjectInputSchema,
  noCommandEffects,
  projectCommandOutcome,
  ProjectCommandSchema,
  isWorkNode,
  type CreateProjectInput,
  type CreateProjectResponse,
  type DeleteNodeInput,
  type GraphRelationship,
  type GraphWarning,
  type MoveNodesInput,
  type NodeKind,
  type NodeKindSpecificField,
  type NodeExplanation,
  type ProjectCommand,
  type ProjectCommandEffects,
  type ProjectCommandInput,
  type ProjectCommandOutcome,
  type ProjectCommandResponse,
  type Project,
  type ProjectLibrary,
  type ProjectLibraryQuery,
  type ProjectUpdateResponse,
  type RenameProjectInput,
  type ProjectExecution,
  type GroupEnablePreview,
  type ProjectSummary,
  type ProjectedProject,
  type RelationshipViolation,
  type ApplicationPreferences,
  type ApplicationPreferenceInput,
  type ApplicationPreferenceKey,
  type EffectiveProjectSettings,
  type ProjectSettingInput,
  type ProjectSettingKey,
  type UpdateNodeInput,
  type CommandActor
} from '@n2/contracts';
import { completedGroupIds, explainNode, projectGraph, validateRelationship } from '@n2/domain';
import { canChangeEffectiveStatus } from './commandEffects.js';
import { commandFingerprints } from './commandFingerprints.js';
import {
  ExecutionConflictError,
  executeExecutionCommand,
  previewGroupEnablement,
  type ExecutionReader,
  type ExecutionWriter
} from './execution.js';
import { projectExecution } from './executionView.js';
import {
  libraryActivity,
  projectActivity,
  type ActivityStore,
  type ActivityUseCases
} from './activity.js';
import {
  applicationPreferences,
  effectiveProjectSettings,
  parseApplicationPreferenceInput,
  parseApplicationPreferenceKey,
  parseProjectSettingInput,
  parseProjectSettingKey,
  type SettingsStore,
  type SettingsUseCases
} from './settings.js';

export * from './settings.js';
export * from './execution.js';
export * from './executionView.js';
export * from './activity.js';

export class EntityNotFoundError extends Error {}

export class VersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super(`The node changed since version ${currentVersion}.`);
  }
}

export class RelationshipConflictError extends Error {
  constructor(
    message: string,
    readonly violation: RelationshipViolation
  ) {
    super(message);
  }
}

export class CanvasItemConflictError extends Error {
  constructor(
    readonly itemId: string,
    readonly itemKind: NodeKind,
    readonly fields: NodeKindSpecificField[]
  ) {
    super(
      itemKind === 'note'
        ? 'Notes support content but do not have work descriptions, requested status, or planning placement.'
        : 'Tasks and groups support descriptions and requested status but do not have Note content.'
    );
  }
}

export class CommandReceiptConflictError extends Error {
  constructor(readonly commandId: string) {
    super(`Command ${commandId} was already used for a different mutation.`);
  }
}

export class EntityIdConflictError extends Error {
  constructor(
    readonly entityType: 'node' | 'relationship',
    readonly entityId: string
  ) {
    super(`The ${entityType} ID ${entityId} is already in use.`);
  }
}

export class ProjectConflictError extends Error {
  constructor(
    readonly field: 'projectId' | 'referenceKey' | 'initialSettings',
    readonly value: string
  ) {
    super(
      field === 'projectId'
        ? `Project ID ${value} is already assigned to different project metadata.`
        : field === 'referenceKey'
          ? `Project reference key ${value} is already in use.`
          : `Project ${value} already exists with different initial settings.`
    );
  }
}

/** Archived Projects are read-only until restored (ADR 0012). */
export class ProjectArchivedError extends Error {
  constructor(
    readonly projectId: string,
    readonly archivedAt: string
  ) {
    super(`Project ${projectId} is archived. Restore it before making changes.`);
  }
}

/** An applied command also reports its receipt's sequence, which a replay has no need for. */
export type IdempotentCommandResult =
  | { outcome: ProjectCommandOutcome; disposition: 'applied'; sequence: number }
  | { outcome: ProjectCommandOutcome; disposition: 'replayed' };

export type CommandFingerprints = {
  accepted: readonly string[];
  primary: string;
};

export interface ProjectWriter extends ExecutionWriter {
  getProject(): Project;
  isNodeIdReserved(nodeId: string): boolean;
  isRelationshipIdReserved(relationshipId: string): boolean;
  createNode(
    nodeId: string,
    input: Extract<ProjectCommand, { kind: 'create_node' }>['input']
  ): void;
  updateNode(nodeId: string, input: UpdateNodeInput): void;
  moveNodes(input: MoveNodesInput): void;
  deleteNode(nodeId: string, input: DeleteNodeInput): void;
  createRelationship(relationship: GraphRelationship): void;
  deleteRelationship(relationshipId: string): void;
}

export interface ProjectLibraryStore {
  listProjects(query: ProjectLibraryQuery): ProjectSummary[];
  getProjectSummary(projectId: string): ProjectSummary;
  createProject(input: CreateProjectInput): CreateProjectResponse;
  renameProject(projectId: string, name: string): ProjectUpdateResponse;
  archiveProject(projectId: string, archivedAt: string): ProjectUpdateResponse;
  restoreProject(projectId: string): ProjectUpdateResponse;
}

export interface ProjectStore
  extends ProjectLibraryStore, SettingsStore, ExecutionReader, ActivityStore {
  getProject(projectId: string): Project;
  getRelationshipWarnings(projectId: string): GraphWarning[];
  getReservedNodeKind(nodeId: string): NodeKind | null;
  executeIdempotently(
    projectId: string,
    commandId: string,
    fingerprints: CommandFingerprints,
    operation: (writer: ProjectWriter) => ProjectCommandOutcome,
    actor: CommandActor | null
  ): IdempotentCommandResult;
}

export interface ProjectUseCases extends SettingsUseCases, ActivityUseCases {
  queryProjectLibrary(query?: ProjectLibraryQuery): ProjectLibrary;
  createProject(input: CreateProjectInput): CreateProjectResponse;
  renameProject(projectId: string, input: RenameProjectInput): ProjectUpdateResponse;
  archiveProject(projectId: string): ProjectUpdateResponse;
  restoreProject(projectId: string): ProjectUpdateResponse;
  queryProject(projectId: string): ProjectedProject;
  queryExecution(projectId: string): ProjectExecution;
  previewGroupEnablement(projectId: string, groupId: string): GroupEnablePreview;
  executeCommand(
    projectId: string,
    command: ProjectCommandInput,
    actor?: CommandActor | null
  ): ProjectCommandResponse;
  explainNode(projectId: string, nodeLocator: string): NodeExplanation;
}

export class ProjectApplication implements ProjectUseCases {
  constructor(private readonly repository: ProjectStore) {}

  queryProjectLibrary(query: ProjectLibraryQuery = { includeArchived: false }): ProjectLibrary {
    return { projects: this.repository.listProjects(query) };
  }

  createProject(input: CreateProjectInput): CreateProjectResponse {
    return this.repository.createProject(CreateProjectInputSchema.parse(input));
  }

  renameProject(projectId: string, input: RenameProjectInput): ProjectUpdateResponse {
    return this.repository.renameProject(projectId, RenameProjectInputSchema.parse(input).name);
  }

  archiveProject(projectId: string): ProjectUpdateResponse {
    return this.repository.archiveProject(projectId, new Date().toISOString());
  }

  restoreProject(projectId: string): ProjectUpdateResponse {
    return this.repository.restoreProject(projectId);
  }

  queryApplicationPreferences(): ApplicationPreferences {
    return applicationPreferences(this.repository);
  }

  updateApplicationPreference(input: ApplicationPreferenceInput): ApplicationPreferences {
    this.repository.setApplicationPreference(parseApplicationPreferenceInput(input));
    return this.queryApplicationPreferences();
  }

  restoreApplicationPreference(key: ApplicationPreferenceKey): ApplicationPreferences {
    this.repository.restoreApplicationPreference(parseApplicationPreferenceKey(key));
    return this.queryApplicationPreferences();
  }

  queryProjectSettings(projectId: string): EffectiveProjectSettings {
    return effectiveProjectSettings(this.repository, projectId);
  }

  updateProjectSettingOverride(
    projectId: string,
    input: ProjectSettingInput
  ): EffectiveProjectSettings {
    this.repository.setProjectSettingOverride(projectId, parseProjectSettingInput(input));
    return this.queryProjectSettings(projectId);
  }

  clearProjectSettingOverride(projectId: string, key: ProjectSettingKey): EffectiveProjectSettings {
    this.repository.clearProjectSettingOverride(projectId, parseProjectSettingKey(key));
    return this.queryProjectSettings(projectId);
  }

  queryProject(projectId: string): ProjectedProject {
    // Read before the graph, so the graph reflects at least this sequence even if a write lands
    // between the reads; a client may then refresh once too often, but never trusts a stale graph.
    const latestSequence = this.repository.getLatestSequence(projectId);
    return {
      ...projectGraph(
        this.repository.getProject(projectId),
        this.repository.getRelationshipWarnings(projectId)
      ),
      latestSequence
    };
  }

  queryExecution(projectId: string): ProjectExecution {
    return projectExecution(
      this.repository.getProject(projectId),
      this.repository.getExecutionEligibilities(projectId),
      this.repository.getExecutionAttempts(projectId),
      this.repository.getProjectSummary(projectId).archivedAt !== null
    );
  }

  previewGroupEnablement(projectId: string, groupId: string): GroupEnablePreview {
    return previewGroupEnablement(this.repository.getProject(projectId), groupId);
  }

  queryActivity = (projectId: string) => projectActivity(this.repository, projectId);
  queryLibraryActivity = () => libraryActivity(this.repository);
  markActivitySeen = (projectId: string, sequence: number) =>
    this.repository.markActivitySeen(projectId, sequence, new Date().toISOString());
  markLibraryActivitySeen = (input: MarkLibraryActivitySeenInput) =>
    this.repository.markLibraryActivitySeen(
      MarkLibraryActivitySeenInputSchema.parse(input).projects,
      new Date().toISOString()
    );

  executeCommand(
    projectId: string,
    command: ProjectCommandInput,
    actor: CommandActor | null = null
  ): ProjectCommandResponse {
    const parsed = ProjectCommandSchema.parse(command);
    // Attempt commands already name their worker, which is a stronger claim than any header.
    const receiptActor: CommandActor | null =
      'workerId' in parsed ? { kind: 'agent', name: parsed.workerId } : actor;
    const reservedNodeKind =
      parsed.kind === 'update_node' ? this.repository.getReservedNodeKind(parsed.nodeId) : null;
    const fingerprints = commandFingerprints(parsed, reservedNodeKind);
    const apply = (writer: ProjectWriter): ProjectCommandOutcome => {
      switch (parsed.kind) {
        case 'create_node':
          if (writer.isNodeIdReserved(parsed.nodeId)) {
            throw new EntityIdConflictError('node', parsed.nodeId);
          }
          writer.createNode(parsed.nodeId, parsed.input);
          break;
        case 'update_node': {
          const item = writer.getProject().nodes.find(({ id }) => id === parsed.nodeId);
          if (!item) {
            throw new EntityNotFoundError(
              `Canvas item ${parsed.nodeId} does not exist in this project.`
            );
          }
          const invalidFields: CanvasItemConflictError['fields'] = [];
          if (isWorkNode(item)) {
            if (parsed.patch.content !== undefined) invalidFields.push('content');
          } else {
            if (parsed.patch.description !== undefined) invalidFields.push('description');
            if (parsed.patch.requestedStatus !== undefined) {
              invalidFields.push('requestedStatus');
            }
            if (parsed.patch.planningPlacement !== undefined) {
              invalidFields.push('planningPlacement');
            }
          }
          if (invalidFields.length > 0) {
            throw new CanvasItemConflictError(item.id, item.kind, invalidFields);
          }
          writer.updateNode(parsed.nodeId, {
            ...parsed.patch,
            expectedVersion: parsed.expectedVersion
          });
          if (parsed.patch.requestedStatus === 'blocked' && item.kind === 'task') {
            writer.requestExecutionStop(item.id, new Date().toISOString());
          }
          break;
        }
        case 'move_nodes': {
          writer.moveNodes({
            moves: Object.entries(parsed.moves).map(([nodeId, { position, expectedVersion }]) => ({
              nodeId,
              position,
              expectedVersion
            }))
          });
          break;
        }
        case 'delete_node':
          if (
            writer.getProject().nodes.find(({ id }) => id === parsed.nodeId)?.kind === 'task' &&
            writer
              .getExecutionAttempts()
              .some(
                (attempt) =>
                  attempt.taskId === parsed.nodeId &&
                  ['active', 'stop_requested'].includes(attempt.state)
              )
          ) {
            throw new ExecutionConflictError(
              'task_has_active_attempt',
              'Stop and confirm the active Execution Attempt before deleting this Task.',
              { taskId: parsed.nodeId }
            );
          }
          writer.deleteNode(parsed.nodeId, { expectedVersion: parsed.expectedVersion });
          break;
        case 'create_relationship': {
          if (writer.isRelationshipIdReserved(parsed.relationshipId)) {
            throw new EntityIdConflictError('relationship', parsed.relationshipId);
          }
          const relationship: GraphRelationship = {
            id: parsed.relationshipId,
            ...parsed.input,
            createdAt: new Date().toISOString()
          };
          const validation = validateRelationship(writer.getProject(), relationship);
          if (!validation.ok) {
            throw new RelationshipConflictError(validation.message, validation.violation);
          }
          writer.createRelationship(relationship);
          break;
        }
        case 'delete_relationship':
          writer.deleteRelationship(parsed.relationshipId);
          break;
        case 'enable_task_for_agents':
        case 'disable_task_for_agents':
        case 'enable_group_for_agents':
        case 'claim_task':
        case 'heartbeat_attempt':
        case 'record_attempt_progress':
        case 'complete_attempt':
        case 'fail_attempt':
        case 'release_attempt':
        case 'confirm_attempt_stopped':
          return executeExecutionCommand(projectId, writer.getProject(), parsed, writer);
      }
      return projectCommandOutcome(parsed);
    };
    // Effects are judged inside the write transaction against the state the command applies to,
    // so changes made by other commands are never credited to it. Only a command that can change
    // effective status derives them, and its post-write projection is the response. A replay never
    // applies, so it keeps reporting none.
    const derived: { project?: ProjectedProject; effects: ProjectCommandEffects } = {
      effects: noCommandEffects()
    };
    const result = this.repository.executeIdempotently(
      projectId,
      parsed.commandId,
      fingerprints,
      (writer) => {
        if (!canChangeEffectiveStatus(parsed)) return apply(writer);
        const before = projectGraph(writer.getProject());
        const applied = apply(writer);
        derived.project = this.queryProject(projectId);
        derived.effects = { completedGroupIds: completedGroupIds(before, derived.project) };
        return applied;
      },
      receiptActor
    );
    return {
      commandId: parsed.commandId,
      disposition: result.disposition,
      // The in-transaction projection was read before its own receipt existed, so it carries that
      // receipt's sequence explicitly.
      project:
        derived.project && result.disposition === 'applied'
          ? { ...derived.project, latestSequence: result.sequence }
          : this.queryProject(projectId),
      outcome: result.outcome,
      effects: derived.effects
    };
  }

  explainNode(projectId: string, nodeLocator: string): NodeExplanation {
    const project = this.repository.getProject(projectId);
    const normalizedReference = nodeLocator.toUpperCase();
    const nodeId =
      project.nodes.find((node) => node.id === nodeLocator)?.id ??
      project.nodes.find((node) => node.reference === normalizedReference)?.id;
    if (!nodeId) {
      throw new EntityNotFoundError(`Work node ${nodeLocator} does not exist in this project.`);
    }
    const explanation = explainNode(
      project,
      nodeId,
      this.repository.getRelationshipWarnings(projectId)
    );
    if (!explanation) {
      throw new EntityNotFoundError(`Work node ${nodeLocator} does not exist in this project.`);
    }
    return explanation;
  }
}
