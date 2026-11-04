import type { ActivityHistory, StoredCommandReceipt } from '@n2/application';
import type Database from 'better-sqlite3';
import type { CommandActor, LibrarySeenMarkers, SeenMarker } from '@n2/contracts';
import { and, asc, eq, max, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { requireProjectRow } from './projectLibraryRepository.js';
import {
  activitySeenMarkers,
  commandReceipts,
  entityIdReservations,
  executionEnablementReservations,
  type schema
} from './schema.js';

type N2Database = BetterSQLite3Database<typeof schema>;

/** The sequence of the Project's newest Command Receipt, or 0 before any. */
export const latestSequence = (db: N2Database, projectId: string): number =>
  db
    .select({ latest: max(commandReceipts.sequence) })
    .from(commandReceipts)
    .where(eq(commandReceipts.workspaceId, projectId))
    .get()?.latest ?? 0;

/**
 * The receipt's place in its Project's activity and who issued it. Called inside the command's
 * write transaction, so no other writer can take the same sequence number.
 */
export const receiptActivityColumns = (
  db: N2Database,
  projectId: string,
  actor: CommandActor | null
) => ({
  sequence: latestSequence(db, projectId) + 1,
  actorKind: actor?.kind ?? null,
  actorName: actor?.kind === 'agent' ? actor.name : null
});

const toActor = (kind: CommandActor['kind'] | null, name: string | null): CommandActor | null =>
  kind === 'person'
    ? { kind: 'person' }
    : kind === 'agent' && name !== null
      ? { kind: 'agent', name }
      : null;

// Node commands carry the target's reserved Reference and kind, which outlive the item itself.
const getCommandReceipts = (db: N2Database, projectId: string): StoredCommandReceipt[] =>
  db
    .select({
      receipt: commandReceipts,
      itemReference: entityIdReservations.reference,
      itemKind: entityIdReservations.nodeKind
    })
    .from(commandReceipts)
    .leftJoin(
      entityIdReservations,
      and(
        eq(entityIdReservations.entityType, 'node'),
        eq(
          entityIdReservations.entityId,
          sql`json_extract(${commandReceipts.fingerprint}, '$.nodeId')`
        )
      )
    )
    .where(eq(commandReceipts.workspaceId, projectId))
    .orderBy(asc(commandReceipts.sequence))
    .all()
    .flatMap(
      ({
        receipt: { sequence, fingerprint, actorKind, actorName, createdAt },
        itemReference,
        itemKind
      }) =>
        sequence === null
          ? []
          : [
              {
                sequence,
                fingerprint,
                actor: toActor(actorKind, actorName),
                createdAt,
                itemReference,
                itemKind
              }
            ]
    );

export const getActivityHistory = (db: N2Database, projectId: string): ActivityHistory => {
  requireProjectRow(db, projectId);
  return {
    receipts: getCommandReceipts(db, projectId),
    enablements: db
      .select({
        enablementId: executionEnablementReservations.enablementId,
        taskId: executionEnablementReservations.taskId
      })
      .from(executionEnablementReservations)
      .where(eq(executionEnablementReservations.workspaceId, projectId))
      .all()
  };
};

export const getSeenMarker = (db: N2Database, projectId: string): SeenMarker | null => {
  const row = db
    .select()
    .from(activitySeenMarkers)
    .where(eq(activitySeenMarkers.workspaceId, projectId))
    .get();
  return row ? { sequence: row.sequence, seenAt: row.seenAt } : null;
};

// The marker only moves forward and never past the latest receipt, so a stale tab cannot un-see
// what another device has seen, and a too-large value cannot hide activity that has not happened.
export const markActivitySeen = (
  db: N2Database,
  projectId: string,
  sequence: number,
  seenAt: string
): SeenMarker => {
  requireProjectRow(db, projectId);
  const latest = latestSequence(db, projectId);
  db.insert(activitySeenMarkers)
    .values({ workspaceId: projectId, sequence: Math.min(sequence, latest), seenAt })
    .onConflictDoUpdate({
      target: activitySeenMarkers.workspaceId,
      set: { sequence: sql`excluded.sequence`, seenAt },
      setWhere: sql`excluded.sequence > ${activitySeenMarkers.sequence}`
    })
    .run();
  const marker = getSeenMarker(db, projectId);
  if (!marker) throw new Error(`The Seen Marker for Project ${projectId} was not stored.`);
  return marker;
};

/**
 * Several Projects' markers by the per-Project rule, in one transaction. An unknown Project rejects
 * the whole batch. An archived one is skipped: archiving is the newer intent, and Library Activity
 * leaves archived Projects out, so their news waits for restore. The archive state is read under
 * the write lock, so an archive racing a close cannot be acknowledged.
 */
export const markLibraryActivitySeen = (
  sqlite: Database.Database,
  db: N2Database,
  marks: readonly { projectId: string; sequence: number }[],
  seenAt: string
): LibrarySeenMarkers =>
  sqlite
    .transaction(() => ({
      projects: marks.flatMap(({ projectId, sequence }) =>
        requireProjectRow(db, projectId).archivedAt === null
          ? [{ projectId, seen: markActivitySeen(db, projectId, sequence, seenAt) }]
          : []
      )
    }))
    .immediate();
