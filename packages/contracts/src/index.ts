import { z } from 'zod';
import {
  CanvasItemReferenceSchema,
  GraphNodeSchema,
  GroupSchema,
  ProjectReferenceKeySchema,
  NodeKindSchema,
  NodeKindSpecificFieldSchema,
  NodeStatusSchema,
  NodeTitleSchema,
  NoteSchema,
  PositionSchema,
  TaskSchema,
  type NodeStatus,
  type Note,
  type Position
} from './canvasItems.js';
import { noCommandEffects, ProjectCommandEffectsSchema } from './commandEffects.js';
import { PlanningPlacementSchema, type PlanningPlacement } from './planning.js';
import { ProjectLibraryApiErrorSchemas, ProjectNameSchema } from './projectLibrary.js';
import {
  executionCommandOutcome,
  ExecutionApiErrorSchema,
  ExecutionCommandOutcomeSchemas,
  ExecutionCommandSchemas
} from './execution.js';
export {
  CanvasItemSchema,
  CanvasItemReferenceSchema,
  formatCanvasItemReference,
  GraphNodeSchema,
  isNote,
  isWorkNode,
  NODE_STATUSES,
  NodeKindSchema,
  NodeKindSpecificFieldSchema,
  NodeStatusSchema,
  NodeTitleSchema,
  NoteSchema,
  PositionSchema,
  ProjectReferenceKeySchema,
  WorkNodeKindSchema,
  WorkNodeSchema,
  type CanvasItem,
  type CanvasItemReference,
  type GraphNode,
  type NodeKind,
  type NodeKindSpecificField,
  type NodeStatus,
  type Note,
  type Position,
  type ProjectReferenceKey,
  type WorkNode,
  type WorkNodeKind
} from './canvasItems.js';
export * from './planning.js';
export * from './projectLibrary.js';
export * from './settings.js';
export * from './execution.js';
export * from './commandEffects.js';
export * from './activity.js';
export * from './build.js';
export const RelationshipKindSchema = z.enum(['member_of', 'depends_on']);
export type RelationshipKind = z.infer<typeof RelationshipKindSchema>;
export const RelationshipViolationSchema = z.enum([
  'self_relationship',
  'missing_node',
  'duplicate_relationship',
  'work_node_required',
  'group_required',
  'cycle'
]);
export type RelationshipViolation = z.infer<typeof RelationshipViolationSchema>;
const RelationshipIdentitySchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime()
});
export const MemberOfRelationshipSchema = RelationshipIdentitySchema.extend({
  kind: z.literal('member_of'),
  memberId: z.string().min(1),
  groupId: z.string().min(1)
});
export const DependsOnRelationshipSchema = RelationshipIdentitySchema.extend({
  kind: z.literal('depends_on'),
  dependentId: z.string().min(1),
  dependencyId: z.string().min(1)
});

export const GraphRelationshipSchema = z.discriminatedUnion('kind', [
  MemberOfRelationshipSchema,
  DependsOnRelationshipSchema
]);
export type GraphRelationship = z.infer<typeof GraphRelationshipSchema>;

export const relationshipEndpointIds = (
  relationship: GraphRelationship
): { objectId: string; subjectId: string } =>
  relationship.kind === 'member_of'
    ? { subjectId: relationship.memberId, objectId: relationship.groupId }
    : { subjectId: relationship.dependentId, objectId: relationship.dependencyId };

export const ProjectedRelationshipSchema = z.discriminatedUnion('kind', [
  MemberOfRelationshipSchema.extend({ isBlocking: z.boolean() }),
  DependsOnRelationshipSchema.extend({ isBlocking: z.boolean() })
]);
export type ProjectedRelationship = z.infer<typeof ProjectedRelationshipSchema>;

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: ProjectNameSchema,
  referenceKey: ProjectReferenceKeySchema,
  nodes: z.array(GraphNodeSchema),
  relationships: z.array(GraphRelationshipSchema)
});
export type Project = z.infer<typeof ProjectSchema>;

export const GraphWarningSchema = z.object({
  kind: z.literal('invalid_relationship'),
  relationshipId: z.string().min(1),
  violation: RelationshipViolationSchema,
  message: z.string().min(1)
});
export type GraphWarning = z.infer<typeof GraphWarningSchema>;

const ProjectionFields = {
  effectiveStatus: NodeStatusSchema,
  progress: z.number().min(0).max(1),
  blockedBy: z.array(z.string())
};

