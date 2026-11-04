import type Database from 'better-sqlite3';

/**
 * Prepares Command Receipts to be read back as Project Activity (ADR 0014, ADR 0015):
 * - Every receipt gets a stable per-Project sequence, numbered in commit order. Implicit rowids are
 *   not stable across VACUUM, so the order becomes an explicit column.
 * - Every receipt can record its declared Actor. Existing receipts stay unattributed: nothing
 *   recorded who issued them, and guessing would be worse than saying so.
 * - Node reservations keep the item's Reference, so a deleted item can still be named. Items
 *   deleted before this migration have no Reference left to keep.
 * - Each existing Project starts caught up: its Seen Marker is its latest receipt, so the first
 *   look is not a wall of history presented as new.
 *
 * Additive and idempotent: an unversioned database detected as version 13 may already carry the
 * columns, so only receipts still missing a sequence are numbered, after any that have one, and
 * existing Seen Markers are kept.
 */
export const addProjectActivity = (sqlite: Database.Database): void => {
  sqlite.transaction(() => {
    const columnsOf = (table: string) =>
      new Set(
        (sqlite.pragma(`table_info(${table})`) as { name: string }[]).map(({ name }) => name)
      );
    const receiptColumns = columnsOf('command_receipts');
    if (!receiptColumns.has('sequence')) {
      sqlite.exec('ALTER TABLE command_receipts ADD COLUMN sequence INTEGER;');
    }
    if (!receiptColumns.has('actor_kind')) {
      sqlite.exec(`ALTER TABLE command_receipts ADD COLUMN actor_kind TEXT
        CHECK (actor_kind IS NULL OR actor_kind IN ('person', 'agent'));`);
    }
    if (!receiptColumns.has('actor_name')) {
      sqlite.exec('ALTER TABLE command_receipts ADD COLUMN actor_name TEXT;');
    }
    if (!columnsOf('entity_id_reservations').has('reference')) {
      sqlite.exec('ALTER TABLE entity_id_reservations ADD COLUMN reference TEXT;');
    }
    sqlite.exec(`
      UPDATE command_receipts
      SET sequence = ordered.sequence
      FROM (
        SELECT pending.rowid AS receipt_rowid,
          ROW_NUMBER() OVER (
            PARTITION BY pending.workspace_id ORDER BY pending.created_at, pending.rowid
          ) + numbered.latest AS sequence
        FROM command_receipts AS pending
        JOIN (
          SELECT workspace_id, COALESCE(MAX(sequence), 0) AS latest
          FROM command_receipts GROUP BY workspace_id
        ) AS numbered ON numbered.workspace_id = pending.workspace_id
        WHERE pending.sequence IS NULL
      ) AS ordered
      WHERE command_receipts.rowid = ordered.receipt_rowid;
      CREATE UNIQUE INDEX IF NOT EXISTS command_receipts_project_sequence
      ON command_receipts(workspace_id, sequence);

      UPDATE entity_id_reservations
      SET reference = (SELECT nodes.reference FROM nodes WHERE nodes.id = entity_id)
      WHERE entity_type = 'node' AND reference IS NULL;

      CREATE TABLE IF NOT EXISTS activity_seen_markers (
        workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence >= 0),
        seen_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO activity_seen_markers (workspace_id, sequence, seen_at)
      SELECT workspaces.id, COALESCE(MAX(receipts.sequence), 0),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM workspaces
      LEFT JOIN command_receipts AS receipts ON receipts.workspace_id = workspaces.id
      GROUP BY workspaces.id;
    `);
    sqlite.pragma('user_version = 16');
  })();
};
