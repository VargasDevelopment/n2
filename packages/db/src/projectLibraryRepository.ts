import {
  EntityNotFoundError,
  ExecutionConflictError,
  ProjectArchivedError,
  ProjectConflictError
} from '@n2/application';
import type {
  CreateProjectInput,
  CreateProjectResponse,
  ProjectLibraryQuery,
  ProjectSummary,
  ProjectUpdateResponse
} from '@n2/contracts';
import type Database from 'better-sqlite3';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { executionAttempts, nodes, workspaces } from './schema.js';
import type { schema } from './schema.js';
import { initialSettingsFingerprint, writeProjectSettingOverrides } from './settingsRepository.js';

type N2Database = BetterSQLite3Database<typeof schema>;
type ProjectRow = typeof workspaces.$inferSelect;

export const requireProjectRow = (db: N2Database, projectId: string): ProjectRow => {
  const project = db.select().from(workspaces).where(eq(workspaces.id, projectId)).get();
  if (!project) throw new EntityNotFoundError(`Project ${projectId} does not exist.`);
  return project;
};

declare const writableProof: unique symbol;
/**
 * A Project row proven unarchived while its connection holds the database write lock. Every
 * Project-scoped write (the command writer and Project Settings) requires one, and only this module
 * can produce it, so a write cannot skip the Archived Project guard (ADR 0012).
 */
export type WritableProject = ProjectRow & { readonly [writableProof]: true };

// Callers have already opened BEGIN IMMEDIATE, so no other connection can archive in between.
const writable = (project: ProjectRow): WritableProject => {
  if (project.archivedAt !== null) throw new ProjectArchivedError(project.id, project.archivedAt);
  return project as WritableProject;
};

export type ProjectWriteScope = {
  /** The Project as read under the write lock, archived or not. */
  readonly project: ProjectRow;
  /** Rejects an Archived Project and proves writability for the rest of this transaction. */
  readonly writable: () => WritableProject;
};

/**
 * The single path for writing to an existing Project. BEGIN IMMEDIATE takes the write lock before
 * the Project is read, so lifecycle state cannot change between that read and the dependent write;
 * a deferred transaction would instead fail with SQLITE_BUSY_SNAPSHOT or act on stale state.
 */
export const inProjectWriteTransaction = <T>(
  sqlite: Database.Database,
  db: N2Database,
  projectId: string,
  write: (scope: ProjectWriteScope) => T
): T => {
  // Nested in an outer transaction this would become a savepoint without its own write lock.
  if (sqlite.inTransaction) throw new Error('Project writes must open their own transaction.');
  return sqlite
    .transaction((): T => {
      const project = requireProjectRow(db, projectId);
      return write({
        project,
        writable: () => {
          if (!sqlite.inTransaction) throw new Error('Project write scope used after commit.');
          return writable(project);
        }
      });
    })
    .immediate();
};

const projectSummaryQuery = (db: N2Database) =>
  db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      referenceKey: workspaces.referenceKey,
      canvasItemCount: count(nodes.id),
      archivedAt: workspaces.archivedAt,
      lifecycleRevision: workspaces.lifecycleRevision
    })
    .from(workspaces)
    .leftJoin(nodes, eq(nodes.workspaceId, workspaces.id))
    .groupBy(workspaces.id)
    .$dynamic();

export const listProjectSummaries = (
  db: N2Database,
  { includeArchived }: ProjectLibraryQuery
): ProjectSummary[] =>
  projectSummaryQuery(db)
    .where(includeArchived ? undefined : isNull(workspaces.archivedAt))
    .orderBy(asc(workspaces.name), asc(workspaces.id))
    .all();

export const requireProjectSummary = (db: N2Database, projectId: string): ProjectSummary => {
  const summary = projectSummaryQuery(db).where(eq(workspaces.id, projectId)).get();
  if (!summary) throw new EntityNotFoundError(`Project ${projectId} does not exist.`);
  return summary;
};

export const createProject = (
  sqlite: Database.Database,
  db: N2Database,
  input: CreateProjectInput
): CreateProjectResponse =>
  sqlite
    .transaction(() => {
      const existing = db.select().from(workspaces).where(eq(workspaces.id, input.projectId)).get();
      if (existing) {
        if (existing.name !== input.name || existing.referenceKey !== input.referenceKey) {
          throw new ProjectConflictError('projectId', input.projectId);
        }
        if (existing.initialSettings !== initialSettingsFingerprint(input.settings)) {
          throw new ProjectConflictError('initialSettings', input.projectId);
        }
        // A retry reports the stored Project as-is; it never restores an Archived Project.
        return {
          disposition: 'existing' as const,
          project: requireProjectSummary(db, input.projectId)
        };
      }
      if (
        db
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.referenceKey, input.referenceKey))
          .get()
      ) {
        throw new ProjectConflictError('referenceKey', input.referenceKey);
      }

      db.insert(workspaces)
        .values({
          id: input.projectId,
          name: input.name,
          referenceKey: input.referenceKey,
          nextCanvasItemNumber: 1,
          initialSettings: initialSettingsFingerprint(input.settings)
        })
        .run();
      writeProjectSettingOverrides(
        db,
        writable(requireProjectRow(db, input.projectId)),
        input.settings ?? {}
      );
      return {
        disposition: 'created' as const,
        project: requireProjectSummary(db, input.projectId)
      };
    })
    .immediate();

/** Applies one idempotent lifecycle change, reporting `unchanged` when already satisfied. */
const transitionProject = (
  sqlite: Database.Database,
  db: N2Database,
  projectId: string,
  change: (scope: ProjectWriteScope) => Partial<Pick<ProjectRow, 'name' | 'archivedAt'>> | null
): ProjectUpdateResponse =>
  inProjectWriteTransaction(sqlite, db, projectId, (scope): ProjectUpdateResponse => {
    const values = change(scope);
    if (values) {
      db.update(workspaces)
        .set({ ...values, lifecycleRevision: sql`${workspaces.lifecycleRevision} + 1` })
        .where(eq(workspaces.id, projectId))
        .run();
    }
    return {
      disposition: values ? 'updated' : 'unchanged',
      project: requireProjectSummary(db, projectId)
    };
  });

export const renameProject = (
  sqlite: Database.Database,
  db: N2Database,
  projectId: string,
  name: string
): ProjectUpdateResponse =>
  transitionProject(sqlite, db, projectId, (scope) =>
    scope.writable().name === name ? null : { name }
  );

export const archiveProject = (
  sqlite: Database.Database,
  db: N2Database,
  projectId: string,
  archivedAt: string
): ProjectUpdateResponse =>
  transitionProject(sqlite, db, projectId, ({ project }) => {
    if (project.archivedAt !== null) return null;
    const runningTaskIds = db
      .select({ taskId: executionAttempts.taskId })
      .from(executionAttempts)
      .where(
        and(
          eq(executionAttempts.workspaceId, projectId),
          inArray(executionAttempts.state, ['active', 'stop_requested'])
        )
      )
      .all()
      .map(({ taskId }) => taskId);
    if (runningTaskIds.length > 0) {
      throw new ExecutionConflictError(
        'project_has_active_attempt',
        'Stop and confirm every active Execution Attempt before archiving this Project.',
        { taskIds: runningTaskIds.sort() }
      );
    }
    return { archivedAt };
  });

export const restoreProject = (
  sqlite: Database.Database,
  db: N2Database,
  projectId: string
): ProjectUpdateResponse =>
  transitionProject(sqlite, db, projectId, ({ project }) =>
    project.archivedAt === null ? null : { archivedAt: null }
  );