export const ProjectedWorkNodeSchema = z.discriminatedUnion('kind', [
  TaskSchema.extend(ProjectionFields).strict(),
  GroupSchema.extend(ProjectionFields).strict()
]);
export type ProjectedWorkNode = z.infer<typeof ProjectedWorkNodeSchema>;

export const ProjectedNoteSchema = NoteSchema;
export type ProjectedNote = Note;

export const ProjectedNodeSchema = z.discriminatedUnion('kind', [
  TaskSchema.extend(ProjectionFields).strict(),
  GroupSchema.extend(ProjectionFields).strict(),
  NoteSchema
]);
export type ProjectedNode = z.infer<typeof ProjectedNodeSchema>;

// Extending replaces the stored nodes and relationships with their projections.
export const ProjectedProjectSchema = ProjectSchema.extend({
  nodes: z.array(ProjectedNodeSchema),
  relationships: z.array(ProjectedRelationshipSchema),
  warnings: z.array(GraphWarningSchema),
  // The newest Command Receipt this graph reflects, so a client can tell when it is behind.
  latestSequence: z.number().int().nonnegative()
});
export type ProjectedProject = z.infer<typeof ProjectedProjectSchema>;

const CreateWorkNodeFields = {
  title: NodeTitleSchema,
  description: z.string().max(20_000).default(''),
  planningPlacement: PlanningPlacementSchema.optional(),
  position: PositionSchema
};

const CreateTaskInputSchema = z
  .object({ ...CreateWorkNodeFields, kind: z.literal('task') })
  .strict();
const CreateGroupInputSchema = z
  .object({ ...CreateWorkNodeFields, kind: z.literal('group') })
  .strict();
const CreateNoteInputSchema = z
  .object({
    title: NodeTitleSchema,
    content: z.string().max(20_000).default(''),
    kind: z.literal('note'),
    position: PositionSchema
  })
  .strict();
export const CreateNodeInputSchema = z.discriminatedUnion('kind', [
  CreateTaskInputSchema,
  CreateGroupInputSchema,
  CreateNoteInputSchema
]);
export type CreateNodeInput = z.input<typeof CreateNodeInputSchema>;

const NodePatchFields = {
  title: NodeTitleSchema.optional(),
  description: z.string().max(20_000).optional(),
  content: z.string().max(20_000).optional(),
  requestedStatus: NodeStatusSchema.optional(),
  planningPlacement: PlanningPlacementSchema.nullable().optional(),
  position: PositionSchema.optional()
};

const hasNodePatch = ({
  title,
  description,
  content,
  requestedStatus,
  planningPlacement,
  position
}: {
  title?: string | undefined;
  description?: string | undefined;
  content?: string | undefined;
  requestedStatus?: NodeStatus | undefined;
  planningPlacement?: PlanningPlacement | null | undefined;
  position?: Position | undefined;
}): boolean =>
  title !== undefined ||
  description !== undefined ||
  content !== undefined ||
  requestedStatus !== undefined ||
  planningPlacement !== undefined ||
  position !== undefined;

export const NodePatchSchema = z
  .object(NodePatchFields)
  .strict()
  .refine(hasNodePatch, { message: 'At least one node field must be updated.' })
  .meta({ minProperties: 1 });
export type NodePatch = z.infer<typeof NodePatchSchema>;

export const UpdateNodeInputSchema = z
  .object({
    ...NodePatchFields,
    expectedVersion: z.number().int().nonnegative()
  })
  .strict()
  .refine(hasNodePatch, { message: 'At least one node field must be updated.' });
export type UpdateNodeInput = z.infer<typeof UpdateNodeInputSchema>;

export const MoveNodeInputSchema = z
  .object({
    nodeId: z.string().min(1),
    position: PositionSchema,
    expectedVersion: z.number().int().nonnegative()
  })
  .strict();
export type MoveNodeInput = z.infer<typeof MoveNodeInputSchema>;

export const MoveNodesInputSchema = z
  .object({ moves: z.array(MoveNodeInputSchema).min(1) })
  .strict()
  .refine(({ moves }) => new Set(moves.map(({ nodeId }) => nodeId)).size === moves.length, {
    message: 'Each node can appear only once in a move command.',
    path: ['moves']
  });
export type MoveNodesInput = z.infer<typeof MoveNodesInputSchema>;

export const DeleteNodeInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative()
  })
  .strict();
export type DeleteNodeInput = z.infer<typeof DeleteNodeInputSchema>;

