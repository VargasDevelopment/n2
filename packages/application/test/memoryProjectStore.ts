import type {
  CreateProjectInput,
  CreateProjectResponse,
  GraphNode,
  GraphRelationship,
  GraphWarning,
  MoveNodesInput,
  Project,
  ProjectCommand,
  ProjectSettingOverrides,
  ProjectSummary,
  ProjectUpdateResponse,
  ApplicationPreferenceInput,
  ApplicationPreferenceKey,
  ProjectSettingInput,
  ProjectSettingKey,
  StoredApplicationPreferences,
  UpdateNodeInput
} from '@n2/contracts';
import {
  CommandReceiptConflictError,
  VersionConflictError,
  type CommandFingerprints,
  type IdempotentCommandResult,
  type ProjectStore,
  type ProjectWriter,
  type StoredExecutionAttempt,
  type StoredExecutionEligibility
} from '../src/index.js';

const timestamp = '2026-08-23T00:00:00.000Z';

const node = (id: string, reference: string, title: string): GraphNode => ({
  id,
  reference,
  title,
  description: '',
  kind: 'task',
  requestedStatus: 'ready',
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: timestamp,
  updatedAt: timestamp
});

/** An in-memory ProjectStore for exercising ProjectApplication without SQLite. */
export class MemoryProjectStore implements ProjectStore, ProjectWriter {
  private readonly receipts = new Map<
    string,
    { fingerprint: string; result: IdempotentCommandResult }
  >();
  private readonly nodeIds = new Set(['local', 'agent', 'N2-2']);
  private readonly nodeKinds = new Map<string, GraphNode['kind']>([
    ['local', 'task'],
    ['agent', 'task'],
    ['N2-2', 'task']
  ]);
  private readonly relationshipIds = new Set(['local-before-agent']);
  private applicationPreferenceValues: StoredApplicationPreferences = {};
  private projectSettingOverrides: ProjectSettingOverrides = {};
  private executionEligibilities: StoredExecutionEligibility[] = [];
  private executionAttempts: StoredExecutionAttempt[] = [];
  private readonly enablementIds = new Set<string>();
  private project: Project = {
    id: 'default',
    name: 'Test project',
    referenceKey: 'N2',
    nodes: [
      node('local', 'N2-1', 'Local persistence'),
      node('agent', 'N2-2', 'Agent commands'),
      node('N2-2', 'N2-3', 'Canonical ID collision')
    ],
    relationships: [
      {
        id: 'local-before-agent',
        kind: 'depends_on',
        dependentId: 'agent',
        dependencyId: 'local',
        createdAt: timestamp
      }
    ]
  };

  private archivedAt: string | null = null;
  private lifecycleRevision = 0;

  listProjects(): ProjectSummary[] {
    return [this.getProjectSummary(this.project.id)];
  }

  getProjectSummary(projectId: string): ProjectSummary {
    this.getProject(projectId);
    return {
      id: this.project.id,
      name: this.project.name,
      referenceKey: this.project.referenceKey,
      canvasItemCount: this.project.nodes.length,
      archivedAt: this.archivedAt,
      lifecycleRevision: this.lifecycleRevision
    };
  }

  renameProject(projectId: string, name: string): ProjectUpdateResponse {
    this.project = { ...this.getProject(projectId), name };
    this.lifecycleRevision += 1;
    return { disposition: 'updated', project: this.getProjectSummary(projectId) };
  }

  archiveProject(projectId: string, archivedAt: string): ProjectUpdateResponse {
    this.getProject(projectId);
    this.archivedAt ??= archivedAt;
    this.lifecycleRevision += 1;
    return { disposition: 'updated', project: this.getProjectSummary(projectId) };
  }

  restoreProject(projectId: string): ProjectUpdateResponse {
    this.archivedAt = null;
    this.lifecycleRevision += 1;
    return { disposition: 'updated', project: this.getProjectSummary(projectId) };
  }

  createProject(input: CreateProjectInput): CreateProjectResponse {
    if (input.projectId === this.project.id) {
      if (input.name !== this.project.name || input.referenceKey !== this.project.referenceKey) {
        throw new Error('Conflicting project identity.');
      }
      return { disposition: 'existing', project: this.listProjects()[0]! };
    }
    this.project = {
      id: input.projectId,
      name: input.name,
      referenceKey: input.referenceKey,
      nodes: [],
      relationships: []
    };
    this.projectSettingOverrides = input.settings ?? {};
    return { disposition: 'created', project: this.listProjects()[0]! };
  }

  getApplicationPreferenceValues(): StoredApplicationPreferences {
    return { ...this.applicationPreferenceValues };
  }

  setApplicationPreference(input: ApplicationPreferenceInput): void {
    this.applicationPreferenceValues = {
      ...this.applicationPreferenceValues,
      [input.key]: input.value
    };
  }

