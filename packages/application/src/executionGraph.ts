import {
  ExecutionInputSnapshotSchema,
  isWorkNode,
  type ExecutionInputSnapshot,
  type GraphRelationship,
  type Project,
  type ProjectedProject
} from '@n2/contracts';
import { projectGraph } from '@n2/domain';

// Execution reads of the derived graph: what a Task depends on and what it sees at claim time.

type DependsOnRelationship = Extract<GraphRelationship, { kind: 'depends_on' }>;
export const isDependsOn = (
  relationship: GraphRelationship
): relationship is DependsOnRelationship => relationship.kind === 'depends_on';

type ProjectedNodeById = ReadonlyMap<string, ProjectedProject['nodes'][number]>;

// Deriving validates the whole graph, so callers derive once and pass the map to every per-Task
// helper; deriving per Task made the execution view cubic on large Groups.
export const projectedNodeById = (project: Project): ProjectedNodeById =>
  new Map(projectGraph(project).nodes.map((node) => [node.id, node]));

export const inputSnapshot = (
  project: Project,
  taskId: string,
  projected: ProjectedNodeById
): ExecutionInputSnapshot => {
  const task = project.nodes.find(({ id }) => id === taskId);
  if (task?.kind !== 'task') throw new Error(`Task ${taskId} disappeared.`);
  const related = (nodeId: string) => {
    const node = projected.get(nodeId);
    if (!node || !isWorkNode(node)) throw new Error(`Related Work Node ${nodeId} disappeared.`);
    return {
      id: node.id,
      reference: node.reference,
      title: node.title,
      requestedStatus: node.requestedStatus,
      effectiveStatus: node.effectiveStatus
    };
  };
  return ExecutionInputSnapshotSchema.parse({
    taskId,
    reference: task.reference,
    title: task.title,
    description: task.description,
    dependencies: project.relationships
      .filter(isDependsOn)
      .filter((relationship) => relationship.dependentId === taskId)
      .map(({ dependencyId }) => related(dependencyId))
      .sort((left, right) => left.id.localeCompare(right.id)),
    dependents: project.relationships
      .filter(isDependsOn)
      .filter((relationship) => relationship.dependencyId === taskId)
      .map(({ dependentId }) => related(dependentId))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
};

export const unfinishedDependencyIds = (
  project: Project,
  taskId: string,
  projected: ProjectedNodeById
): string[] => {
  return project.relationships
    .filter(isDependsOn)
    .filter((relationship) => relationship.dependentId === taskId)
    .map(({ dependencyId }) => dependencyId)
    .filter((dependencyId) => {
      const dependency = projected.get(dependencyId);
      return !dependency || !isWorkNode(dependency) || dependency.effectiveStatus !== 'done';
    })
    .sort();
};
