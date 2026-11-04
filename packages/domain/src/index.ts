import {
  isWorkNode,
  relationshipEndpointIds,
  type GraphRelationship,
  type GraphWarning,
  type NodeBlocker,
  type NodeExplanation,
  type NodeStatus,
  type Project,
  type ProjectedWorkNode,
  type ProjectedProject,
  type ProjectedRelationship,
  type RelationshipViolation
} from '@n2/contracts';

export * from './canvasItemRules.js';

type Metric = Pick<ProjectedWorkNode, 'effectiveStatus' | 'progress' | 'blockedBy'> & {
  statusBasis: NodeExplanation['status']['basis'];
  progressBasis: NodeExplanation['progress']['basis'];
};

/** The projected graph alone; the application adds the receipt sequence it reflects. */
export type ProjectGraph = Omit<ProjectedProject, 'latestSequence'>;

type ProjectDerivation = {
  project: ProjectGraph;
  metricByNodeId: Map<string, Metric>;
};

type GraphIndexes = {
  childrenByParent: Map<string, string[]>;
  prerequisitesByNode: Map<string, string[]>;
  metricDependencies: Map<string, string[]>;
};

export type RelationshipValidation =
  { ok: true } | { ok: false; violation: RelationshipViolation; message: string };

const append = (index: Map<string, string[]>, key: string, value: string): void => {
  const values = index.get(key) ?? [];
  values.push(value);
  index.set(key, values);
};

function indexGraph(project: Project): GraphIndexes {
  const nodeIds = new Set(project.nodes.filter(isWorkNode).map(({ id }) => id));
  const childrenByParent = new Map<string, string[]>();
  const prerequisitesByNode = new Map<string, string[]>();
  const metricDependencies = new Map<string, string[]>();
  for (const relationship of project.relationships) {
    const { objectId, subjectId } = relationshipEndpointIds(relationship);
    if (!nodeIds.has(subjectId)) {
      continue;
    }
    if (!nodeIds.has(objectId)) {
      continue;
    }

    if (relationship.kind === 'member_of') {
      append(childrenByParent, relationship.groupId, relationship.memberId);
      append(metricDependencies, relationship.groupId, relationship.memberId);
    } else {
      append(prerequisitesByNode, relationship.dependentId, relationship.dependencyId);
      append(metricDependencies, relationship.dependentId, relationship.dependencyId);
    }
  }

  for (const values of childrenByParent.values()) values.sort();
  for (const values of prerequisitesByNode.values()) values.sort();
  for (const values of metricDependencies.values()) values.sort();

  return { childrenByParent, prerequisitesByNode, metricDependencies };
}

