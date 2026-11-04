import { z } from 'zod';
import { ProjectReferenceKeySchema } from './canvasItems.js';
import { ProjectSettingOverridesSchema } from './settings.js';

export const ProjectNameSchema = z.string().trim().min(1).max(120);

export const ProjectSummarySchema = z.object({
  id: z.string().min(1),
  name: ProjectNameSchema,
  referenceKey: ProjectReferenceKeySchema,
  canvasItemCount: z.number().int().nonnegative(),
  /** When the Project was archived; `null` while it is unarchived. */
  archivedAt: z.string().datetime().nullable(),
  /**
   * Increases with every committed rename, archive, or restore, so a client can tell which of two
   * summaries is newer no matter which tab, CLI, or response delivered it (ADR 0012).
   */
  lifecycleRevision: z.number().int().nonnegative()
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectLibrarySchema = z.object({
  projects: z.array(ProjectSummarySchema)
});
export type ProjectLibrary = z.infer<typeof ProjectLibrarySchema>;

/** Archived Projects are excluded from Library listings unless a caller explicitly asks. */
export type ProjectLibraryQuery = { includeArchived: boolean };

export const CreateProjectInputSchema = z
  .object({
    projectId: z.string().uuid(),
    name: ProjectNameSchema,
    referenceKey: ProjectReferenceKeySchema,
    settings: ProjectSettingOverridesSchema.optional()
  })
  .strict();
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const CreateProjectResponseSchema = z.object({
  disposition: z.enum(['created', 'existing']),
  project: ProjectSummarySchema
});
export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>;

export const RenameProjectInputSchema = z.object({ name: ProjectNameSchema }).strict();
export type RenameProjectInput = z.infer<typeof RenameProjectInputSchema>;

/** Rename, archive, and restore are idempotent; `unchanged` reports a successful no-op. */
export const ProjectUpdateResponseSchema = z.object({
  disposition: z.enum(['updated', 'unchanged']),
  project: ProjectSummarySchema
});
export type ProjectUpdateResponse = z.infer<typeof ProjectUpdateResponseSchema>;

export const ProjectLibraryApiErrorSchemas = [
  z.object({
    code: z.literal('project_conflict'),
    error: z.string().min(1),
    details: z.object({
      field: z.enum(['projectId', 'referenceKey', 'initialSettings']),
      value: z.string().min(1)
    })
  }),
  z.object({
    code: z.literal('project_archived'),
    error: z.string().min(1),
    details: z.object({ projectId: z.string().min(1), archivedAt: z.string().datetime() })
  })
] as const;