  restoreApplicationPreference(key: ApplicationPreferenceKey): void {
    const next = { ...this.applicationPreferenceValues };
    delete next[key];
    this.applicationPreferenceValues = next;
  }

  getProjectSettingOverrides(projectId: string): ProjectSettingOverrides {
    this.getProject(projectId);
    return { ...this.projectSettingOverrides };
  }

  setProjectSettingOverride(projectId: string, input: ProjectSettingInput): void {
    this.getProject(projectId);
    this.projectSettingOverrides = { ...this.projectSettingOverrides, [input.key]: input.value };
  }

  clearProjectSettingOverride(projectId: string, key: ProjectSettingKey): void {
    this.getProject(projectId);
    const next = { ...this.projectSettingOverrides };
    delete next[key];
    this.projectSettingOverrides = next;
  }

  getProject(projectId = this.project.id): Project {
    if (projectId !== this.project.id) throw new Error(`Project ${projectId} does not exist.`);
    return structuredClone(this.project);
  }

  getRelationshipWarnings(): GraphWarning[] {
    return [];
  }

  getExecutionEligibilities(): StoredExecutionEligibility[] {
    return structuredClone(this.executionEligibilities);
  }

  getExecutionEligibility(taskId: string): StoredExecutionEligibility | null {
    return structuredClone(
      this.executionEligibilities.find((eligibility) => eligibility.taskId === taskId) ?? null
    );
  }

  saveExecutionEligibility(value: StoredExecutionEligibility): void {
    this.executionEligibilities = this.executionEligibilities.filter(
      ({ taskId }) => taskId !== value.taskId
    );
    this.executionEligibilities.push(structuredClone(value));
  }

  getExecutionAttempts(): StoredExecutionAttempt[] {
    return structuredClone(this.executionAttempts);
  }

  getExecutionAttempt(attemptId: string): StoredExecutionAttempt | null {
    return structuredClone(
      this.executionAttempts.find((attempt) => attempt.attemptId === attemptId) ?? null
    );
  }

  isExecutionAttemptIdReserved(attemptId: string): boolean {
    return this.executionAttempts.some((attempt) => attempt.attemptId === attemptId);
  }

  isEnablementIdReserved(enablementId: string): boolean {
    return this.enablementIds.has(enablementId);
  }

  reserveEnablementId(enablementId: string): void {
    this.enablementIds.add(enablementId);
  }

  createExecutionAttempt(value: StoredExecutionAttempt): void {
    this.executionAttempts.push(structuredClone(value));
  }

  requestExecutionStop(taskId: string, requestedAt: string): void {
    this.executionAttempts = this.executionAttempts.map((attempt) =>
      attempt.taskId === taskId && attempt.state === 'active'
        ? { ...attempt, state: 'stop_requested', stopRequestedAt: requestedAt }
        : attempt
    );
  }

  heartbeatExecutionAttempt(attemptId: string, heartbeatAt: string): void {
    this.executionAttempts = this.executionAttempts.map((attempt) =>
      attempt.attemptId === attemptId ? { ...attempt, heartbeatAt } : attempt
    );
  }

  progressExecutionAttempt(attemptId: string, progress: string, heartbeatAt: string): void {
    this.executionAttempts = this.executionAttempts.map((attempt) =>
      attempt.attemptId === attemptId ? { ...attempt, progress, heartbeatAt } : attempt
    );
  }

  finishExecutionAttempt(
    attemptId: string,
    state: 'completed' | 'failed' | 'released' | 'stopped',
    progress: string | undefined,
    finishedAt: string
  ): void {
    this.executionAttempts = this.executionAttempts.map((attempt) =>
      attempt.attemptId === attemptId
        ? {
            ...attempt,
            state,
            ...(progress === undefined ? {} : { progress }),
            heartbeatAt: finishedAt,
            finishedAt
          }
        : attempt
    );
  }

  getReservedNodeKind(nodeId: string): GraphNode['kind'] | null {
    return this.nodeKinds.get(nodeId) ?? null;
  }

  isNodeIdReserved(nodeId: string): boolean {
    return this.nodeIds.has(nodeId);
  }

  isRelationshipIdReserved(relationshipId: string): boolean {
    return this.relationshipIds.has(relationshipId);
  }

  // Project Activity is exercised against SQLite and as a pure derivation, not through this fake.
  getActivityHistory = () => ({ receipts: [], enablements: [] });
  getLatestSequence = () => this.receipts.size;
  getSeenMarker = () => null;
  markActivitySeen = (_projectId: string, sequence: number, seenAt: string) => ({
    sequence,
    seenAt
  });
  markLibraryActivitySeen = (marks: { projectId: string; sequence: number }[], seenAt: string) => ({
    projects: marks.map(({ projectId, sequence }) => ({ projectId, seen: { sequence, seenAt } }))
  });