export const CreateRelationshipInputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('member_of'),
      memberId: z.string().min(1),
      groupId: z.string().min(1)
    })
    .strict(),
  z
    .object({
      kind: z.literal('depends_on'),
      dependentId: z.string().min(1),
      dependencyId: z.string().min(1)
    })
    .strict()
]);
export type CreateRelationshipInput = z.infer<typeof CreateRelationshipInputSchema>;

const CommandMoveSchema = z
  .object({
    position: PositionSchema,
    expectedVersion: z.number().int().nonnegative()
  })
  .strict();

const CommandMovesSchema = z
  .record(z.string().min(1), CommandMoveSchema)
  .refine((moves) => Object.keys(moves).length > 0, {
    message: 'At least one node must be moved.'
  })
  .meta({ minProperties: 1 });

const CommandIdSchema = z.string().uuid();
const CreatedEntityIdSchema = z.string().uuid();

export const ProjectCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('create_node'),
      commandId: CommandIdSchema,
      nodeId: CreatedEntityIdSchema,
      input: CreateNodeInputSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('update_node'),
      commandId: CommandIdSchema,
      nodeId: z.string().min(1),
      expectedVersion: z.number().int().nonnegative(),
      patch: NodePatchSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('move_nodes'),
      commandId: CommandIdSchema,
      moves: CommandMovesSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('delete_node'),
      commandId: CommandIdSchema,
      nodeId: z.string().min(1),
      expectedVersion: z.number().int().nonnegative()
    })
    .strict(),
  z
    .object({
      kind: z.literal('create_relationship'),
      commandId: CommandIdSchema,
      relationshipId: CreatedEntityIdSchema,
      input: CreateRelationshipInputSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('delete_relationship'),
      commandId: CommandIdSchema,
      relationshipId: z.string().min(1)
    })
    .strict(),
  ...ExecutionCommandSchemas
]);
export type ProjectCommand = z.infer<typeof ProjectCommandSchema>;
export type ProjectCommandInput = z.input<typeof ProjectCommandSchema>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeLegacyCreateCommand = (value: unknown): unknown => {
  if (!isRecord(value) || value.kind !== 'create_node' || !isRecord(value.input)) return value;

  const input = value.input;
  if (input.kind === undefined) {
    return { ...value, input: { ...input, kind: 'task' } };
  }
  if (input.kind !== 'note' || 'content' in input || !('description' in input)) return value;

  const { description, ...note } = input;
  return { ...value, input: { ...note, content: description } };
};

// HTTP versions before the standalone Note model omitted `kind` for Tasks and used
// `description` for Note Markdown. Keep that compatibility at the transport boundary;
// every product-facing type and every downstream layer receives only the canonical shape.
export const ProjectCommandTransportSchema = z.preprocess(
  normalizeLegacyCreateCommand,
  ProjectCommandSchema
);

export const ProjectCommandOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node_created'), nodeId: z.string().min(1) }),
  z.object({ kind: z.literal('node_updated'), nodeId: z.string().min(1) }),
  z.object({ kind: z.literal('nodes_moved'), nodeIds: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('node_deleted'), nodeId: z.string().min(1) }),
  z.object({ kind: z.literal('relationship_created'), relationshipId: z.string().min(1) }),
  z.object({ kind: z.literal('relationship_deleted'), relationshipId: z.string().min(1) }),
  ...ExecutionCommandOutcomeSchemas
]);
export type ProjectCommandOutcome = z.infer<typeof ProjectCommandOutcomeSchema>;

export const projectCommandOutcome = (command: ProjectCommand): ProjectCommandOutcome => {
  switch (command.kind) {
    case 'create_node':
      return { kind: 'node_created', nodeId: command.nodeId };
    case 'update_node':
      return { kind: 'node_updated', nodeId: command.nodeId };
    case 'move_nodes':
      return { kind: 'nodes_moved', nodeIds: Object.keys(command.moves).sort() };
    case 'delete_node':
      return { kind: 'node_deleted', nodeId: command.nodeId };
    case 'create_relationship':
      return { kind: 'relationship_created', relationshipId: command.relationshipId };
    case 'delete_relationship':
      return { kind: 'relationship_deleted', relationshipId: command.relationshipId };
    default:
      return executionCommandOutcome(command);
  }
};

export const ProjectCommandResponseSchema = z.object({
  commandId: CommandIdSchema,
  disposition: z.enum(['applied', 'replayed']),
  project: ProjectedProjectSchema,
  outcome: ProjectCommandOutcomeSchema,
  // Servers that predate Command Effects omit them; they reported no effects.
  effects: ProjectCommandEffectsSchema.default(noCommandEffects)
});
export type ProjectCommandResponse = z.infer<typeof ProjectCommandResponseSchema>;

