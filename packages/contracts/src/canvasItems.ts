import { z } from 'zod';
import { PlanningPlacementSchema } from './planning.js';

export const NodeStatusSchema = z.enum(['ready', 'in_progress', 'blocked', 'done']);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;
export const NODE_STATUSES: readonly NodeStatus[] = NodeStatusSchema.options;

export const NodeKindSchema = z.enum(['task', 'group', 'note']);
export type NodeKind = z.infer<typeof NodeKindSchema>;
export const WorkNodeKindSchema = z.enum(['task', 'group']);
export type WorkNodeKind = z.infer<typeof WorkNodeKindSchema>;

export const NodeKindSpecificFieldSchema = z.enum([
  'description',
  'content',
  'requestedStatus',
  'planningPlacement'
]);
export type NodeKindSpecificField = z.infer<typeof NodeKindSpecificFieldSchema>;

export const PositionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite()
  })
  .strict();
export type Position = z.infer<typeof PositionSchema>;

export const NodeTitleSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^\S(?:[\s\S]*\S)?$/, 'Node titles cannot start or end with whitespace.');

export const ProjectReferenceKeySchema = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9]{1,9}$/,
    'Project reference keys must be 2–10 uppercase letters or numbers and start with a letter.'
  );
export type ProjectReferenceKey = z.infer<typeof ProjectReferenceKeySchema>;

export const CanvasItemReferenceSchema = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9]{1,9}-[1-9]\d*$/,
    'Canvas Item References must contain a Project reference key and positive sequence number.'
  );
export type CanvasItemReference = z.infer<typeof CanvasItemReferenceSchema>;

export const formatCanvasItemReference = (
  projectReferenceKey: ProjectReferenceKey,
  sequenceNumber: number
): CanvasItemReference =>
  CanvasItemReferenceSchema.parse(
    `${projectReferenceKey}-${z.number().int().positive().parse(sequenceNumber)}`
  );

const CanvasItemFields = {
  id: z.string().min(1),
  reference: CanvasItemReferenceSchema,
  title: NodeTitleSchema,
  position: PositionSchema,
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
};

const WorkNodeFields = {
  ...CanvasItemFields,
  description: z.string().max(20_000),
  requestedStatus: NodeStatusSchema,
  planningPlacement: PlanningPlacementSchema.optional()
};

export const TaskSchema = z.object({ ...WorkNodeFields, kind: z.literal('task') }).strict();
export const GroupSchema = z.object({ ...WorkNodeFields, kind: z.literal('group') }).strict();

export const WorkNodeSchema = z.discriminatedUnion('kind', [TaskSchema, GroupSchema]);
export type WorkNode = z.infer<typeof WorkNodeSchema>;

export const NoteSchema = z
  .object({
    ...CanvasItemFields,
    kind: z.literal('note'),
    content: z.string().max(20_000)
  })
  .strict();
export type Note = z.infer<typeof NoteSchema>;

export const CanvasItemSchema = z.discriminatedUnion('kind', [TaskSchema, GroupSchema, NoteSchema]);
export type CanvasItem = z.infer<typeof CanvasItemSchema>;

// GraphNode remains a compatibility name for the persisted graph vertex. Product code should use
// CanvasItem or WorkNode to preserve the domain distinction.
export const GraphNodeSchema = CanvasItemSchema;
export type GraphNode = CanvasItem;

export const isWorkNode = <T extends { kind: NodeKind }>(
  item: T
): item is Extract<T, { kind: WorkNodeKind }> => item.kind !== 'note';

export const isNote = <T extends { kind: NodeKind }>(
  item: T
): item is Extract<T, { kind: 'note' }> => item.kind === 'note';