  executeIdempotently(
    _projectId: string,
    commandId: string,
    fingerprints: CommandFingerprints,
    operation: (writer: ProjectWriter) => IdempotentCommandResult['outcome']
  ): IdempotentCommandResult {
    const receipt = this.receipts.get(commandId);
    if (receipt) {
      if (!fingerprints.accepted.includes(receipt.fingerprint)) {
        throw new CommandReceiptConflictError(commandId);
      }
      return { outcome: receipt.result.outcome, disposition: 'replayed' };
    }
    const projectBefore = structuredClone(this.project);
    const nodeIdsBefore = new Set(this.nodeIds);
    const nodeKindsBefore = new Map(this.nodeKinds);
    const relationshipIdsBefore = new Set(this.relationshipIds);
    const executionEligibilitiesBefore = structuredClone(this.executionEligibilities);
    const executionAttemptsBefore = structuredClone(this.executionAttempts);
    const enablementIdsBefore = new Set(this.enablementIds);
    try {
      const result: IdempotentCommandResult = {
        outcome: operation(this),
        disposition: 'applied',
        sequence: this.receipts.size + 1
      };
      this.receipts.set(commandId, { fingerprint: fingerprints.primary, result });
      return result;
    } catch (cause) {
      this.project = projectBefore;
      this.nodeIds.clear();
      for (const nodeId of nodeIdsBefore) this.nodeIds.add(nodeId);
      this.nodeKinds.clear();
      for (const [nodeId, kind] of nodeKindsBefore) this.nodeKinds.set(nodeId, kind);
      this.relationshipIds.clear();
      for (const relationshipId of relationshipIdsBefore) this.relationshipIds.add(relationshipId);
      this.executionEligibilities = executionEligibilitiesBefore;
      this.executionAttempts = executionAttemptsBefore;
      this.enablementIds.clear();
      for (const enablementId of enablementIdsBefore) this.enablementIds.add(enablementId);
      throw cause;
    }
  }

  createNode(
    nodeId: string,
    input: Extract<ProjectCommand, { kind: 'create_node' }>['input']
  ): GraphNode {
    const identity = {
      id: nodeId,
      reference: `N2-${this.project.nodes.length + 1}`,
      title: input.title,
      position: input.position,
      version: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const created: GraphNode =
      input.kind === 'note'
        ? { ...identity, kind: input.kind, content: input.content }
        : {
            ...identity,
            kind: input.kind,
            description: input.description,
            requestedStatus: 'ready',
            ...(input.planningPlacement ? { planningPlacement: input.planningPlacement } : {})
          };
    this.project.nodes.push(created);
    this.nodeIds.add(nodeId);
    this.nodeKinds.set(nodeId, input.kind);
    return structuredClone(created);
  }

  updateNode(nodeId: string, input: UpdateNodeInput): GraphNode {
    const index = this.project.nodes.findIndex(({ id }) => id === nodeId);
    const current = this.project.nodes[index];
    if (!current) throw new Error(`Missing node ${nodeId}`);
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError(current.version);
    }
    let updated: GraphNode;
    if (current.kind === 'note') {
      updated = {
        ...current,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.position === undefined ? {} : { position: input.position }),
        content: input.content ?? current.content,
        version: current.version + 1
      };
    } else {
      const { planningPlacement: currentPlacement, ...currentWithoutPlacement } = current;
      const nextPlacement =
        input.planningPlacement === undefined ? currentPlacement : input.planningPlacement;
      updated = {
        ...currentWithoutPlacement,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.position === undefined ? {} : { position: input.position }),
        description: input.description ?? current.description,
        requestedStatus: input.requestedStatus ?? current.requestedStatus,
        ...(nextPlacement ? { planningPlacement: nextPlacement } : {}),
        version: current.version + 1
      };
    }
    this.project.nodes[index] = updated;
    return structuredClone(updated);
  }

  moveNodes(input: MoveNodesInput): GraphNode[] {
    return input.moves.map(({ nodeId, position, expectedVersion }) =>
      this.updateNode(nodeId, { position, expectedVersion })
    );
  }

  deleteNode(nodeId: string): void {
    this.project.nodes = this.project.nodes.filter(({ id }) => id !== nodeId);
    this.project.relationships = this.project.relationships.filter((relationship) =>
      relationship.kind === 'member_of'
        ? relationship.memberId !== nodeId && relationship.groupId !== nodeId
        : relationship.dependentId !== nodeId && relationship.dependencyId !== nodeId
    );
  }

  createRelationship(relationship: GraphRelationship): void {
    this.project.relationships.push(structuredClone(relationship));
    this.relationshipIds.add(relationship.id);
  }

  deleteRelationship(relationshipId: string): void {
    this.project.relationships = this.project.relationships.filter(
      ({ id }) => id !== relationshipId
    );
  }
}