export const projectCommandJsonSchema = () => z.toJSONSchema(ProjectCommandSchema, { io: 'input' });

const RelatedWorkNodeFields = {
  id: z.string().min(1),
  reference: CanvasItemReferenceSchema,
  title: NodeTitleSchema,
  requestedStatus: NodeStatusSchema,
  effectiveStatus: NodeStatusSchema,
  progress: z.number().min(0).max(1)
};

export const RelatedNodeSchema = z.discriminatedUnion('kind', [
  z.object({ ...RelatedWorkNodeFields, kind: z.literal('task') }).strict(),
  z.object({ ...RelatedWorkNodeFields, kind: z.literal('group') }).strict()
]);
export type RelatedNode = z.infer<typeof RelatedNodeSchema>;

const RelationshipContextSchema = z.object({
  relationshipId: z.string().min(1),
  node: RelatedNodeSchema,
  isBlocking: z.boolean()
});

export const NodeStatusBasisSchema = z.enum([
  'requested_status',
  'blocking_relationships',
  'all_members_done',
  'member_statuses'
]);
export type NodeStatusBasis = z.infer<typeof NodeStatusBasisSchema>;

export const NodeBlockerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('blocked_member'),
    relationshipId: z.string().min(1),
    node: RelatedNodeSchema
  }),
  z.object({
    kind: z.literal('blocked_dependency'),
    relationshipId: z.string().min(1),
    node: RelatedNodeSchema
  })
]);
export type NodeBlocker = z.infer<typeof NodeBlockerSchema>;

export const NodeExplanationSchema = z.object({
  projectId: z.string().min(1),
  node: ProjectedWorkNodeSchema,
  status: z.object({
    requested: NodeStatusSchema,
    effective: NodeStatusSchema,
    basis: NodeStatusBasisSchema,
    blockers: z.array(NodeBlockerSchema)
  }),
  progress: z.object({
    value: z.number().min(0).max(1),
    basis: z.enum(['requested_status', 'member_average']),
    members: z.array(
      z.object({
        node: RelatedNodeSchema,
        contribution: z.number().min(0).max(1)
      })
    )
  }),
  relationships: z.object({
    groups: z.array(RelationshipContextSchema),
    members: z.array(RelationshipContextSchema),
    dependencies: z.array(RelationshipContextSchema),
    dependents: z.array(RelationshipContextSchema)
  })
});
export type NodeExplanation = z.infer<typeof NodeExplanationSchema>;

const ApiErrorMessageSchema = z.string().min(1);
export const ValidationIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string().min(1),
  message: z.string().min(1)
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ApiErrorSchema = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('validation_error'),
    error: ApiErrorMessageSchema,
    details: z.object({ issues: z.array(ValidationIssueSchema) })
  }),
  z.object({
    code: z.literal('not_found'),
    error: ApiErrorMessageSchema
  }),
  z.object({
    code: z.literal('version_conflict'),
    error: ApiErrorMessageSchema,
    details: z.object({ currentVersion: z.number().int().nonnegative() })
  }),
  z.object({
    code: z.literal('relationship_conflict'),
    error: ApiErrorMessageSchema,
    details: z.object({ violation: RelationshipViolationSchema })
  }),
  z.object({
    code: z.literal('canvas_item_conflict'),
    error: ApiErrorMessageSchema,
    details: z.object({
      itemId: z.string().min(1),
      itemKind: NodeKindSchema,
      fields: z.array(NodeKindSpecificFieldSchema).min(1)
    })
  }),
  z.object({
    code: z.literal('command_conflict'),
    error: ApiErrorMessageSchema,
    details: z.object({ commandId: CommandIdSchema })
  }),
  z.object({
    code: z.literal('entity_conflict'),
    error: ApiErrorMessageSchema,
    details: z.object({
      entityType: z.enum(['node', 'relationship']),
      entityId: z.string().min(1)
    })
  }),
  ...ProjectLibraryApiErrorSchemas,
  ExecutionApiErrorSchema,
  z.object({
    code: z.literal('invalid_json'),
    error: ApiErrorMessageSchema
  }),
  z.object({
    code: z.literal('unexpected'),
    error: ApiErrorMessageSchema
  })
]);
export type ApiError = z.infer<typeof ApiErrorSchema>;
