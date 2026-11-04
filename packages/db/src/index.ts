import {
  formatCanvasItemReference,
  ProjectCommandOutcomeSchema,
  type CreateProjectInput,
  type CreateProjectResponse,
  type DeleteNodeInput,
  type GraphNode,
  type GraphRelationship,
  type GraphWarning,
  type MoveNodesInput,
  type ProjectCommand,
  type ProjectCommandOutcome,
  type ProjectLibraryQuery,
  type ProjectSummary,
  type ProjectUpdateResponse,
  type ProjectSettingOverrides,
  type ApplicationPreferenceInput,
  type ApplicationPreferenceKey,
  type ProjectSettingInput,
  type ProjectSettingKey,
  type StoredApplicationPreferences,
  type UpdateNodeInput,
  type Project,
  type CommandActor
} from '@n2/contracts';
import {
  EntityNotFoundError,
  CommandReceiptConflictError,
  VersionConflictError,
  type CommandFingerprints,
  type IdempotentCommandResult,
  type ProjectStore,
  type ProjectWriter
} from '@n2/application';
import type { StoredExecutionAttempt, StoredExecutionEligibility } from '@n2/application';
import * as activity from './activityRepository.js';
import { initialRequestedStatus } from '@n2/domain';
import type Database from 'better-sqlite3';
export { backupDatabase } from './backup.js';
export { LATEST_SCHEMA_VERSION } from './schemaMigrations.js';
export type { LibraryOpening } from './databaseFile.js';
import { databaseReadiness, openDatabase, type LibraryOpening } from './databaseFile.js';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrateDatabase } from './schemaMigrations.js';
import { toGraphNode, toGraphRelationship } from './graphRows.js';
import { planningColumns } from './planningPersistence.js';
import {
  archiveProject,
  createProject,
  inProjectWriteTransaction,
  listProjectSummaries,
  renameProject,
  requireProjectRow,
  requireProjectSummary,
  restoreProject,
  type WritableProject
} from './projectLibraryRepository.js';
import {
  clearProjectSettingOverride,
  getApplicationPreferenceValues,
  getProjectSettingOverrides,
  restoreApplicationPreference,
  setApplicationPreference,
  setProjectSettingOverride
} from './settingsRepository.js';
import {
  commandReceipts,
  edges,
  entityIdReservations,
  nodes,
  relationshipQuarantines,
  schema,
  workspaces
} from './schema.js';
import { DEFAULT_PROJECT_ID, initializeStarterProject } from './starterProject.js';
import {
  createExecutionAttempt,
  finishExecutionAttempt,
  getExecutionAttempt,
  getExecutionAttempts,
  getExecutionEligibilities,
  getExecutionEligibility,
  heartbeatExecutionAttempt,
  isEnablementIdReserved,
  isExecutionAttemptIdReserved,
  progressExecutionAttempt,
  reserveEnablementId,
  requestExecutionStop,
  saveExecutionEligibility
} from './executionRepository.js';
export class ProjectRepository implements ProjectStore {
  readonly #sqlite: Database.Database;
  readonly #db: BetterSQLite3Database<typeof schema>;
  // Connection options let tests interleave two connections at a chosen statement.
  constructor(
    databasePath: string,
    options: { opening?: LibraryOpening } & Pick<Database.Options, 'timeout' | 'verbose'> = {}
  ) {
    const { opening = 'unchecked', ...connection } = options;
    this.#sqlite = openDatabase(databasePath, opening, connection);
    this.#db = drizzle(this.#sqlite, { schema });
    migrateDatabase(this.#sqlite);
    initializeStarterProject(this.#sqlite, this.#db);
  }
  close = (): void => {
    this.#sqlite.close();
  };
  readiness = (): { schemaVersion: number } => databaseReadiness(this.#sqlite);
  listProjects = (query: ProjectLibraryQuery): ProjectSummary[] =>
    listProjectSummaries(this.#db, query);
  getProjectSummary = (projectId: string): ProjectSummary =>
    requireProjectSummary(this.#db, projectId);
  createProject = (input: CreateProjectInput): CreateProjectResponse =>
    createProject(this.#sqlite, this.#db, input);
  renameProject = (projectId: string, name: string): ProjectUpdateResponse =>
    renameProject(this.#sqlite, this.#db, projectId, name);
  archiveProject = (projectId: string, archivedAt: string): ProjectUpdateResponse =>
    archiveProject(this.#sqlite, this.#db, projectId, archivedAt);
  restoreProject = (projectId: string): ProjectUpdateResponse =>
    restoreProject(this.#sqlite, this.#db, projectId);
  getApplicationPreferenceValues = (): StoredApplicationPreferences =>
    getApplicationPreferenceValues(this.#db);

  setApplicationPreference = (input: ApplicationPreferenceInput): void =>
    setApplicationPreference(this.#db, input);

  restoreApplicationPreference = (key: ApplicationPreferenceKey): void =>
    restoreApplicationPreference(this.#db, key);

  getProjectSettingOverrides = (projectId: string): ProjectSettingOverrides => {
    requireProjectRow(this.#db, projectId);
    return getProjectSettingOverrides(this.#db, projectId);
  };

  setProjectSettingOverride = (projectId: string, input: ProjectSettingInput): void =>
    inProjectWriteTransaction(this.#sqlite, this.#db, projectId, ({ writable }) =>
      setProjectSettingOverride(this.#db, writable(), input)
    );

  clearProjectSettingOverride = (projectId: string, key: ProjectSettingKey): void =>
    inProjectWriteTransaction(this.#sqlite, this.#db, projectId, ({ writable }) =>
      clearProjectSettingOverride(this.#db, writable(), key)
    );

  getProject(projectId = DEFAULT_PROJECT_ID): Project {
    const project = requireProjectRow(this.#db, projectId);
    const quarantinedRelationshipIds = new Set(
      this.#db
        .select({ relationshipId: relationshipQuarantines.relationshipId })
        .from(relationshipQuarantines)
        .where(eq(relationshipQuarantines.workspaceId, projectId))
        .all()
        .map(({ relationshipId }) => relationshipId)
    );

    return {
      id: project.id,
      name: project.name,
      referenceKey: project.referenceKey,
      nodes: this.#db
        .select()
        .from(nodes)
        .where(eq(nodes.workspaceId, projectId))
        .all()
        .map(toGraphNode),
      relationships: this.#db
        .select()
        .from(edges)
        .where(eq(edges.workspaceId, projectId))
        .all()
        .filter(({ id }) => !quarantinedRelationshipIds.has(id))
        .map(toGraphRelationship)
    };
  }
  getRelationshipWarnings(projectId = DEFAULT_PROJECT_ID): GraphWarning[] {
    requireProjectRow(this.#db, projectId);
    return this.#db
      .select()
      .from(relationshipQuarantines)
      .where(eq(relationshipQuarantines.workspaceId, projectId))
      .all()
      .map((row) => ({
        kind: 'invalid_relationship',
        relationshipId: row.relationshipId,
        violation: row.violation,
        message: row.message
      }));
  }
  getActivityHistory = (projectId: string) => activity.getActivityHistory(this.#db, projectId);
  getLatestSequence = (projectId: string) => activity.latestSequence(this.#db, projectId);
  getSeenMarker = (projectId: string) => activity.getSeenMarker(this.#db, projectId);
  markActivitySeen = (projectId: string, sequence: number, seenAt: string) =>
    activity.markActivitySeen(this.#db, projectId, sequence, seenAt);
  markLibraryActivitySeen = (marks: { projectId: string; sequence: number }[], seenAt: string) =>
    activity.markLibraryActivitySeen(this.#sqlite, this.#db, marks, seenAt);
  getExecutionEligibilities(projectId: string): StoredExecutionEligibility[] {
    requireProjectRow(this.#db, projectId);
    return getExecutionEligibilities(this.#db, projectId);
  }
  getExecutionAttempts(projectId: string): StoredExecutionAttempt[] {
    requireProjectRow(this.#db, projectId);
    return getExecutionAttempts(this.#db, projectId);
  }
  getReservedNodeKind(nodeId: string): GraphNode['kind'] | null {
    return (
      this.#db
        .select({ nodeKind: entityIdReservations.nodeKind })
        .from(entityIdReservations)
        .where(
          and(
            eq(entityIdReservations.entityType, 'node'),
            eq(entityIdReservations.entityId, nodeId)
          )
        )
        .get()?.nodeKind ?? null
    );
  }
  #isNodeIdReserved(nodeId: string): boolean {
    return (
      this.#db
        .select({ id: entityIdReservations.entityId })
        .from(entityIdReservations)
        .where(
          and(
            eq(entityIdReservations.entityType, 'node'),
            eq(entityIdReservations.entityId, nodeId)
          )
        )
        .get() !== undefined
    );
  }

  #isRelationshipIdReserved(relationshipId: string): boolean {
    return (
      this.#db
        .select({ id: entityIdReservations.entityId })
        .from(entityIdReservations)
        .where(
          and(
            eq(entityIdReservations.entityType, 'relationship'),
            eq(entityIdReservations.entityId, relationshipId)
          )
        )
        .get() !== undefined
    );
  }

  executeIdempotently(
    projectId: string,
    commandId: string,
    fingerprints: CommandFingerprints,
    operation: (writer: ProjectWriter) => ProjectCommandOutcome,
    actor: CommandActor | null
  ): IdempotentCommandResult {
    return inProjectWriteTransaction(
      this.#sqlite,
      this.#db,
      projectId,
      ({ writable }): IdempotentCommandResult => {
        const receipt = this.#db
          .select()
          .from(commandReceipts)
          .where(
            and(
              eq(commandReceipts.workspaceId, projectId),
              eq(commandReceipts.commandId, commandId)
            )
          )
          .get();
        // A committed command replays before the Archived Project guard, so retries stay stable.
        if (receipt) {
          if (!fingerprints.accepted.includes(receipt.fingerprint)) {
            throw new CommandReceiptConflictError(commandId);
          }
          return {
            outcome: ProjectCommandOutcomeSchema.parse(JSON.parse(receipt.outcome)),
            disposition: 'replayed'
          };
        }

        const outcome = ProjectCommandOutcomeSchema.parse(operation(this.#writer(writable())));
        const columns = activity.receiptActivityColumns(this.#db, projectId, actor);
        this.#db
          .insert(commandReceipts)
          .values({
            workspaceId: projectId,
            commandId,
            fingerprint: fingerprints.primary,
            outcome: JSON.stringify(outcome),
            createdAt: new Date().toISOString(),
            ...columns
          })
          .run();
        return { outcome, disposition: 'applied', sequence: columns.sequence };
      }
    );
  }

  // Requiring the writability proof means no command can write to an Archived Project.
  #writer({ id: projectId }: WritableProject): ProjectWriter {
    return {
      getProject: () => this.getProject(projectId),
      isNodeIdReserved: (nodeId) => this.#isNodeIdReserved(nodeId),
      isRelationshipIdReserved: (relationshipId) => this.#isRelationshipIdReserved(relationshipId),
      createNode: (nodeId, input) => this.#createNode(nodeId, input, projectId),
      updateNode: (nodeId, input) => this.#updateNode(nodeId, input, projectId),
      moveNodes: (input) => this.#moveNodes(input, projectId),
      deleteNode: (nodeId, input) => this.#deleteNode(nodeId, input, projectId),
      createRelationship: (relationship) => this.#createRelationship(relationship, projectId),
      deleteRelationship: (relationshipId) => this.#deleteRelationship(relationshipId, projectId),
      getExecutionEligibility: (taskId) => getExecutionEligibility(this.#db, projectId, taskId),
      getExecutionAttempt: (attemptId) => getExecutionAttempt(this.#db, projectId, attemptId),
      isEnablementIdReserved: (enablementId) => isEnablementIdReserved(this.#db, enablementId),
      isExecutionAttemptIdReserved: (attemptId) =>
        isExecutionAttemptIdReserved(this.#db, attemptId),
      getExecutionAttempts: () => getExecutionAttempts(this.#db, projectId),
      saveExecutionEligibility: (value) => saveExecutionEligibility(this.#db, projectId, value),
      reserveEnablementId: (enablementId, taskId, timestamp) =>
        reserveEnablementId(this.#db, projectId, enablementId, taskId, timestamp),
      requestExecutionStop: (taskId, timestamp) =>
        requestExecutionStop(this.#db, projectId, taskId, timestamp),
      createExecutionAttempt: (attempt) => createExecutionAttempt(this.#db, projectId, attempt),
      heartbeatExecutionAttempt: (attemptId, timestamp) =>
        heartbeatExecutionAttempt(this.#db, projectId, attemptId, timestamp),
      progressExecutionAttempt: (attemptId, progress, timestamp) =>
        progressExecutionAttempt(this.#db, projectId, attemptId, progress, timestamp),
      finishExecutionAttempt: (attemptId, state, progress, timestamp) =>
        finishExecutionAttempt(this.#db, projectId, attemptId, state, progress, timestamp)
    };
  }

  #createNode(
    nodeId: string,
    input: Extract<ProjectCommand, { kind: 'create_node' }>['input'],
    projectId: string
  ): void {
    const timestamp = new Date().toISOString();
    const project = requireProjectRow(this.#db, projectId);
    const reference = formatCanvasItemReference(project.referenceKey, project.nextCanvasItemNumber);
    const allocation = this.#db
      .update(workspaces)
      .set({ nextCanvasItemNumber: sql`${workspaces.nextCanvasItemNumber} + 1` })
      .where(
        and(
          eq(workspaces.id, projectId),
          eq(workspaces.nextCanvasItemNumber, project.nextCanvasItemNumber)
        )
      )
      .run();
    if (allocation.changes !== 1) {
      throw new Error(
        `Could not allocate the next Canvas Item Reference for project ${projectId}.`
      );
    }
    this.#db
      .insert(entityIdReservations)
      .values({
        entityType: 'node',
        entityId: nodeId,
        nodeKind: input.kind,
        reference,
        createdAt: timestamp
      })
      .run();
    this.#db
      .insert(nodes)
      .values({
        id: nodeId,
        reference,
        workspaceId: projectId,
        title: input.title,
        description: input.kind === 'note' ? null : input.description,
        content: input.kind === 'note' ? input.content : null,
        kind: input.kind,
        requestedStatus: initialRequestedStatus(input.kind),
        ...planningColumns(input.kind === 'note' ? null : input.planningPlacement),
        positionX: input.position.x,
        positionY: input.position.y,
        version: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run();
  }

  #updateNode(nodeId: string, input: UpdateNodeInput, projectId: string): void {
    const current = this.#getNode(nodeId, projectId);
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError(current.version);
    }

    const nextVersion = current.version + 1;
    const result = this.#db
      .update(nodes)
      .set({
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.content === undefined ? {} : { content: input.content }),
        ...(input.requestedStatus === undefined ? {} : { requestedStatus: input.requestedStatus }),
        ...(input.planningPlacement === undefined ? {} : planningColumns(input.planningPlacement)),
        ...(input.position === undefined
          ? {}
          : { positionX: input.position.x, positionY: input.position.y }),
        version: nextVersion,
        updatedAt: new Date().toISOString()
      })
      .where(
        and(
          eq(nodes.id, nodeId),
          eq(nodes.workspaceId, projectId),
          eq(nodes.version, input.expectedVersion)
        )
      )
      .run();

    if (result.changes !== 1) {
      const latest = this.#getNode(nodeId, projectId);
      throw new VersionConflictError(latest.version);
    }
  }

  #moveNodes(input: MoveNodesInput, projectId: string): void {
    for (const { nodeId, position, expectedVersion } of input.moves) {
      this.#updateNode(nodeId, { position, expectedVersion }, projectId);
    }
  }

  #deleteNode(nodeId: string, input: DeleteNodeInput, projectId: string): void {
    const current = this.#getNode(nodeId, projectId);
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError(current.version);
    }

    const result = this.#db
      .delete(nodes)
      .where(
        and(
          eq(nodes.id, nodeId),
          eq(nodes.workspaceId, projectId),
          eq(nodes.version, input.expectedVersion)
        )
      )
      .run();

    if (result.changes !== 1) {
      const latest = this.#getNode(nodeId, projectId);
      throw new VersionConflictError(latest.version);
    }
  }

  #createRelationship(relationship: GraphRelationship, projectId: string): void {
    const source =
      relationship.kind === 'member_of' ? relationship.memberId : relationship.dependentId;
    const target =
      relationship.kind === 'member_of' ? relationship.groupId : relationship.dependencyId;
    this.#db
      .insert(entityIdReservations)
      .values({
        entityType: 'relationship',
        entityId: relationship.id,
        createdAt: relationship.createdAt
      })
      .run();
    this.#db
      .insert(edges)
      .values({
        id: relationship.id,
        workspaceId: projectId,
        source,
        target,
        kind: relationship.kind,
        createdAt: relationship.createdAt
      })
      .run();
  }

  #deleteRelationship(relationshipId: string, projectId: string): void {
    const result = this.#db
      .delete(edges)
      .where(and(eq(edges.id, relationshipId), eq(edges.workspaceId, projectId)))
      .run();

    if (result.changes !== 1) {
      throw new EntityNotFoundError(
        `Relationship ${relationshipId} does not exist in this project.`
      );
    }
  }

  #getNode(nodeId: string, projectId: string): GraphNode {
    const row = this.#db
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, nodeId), eq(nodes.workspaceId, projectId)))
      .get();
    if (!row) throw new EntityNotFoundError(`Node ${nodeId} does not exist in this project.`);
    return toGraphNode(row);
  }
}
