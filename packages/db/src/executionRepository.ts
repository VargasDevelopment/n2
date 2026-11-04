import { ExecutionInputSnapshotSchema, type ExecutionAttemptState } from '@n2/contracts';
import type { StoredExecutionAttempt, StoredExecutionEligibility } from '@n2/application';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  executionAttempts,
  executionEligibilities,
  executionEnablementReservations,
  type schema
} from './schema.js';

type Db = BetterSQLite3Database<typeof schema>;

const eligibility = (
  row: typeof executionEligibilities.$inferSelect
): StoredExecutionEligibility => ({
  taskId: row.taskId,
  enabled: row.enabled,
  enablementId: row.enablementId,
  enabledFingerprint: row.enabledFingerprint,
  enabledAt: row.enabledAt,
  disabledAt: row.disabledAt
});

const attempt = (row: typeof executionAttempts.$inferSelect): StoredExecutionAttempt => ({
  attemptId: row.attemptId,
  taskId: row.taskId,
  workerId: row.workerId,
  claimedFingerprint: row.claimedFingerprint,
  enablementId: row.enablementId,
  inputSnapshot: ExecutionInputSnapshotSchema.parse(JSON.parse(row.inputSnapshot)),
  state: row.state,
  progress: row.progress,
  claimedAt: row.claimedAt,
  heartbeatAt: row.heartbeatAt,
  stopRequestedAt: row.stopRequestedAt,
  finishedAt: row.finishedAt
});

export const getExecutionEligibilities = (
  db: Db,
  projectId: string
): StoredExecutionEligibility[] =>
  db
    .select()
    .from(executionEligibilities)
    .where(eq(executionEligibilities.workspaceId, projectId))
    .all()
    .map(eligibility);

export const getExecutionEligibility = (
  db: Db,
  projectId: string,
  taskId: string
): StoredExecutionEligibility | null => {
  const row = db
    .select()
    .from(executionEligibilities)
    .where(
      and(
        eq(executionEligibilities.workspaceId, projectId),
        eq(executionEligibilities.taskId, taskId)
      )
    )
    .get();
  return row ? eligibility(row) : null;
};

export const saveExecutionEligibility = (
  db: Db,
  projectId: string,
  value: StoredExecutionEligibility
): void => {
  db.insert(executionEligibilities)
    .values({ workspaceId: projectId, ...value })
    .onConflictDoUpdate({
      target: [executionEligibilities.workspaceId, executionEligibilities.taskId],
      set: {
        enabled: value.enabled,
        enablementId: value.enablementId,
        enabledFingerprint: value.enabledFingerprint,
        enabledAt: value.enabledAt,
        disabledAt: value.disabledAt
      }
    })
    .run();
};

export const isEnablementIdReserved = (db: Db, enablementId: string): boolean =>
  db
    .select({ enablementId: executionEnablementReservations.enablementId })
    .from(executionEnablementReservations)
    .where(eq(executionEnablementReservations.enablementId, enablementId))
    .get() !== undefined;

export const reserveEnablementId = (
  db: Db,
  projectId: string,
  enablementId: string,
  taskId: string,
  createdAt: string
): void => {
  db.insert(executionEnablementReservations)
    .values({ enablementId, workspaceId: projectId, taskId, createdAt })
    .run();
};

export const getExecutionAttempts = (db: Db, projectId: string): StoredExecutionAttempt[] =>
  db
    .select()
    .from(executionAttempts)
    .where(eq(executionAttempts.workspaceId, projectId))
    .orderBy(executionAttempts.createdOrder)
    .all()
    .map(attempt);

export const getExecutionAttempt = (
  db: Db,
  projectId: string,
  attemptId: string
): StoredExecutionAttempt | null => {
  const row = db
    .select()
    .from(executionAttempts)
    .where(
      and(eq(executionAttempts.workspaceId, projectId), eq(executionAttempts.attemptId, attemptId))
    )
    .get();
  return row ? attempt(row) : null;
};

export const isExecutionAttemptIdReserved = (db: Db, attemptId: string): boolean =>
  db
    .select({ attemptId: executionAttempts.attemptId })
    .from(executionAttempts)
    .where(eq(executionAttempts.attemptId, attemptId))
    .get() !== undefined;

export const createExecutionAttempt = (
  db: Db,
  projectId: string,
  value: StoredExecutionAttempt
): void => {
  db.insert(executionAttempts)
    .values({
      ...value,
      workspaceId: projectId,
      createdOrder:
        db
          .select({ value: sql<number>`COALESCE(MAX(${executionAttempts.createdOrder}), 0) + 1` })
          .from(executionAttempts)
          .where(eq(executionAttempts.workspaceId, projectId))
          .get()?.value ?? 1,
      inputSnapshot: JSON.stringify(value.inputSnapshot)
    })
    .run();
};

export const requestExecutionStop = (
  db: Db,
  projectId: string,
  taskId: string,
  timestamp: string
): void => {
  db.update(executionAttempts)
    .set({ state: 'stop_requested', stopRequestedAt: timestamp })
    .where(
      and(
        eq(executionAttempts.workspaceId, projectId),
        eq(executionAttempts.taskId, taskId),
        eq(executionAttempts.state, 'active')
      )
    )
    .run();
};

export const heartbeatExecutionAttempt = (
  db: Db,
  projectId: string,
  attemptId: string,
  timestamp: string
): void => {
  db.update(executionAttempts)
    .set({ heartbeatAt: timestamp })
    .where(
      and(
        eq(executionAttempts.workspaceId, projectId),
        eq(executionAttempts.attemptId, attemptId),
        inArray(executionAttempts.state, ['active', 'stop_requested'])
      )
    )
    .run();
};

export const progressExecutionAttempt = (
  db: Db,
  projectId: string,
  attemptId: string,
  progress: string,
  timestamp: string
): void => {
  db.update(executionAttempts)
    .set({ progress, heartbeatAt: timestamp })
    .where(
      and(
        eq(executionAttempts.workspaceId, projectId),
        eq(executionAttempts.attemptId, attemptId),
        inArray(executionAttempts.state, ['active', 'stop_requested'])
      )
    )
    .run();
};

export const finishExecutionAttempt = (
  db: Db,
  projectId: string,
  attemptId: string,
  state: Extract<ExecutionAttemptState, 'completed' | 'failed' | 'released' | 'stopped'>,
  progress: string | undefined,
  timestamp: string
): void => {
  db.update(executionAttempts)
    .set({
      state,
      heartbeatAt: timestamp,
      finishedAt: timestamp,
      ...(progress === undefined ? {} : { progress })
    })
    .where(
      and(eq(executionAttempts.workspaceId, projectId), eq(executionAttempts.attemptId, attemptId))
    )
    .run();
};
