import { z } from 'zod';
import { CanvasItemReferenceSchema, NodeKindSchema, NodeStatusSchema } from './canvasItems.js';
import { PlanningPlacementSchema } from './planning.js';

/**
 * Who issued a Project Command. Adapters declare it; the single-owner trust boundary means it is
 * attribution, not authentication. Receipts written before actors were recorded have none.
 */
export const CommandActorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person') }).strict(),
  z.object({ kind: z.literal('agent'), name: z.string().trim().min(1).max(240) }).strict()
]);
export type CommandActor = z.infer<typeof CommandActorSchema>;

export const COMMAND_ACTOR_HEADER = 'n2-actor';

// `person`, or `agent:<url-encoded name>` so any agent name survives an HTTP header.
export const formatCommandActorHeader = (actor: CommandActor): string =>
  actor.kind === 'person' ? 'person' : `agent:${encodeURIComponent(actor.name)}`;

export const parseCommandActorHeader = (value: string | undefined): CommandActor | null => {
  if (value === undefined) return null;
  if (value === 'person') return { kind: 'person' };
  if (!value.startsWith('agent:')) return null;
  try {
    const parsed = CommandActorSchema.safeParse({
      kind: 'agent',
      name: decodeURIComponent(value.slice('agent:'.length))
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const ActivitySubjectSchema = z
  .object({
    id: z.string().min(1),
    // Null when the item predates References or was deleted before the feed could see one.
    reference: CanvasItemReferenceSchema.nullable(),
    title: z.string(),
    kind: NodeKindSchema,
    // False once the Canvas Item has been deleted, so the UI never offers to open it.
    present: z.boolean()
  })
  .strict();
export type ActivitySubject = z.infer<typeof ActivitySubjectSchema>;

const AttemptEventSchema = z.enum([
  'claimed',
  'progress',
  'completed',
  'failed',
  'released',
  'stopped'
]);
export type ActivityAttemptEvent = z.infer<typeof AttemptEventSchema>;

// `from` is null when the earlier value is unknown, e.g. the item predates Command Receipts.
export const ActivityChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('created') }).strict(),
  z.object({ kind: z.literal('deleted') }).strict(),
  z.object({ kind: z.literal('renamed'), from: z.string().nullable(), to: z.string() }).strict(),
  z
    .object({
      kind: z.literal('status_requested'),
      from: NodeStatusSchema.nullable(),
      to: NodeStatusSchema
    })
    .strict(),
  z.object({ kind: z.literal('text_edited'), edits: z.number().int().positive() }).strict(),
  z
    .object({
      kind: z.literal('placement_changed'),
      to: PlanningPlacementSchema.nullable()
    })
    .strict(),
  z
    .object({
      kind: z.literal('relationship'),
      change: z.enum(['added', 'removed']),
      // Read from the subject: it became a member of, or now depends on, the other item.
      relationship: z.enum(['member_of', 'depends_on']),
      other: ActivitySubjectSchema
    })
    .strict(),
  z.object({ kind: z.literal('agent_eligibility'), enabled: z.boolean() }).strict(),
  z
    .object({
      kind: z.literal('attempt'),
      event: AttemptEventSchema,
      // The worker's latest progress note or failure reason in this entry, if any.
      note: z.string().nullable()
    })
    .strict()
]);
export type ActivityChange = z.infer<typeof ActivityChangeSchema>;

export const ActivityEntrySchema = z
  .object({
    subject: ActivitySubjectSchema,
    lastSequence: z.number().int().positive(),
    at: z.string().datetime(),
    commandCount: z.number().int().positive(),
    changes: z.array(ActivityChangeSchema).min(1)
  })
  .strict();
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;

export const ActivityRunSchema = z
  .object({
    actor: CommandActorSchema.nullable(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    firstSequence: z.number().int().positive(),
    lastSequence: z.number().int().positive(),
    // New to the Person: after the Seen Marker and not their own. Decided once, by the server.
    unseen: z.boolean(),
    entries: z.array(ActivityEntrySchema).min(1)
  })
  .strict();
export type ActivityRun = z.infer<typeof ActivityRunSchema>;

export const SeenMarkerSchema = z
  .object({ sequence: z.number().int().nonnegative(), seenAt: z.string().datetime() })
  .strict();
export type SeenMarker = z.infer<typeof SeenMarkerSchema>;

export const ProjectActivitySchema = z
  .object({
    projectId: z.string().min(1),
    // The newest command this response was read at. Every subject's title and presence is as of
    // this sequence, older entries included, so a link waits for a graph at least this new.
    latestSequence: z.number().int().nonnegative(),
    seen: SeenMarkerSchema.nullable(),
    // Canvas Items changed by someone other than the person since the Seen Marker.
    unseenItemCount: z.number().int().nonnegative(),
    runs: z.array(ActivityRunSchema),
    hasEarlier: z.boolean()
  })
  .strict();
export type ProjectActivity = z.infer<typeof ProjectActivitySchema>;

export const LibraryActivityRunSchema = ActivityRunSchema.extend({
  projectId: z.string().min(1)
}).strict();
export type LibraryActivityRun = z.infer<typeof LibraryActivityRunSchema>;

/** Where one Project's activity was read up to, which is what closing the Library feed marks seen. */
export const LibraryActivityProjectSchema = ProjectActivitySchema.pick({
  projectId: true,
  latestSequence: true,
  seen: true,
  unseenItemCount: true
}).strict();
export type LibraryActivityProject = z.infer<typeof LibraryActivityProjectSchema>;

/**
 * Library Activity: every unarchived Project's activity in one feed, newest first. Each Project is
 * read exactly as Project Activity reads it, so every new run is here; only context is cut short.
 * Each Project appears once and every run names one of them, so a client can join a run to where
 * its Project was read without a fallback.
 */
export const LibraryActivitySchema = z
  .object({
    projects: z.array(LibraryActivityProjectSchema),
    runs: z.array(LibraryActivityRunSchema),
    hasEarlier: z.boolean()
  })
  .strict()
  .superRefine(({ projects, runs }, context) => {
    const ids = new Set(projects.map(({ projectId }) => projectId));
    if (ids.size !== projects.length) {
      context.addIssue({
        code: 'custom',
        message: 'Each Project can appear only once in Library Activity.',
        path: ['projects']
      });
    }
    runs.forEach(({ projectId }, index) => {
      if (ids.has(projectId)) return;
      context.addIssue({
        code: 'custom',
        message: `Run names Project ${projectId}, which Library Activity does not list.`,
        path: ['runs', index, 'projectId']
      });
    });
  });
export type LibraryActivity = z.infer<typeof LibraryActivitySchema>;

export const MarkActivitySeenInputSchema = z
  .object({ sequence: z.number().int().nonnegative() })
  .strict();
export type MarkActivitySeenInput = z.infer<typeof MarkActivitySeenInputSchema>;

export const MarkLibraryActivitySeenInputSchema = z
  .object({
    projects: z
      .array(
        z
          .object({ projectId: z.string().min(1), sequence: z.number().int().nonnegative() })
          .strict()
      )
      .min(1)
  })
  .strict();
export type MarkLibraryActivitySeenInput = z.infer<typeof MarkLibraryActivitySeenInputSchema>;

// The markers that moved. An archived Project is skipped, so it is absent rather than an error.
export const LibrarySeenMarkersSchema = z
  .object({
    projects: z.array(z.object({ projectId: z.string().min(1), seen: SeenMarkerSchema }).strict())
  })
  .strict();
export type LibrarySeenMarkers = z.infer<typeof LibrarySeenMarkersSchema>;