function hasCycle(dependencies: Map<string, string[]>): boolean {
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (nodeId: string): boolean => {
    if (visited.has(nodeId)) return false;
    if (visiting.has(nodeId)) return true;

    visiting.add(nodeId);
    for (const dependencyId of dependencies.get(nodeId) ?? []) {
      if (visit(dependencyId)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  const allNodeIds = new Set([...dependencies.keys(), ...dependencies.values()].flat());
  return [...allNodeIds].some(visit);
}

export function canonicalizeProjectRelationships(project: Project): {
  project: Project;
  warnings: GraphWarning[];
} {
  const relationships: GraphRelationship[] = [];
  const warnings: GraphWarning[] = [];
  const candidates = [...project.relationships].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  );

  for (const relationship of candidates) {
    const validation = validateRelationship({ ...project, relationships }, relationship);
    if (validation.ok) {
      relationships.push(relationship);
    } else {
      warnings.push({
        kind: 'invalid_relationship',
        relationshipId: relationship.id,
        violation: validation.violation,
        message: validation.message
      });
    }
  }

  const acceptedIds = new Set(relationships.map(({ id }) => id));
  return {
    project: {
      ...project,
      relationships: project.relationships.filter(({ id }) => acceptedIds.has(id))
    },
    warnings
  };
}

function deriveProjectGraph(
  project: Project,
  quarantinedWarnings: GraphWarning[] = []
): ProjectDerivation {
  const canonical = canonicalizeProjectRelationships(project);
  const validProject = canonical.project;
  const workNodes = validProject.nodes.filter(isWorkNode);
  const nodeById = new Map(workNodes.map((node) => [node.id, node]));
  const indexes = indexGraph(validProject);
  const memo = new Map<string, Metric>();

  const deriveNode = (nodeId: string): Metric => {
    const existing = memo.get(nodeId);
    if (existing) return existing;

    const node = nodeById.get(nodeId);
    if (!node) throw new Error(`Cannot derive missing node ${nodeId}.`);
    const childIds = indexes.childrenByParent.get(nodeId) ?? [];
    const prerequisiteIds = indexes.prerequisitesByNode.get(nodeId) ?? [];
    const childMetrics = childIds.map((id) => deriveNode(id));
    const prerequisiteMetrics = prerequisiteIds.map((id) => deriveNode(id));
    const blockedBy = [
      ...prerequisiteIds.filter(
        (_, index) => prerequisiteMetrics[index]?.effectiveStatus === 'blocked'
      ),
      ...childIds.filter((_, index) => childMetrics[index]?.effectiveStatus === 'blocked')
    ];

    const progress = childMetrics.length
      ? childMetrics.reduce((total, child) => total + child.progress, 0) / childMetrics.length
      : node.requestedStatus === 'done'
        ? 1
        : 0;

    let effectiveStatus: NodeStatus;
    let statusBasis: Metric['statusBasis'];
    if (node.requestedStatus === 'blocked') {
      effectiveStatus = 'blocked';
      statusBasis = 'requested_status';
    } else if (blockedBy.length > 0) {
      effectiveStatus = 'blocked';
      statusBasis = 'blocking_relationships';
    } else if (
      childMetrics.length > 0 &&
      childMetrics.every(({ effectiveStatus: status }) => status === 'done')
    ) {
      effectiveStatus = 'done';
      statusBasis = 'all_members_done';
    } else if (node.requestedStatus === 'in_progress') {
      effectiveStatus = 'in_progress';
      statusBasis = 'requested_status';
    } else if (
      childMetrics.some(
        ({ effectiveStatus: status }) => status === 'in_progress' || status === 'done'
      )
    ) {
      effectiveStatus = 'in_progress';
      statusBasis = 'member_statuses';
    } else if (childMetrics.length === 0 && node.requestedStatus === 'done') {
      effectiveStatus = 'done';
      statusBasis = 'requested_status';
    } else {
      effectiveStatus = 'ready';
      statusBasis =
        childMetrics.length > 0 && node.requestedStatus === 'done'
          ? 'member_statuses'
          : 'requested_status';
    }

    const metric: Metric = {
      effectiveStatus,
      progress,
      blockedBy,
      statusBasis,
      progressBasis: childMetrics.length > 0 ? 'member_average' : 'requested_status'
    };
    memo.set(nodeId, metric);
    return metric;
  };

  const metricByNodeId = new Map(workNodes.map((node) => [node.id, deriveNode(node.id)]));
  const projectedNodes = validProject.nodes.map((node) => {
    if (!isWorkNode(node)) return node;
    const metric = metricByNodeId.get(node.id);
    if (!metric) throw new Error(`Node ${node.id} was not derived.`);
    const { effectiveStatus, progress, blockedBy } = metric;
    return { ...node, effectiveStatus, progress, blockedBy };
  });
  const projectedRelationships: ProjectedRelationship[] = validProject.relationships.map(
    (relationship) =>
      relationship.kind === 'member_of'
        ? {
            ...relationship,
            isBlocking: metricByNodeId.get(relationship.memberId)?.effectiveStatus === 'blocked'
          }
        : {
            ...relationship,
            isBlocking: metricByNodeId.get(relationship.dependencyId)?.effectiveStatus === 'blocked'
          }
  );

  return {
    project: {
      ...project,
      nodes: projectedNodes,
      relationships: projectedRelationships,
      warnings: [...quarantinedWarnings, ...canonical.warnings]
    },
    metricByNodeId
  };
}

export function projectGraph(
  project: Project,
  quarantinedWarnings: GraphWarning[] = []
): ProjectGraph {
  return deriveProjectGraph(project, quarantinedWarnings).project;
}

/**
 * The Group Completions of one Project Command: Groups whose effective status became done between
 * the state the command was applied to and the state it produced. Groups not inside another
 * completed Group come first, so a cascade leads with the Group that matters most. Takes both
 * projections so a caller can reuse the one it already derived.
 */
export function completedGroupIds(before: ProjectGraph, after: ProjectGraph): string[] {
  const doneBefore = new Map(
    before.nodes.filter(isWorkNode).map((node) => [node.id, node.effectiveStatus === 'done'])
  );
  const completed = new Set(
    after.nodes
      .filter(
        (node) =>
          node.kind === 'group' &&
          node.effectiveStatus === 'done' &&
          doneBefore.get(node.id) === false
      )
      .map(({ id }) => id)
  );
  const insideAnotherCompleted = new Set(
    after.relationships.flatMap((relationship) =>
      relationship.kind === 'member_of' && completed.has(relationship.groupId)
        ? [relationship.memberId]
        : []
    )
  );
  return [...completed].sort(
    (left, right) =>
      Number(insideAnotherCompleted.has(left)) - Number(insideAnotherCompleted.has(right))
  );
}

const relatedNode = (node: ProjectedWorkNode) => ({
  id: node.id,
  reference: node.reference,
  title: node.title,
  kind: node.kind,
  requestedStatus: node.requestedStatus,
  effectiveStatus: node.effectiveStatus,
  progress: node.progress
});

export function explainNode(
  source: Project,
  nodeId: string,
  quarantinedWarnings: GraphWarning[] = []
): NodeExplanation | undefined {
  const { project, metricByNodeId } = deriveProjectGraph(source, quarantinedWarnings);
  const node = project.nodes.find(({ id }) => id === nodeId);
  if (!node || !isWorkNode(node)) return undefined;
  const metric = metricByNodeId.get(nodeId);
  if (!metric) throw new Error(`Node ${nodeId} was projected without a derivation.`);

  const nodeById = new Map(project.nodes.map((candidate) => [candidate.id, candidate]));
  const context = (
    relationshipId: string,
    relatedNodeId: string,
    isBlocking: boolean
  ): NodeExplanation['relationships']['members'][number] | undefined => {
    const candidate = nodeById.get(relatedNodeId);
    return candidate && isWorkNode(candidate)
      ? { relationshipId, node: relatedNode(candidate), isBlocking }
      : undefined;
  };
  const groups: NodeExplanation['relationships']['groups'] = [];
  const members: NodeExplanation['relationships']['members'] = [];
  const dependencies: NodeExplanation['relationships']['dependencies'] = [];
  const dependents: NodeExplanation['relationships']['dependents'] = [];
  const blockers: NodeBlocker[] = [];

  for (const relationship of project.relationships) {
    if (relationship.kind === 'member_of') {
      if (relationship.memberId === nodeId) {
        const item = context(relationship.id, relationship.groupId, relationship.isBlocking);
        if (item) groups.push(item);
      }
      if (relationship.groupId === nodeId) {
        const item = context(relationship.id, relationship.memberId, relationship.isBlocking);
        if (item) {
          members.push(item);
          if (relationship.isBlocking) {
            blockers.push({
              kind: 'blocked_member',
              relationshipId: relationship.id,
              node: item.node
            });
          }
        }
      }
    } else {
      if (relationship.dependentId === nodeId) {
        const item = context(relationship.id, relationship.dependencyId, relationship.isBlocking);
        if (item) {
          dependencies.push(item);
          if (relationship.isBlocking) {
            blockers.push({
              kind: 'blocked_dependency',
              relationshipId: relationship.id,
              node: item.node
            });
          }
        }
      }
      if (relationship.dependencyId === nodeId) {
        const item = context(relationship.id, relationship.dependentId, relationship.isBlocking);
        if (item) dependents.push(item);
      }
    }
  }

  const byRelationshipId = (
    left: { relationshipId: string },
    right: { relationshipId: string }
  ): number => left.relationshipId.localeCompare(right.relationshipId);
  groups.sort(byRelationshipId);
  members.sort(byRelationshipId);
  dependencies.sort(byRelationshipId);
  dependents.sort(byRelationshipId);
  blockers.sort(byRelationshipId);

  return {
    projectId: project.id,
    node,
    status: {
      requested: node.requestedStatus,
      effective: node.effectiveStatus,
      basis: metric.statusBasis,
      blockers
    },
    progress: {
      value: node.progress,
      basis: metric.progressBasis,
      members: members.map(({ node: member }) => ({
        node: member,
        contribution: member.progress
      }))
    },
    relationships: { groups, members, dependencies, dependents }
  };
}

export function wouldCreateCycle(project: Project, candidate: GraphRelationship): boolean {
  const withCandidate = {
    ...project,
    relationships: [...project.relationships, candidate]
  };
  const { metricDependencies } = indexGraph(withCandidate);
  return hasCycle(metricDependencies);
}

export function validateRelationship(
  project: Project,
  candidate: GraphRelationship
): RelationshipValidation {
  const { objectId, subjectId } = relationshipEndpointIds(candidate);
  if (subjectId === objectId) {
    return {
      ok: false,
      violation: 'self_relationship',
      message: 'A node cannot be related to itself.'
    };
  }

  const nodeById = new Map(project.nodes.map((node) => [node.id, node]));
  const subject = nodeById.get(subjectId);
  const object = nodeById.get(objectId);
  if (!subject || !object) {
    return {
      ok: false,
      violation: 'missing_node',
      message: 'Both ends of a relationship must exist in this project.'
    };
  }

  if (!isWorkNode(subject) || !isWorkNode(object)) {
    return {
      ok: false,
      violation: 'work_node_required',
      message: 'Relationships can connect only tasks and groups; notes stand alone.'
    };
  }

  if (
    project.relationships.some((relationship) => {
      if (relationship.kind !== candidate.kind) return false;
      const endpoints = relationshipEndpointIds(relationship);
      return endpoints.subjectId === subjectId && endpoints.objectId === objectId;
    })
  ) {
    return {
      ok: false,
      violation: 'duplicate_relationship',
      message: 'That relationship already exists.'
    };
  }

  if (candidate.kind === 'member_of') {
    if (object.kind !== 'group') {
      return {
        ok: false,
        violation: 'group_required',
        message: 'A node can only be part of a group.'
      };
    }
  }

  if (wouldCreateCycle(project, candidate)) {
    return {
      ok: false,
      violation: 'cycle',
      message: 'That relationship would create a graph cycle.'
    };
  }

  return { ok: true };
}
