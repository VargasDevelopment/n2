import type Database from 'better-sqlite3';

export const addAgentExecution = (sqlite: Database.Database): void => {
  sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS execution_eligibilities (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        enablement_id TEXT NOT NULL,
        enabled_fingerprint TEXT NOT NULL,
        enabled_at TEXT NOT NULL,
        disabled_at TEXT,
        PRIMARY KEY (workspace_id, task_id)
      );
      CREATE INDEX IF NOT EXISTS execution_eligibilities_workspace_id_idx
      ON execution_eligibilities(workspace_id);

      CREATE TABLE IF NOT EXISTS execution_enablement_reservations (
        enablement_id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS execution_enablement_reservations_workspace_id_idx
      ON execution_enablement_reservations(workspace_id);

      CREATE TABLE IF NOT EXISTS execution_attempts (
        attempt_id TEXT PRIMARY KEY NOT NULL,
        created_order INTEGER NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        claimed_fingerprint TEXT NOT NULL,
        enablement_id TEXT NOT NULL,
        input_snapshot TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN (
          'active', 'stop_requested', 'completed', 'failed', 'released', 'stopped'
        )),
        progress TEXT,
        claimed_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        stop_requested_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS execution_attempts_workspace_id_idx
      ON execution_attempts(workspace_id);
      CREATE INDEX IF NOT EXISTS execution_attempts_task_id_idx ON execution_attempts(task_id);
      CREATE UNIQUE INDEX IF NOT EXISTS execution_attempts_one_active_per_task
      ON execution_attempts(workspace_id, task_id)
      WHERE state IN ('active', 'stop_requested');
      CREATE UNIQUE INDEX IF NOT EXISTS execution_attempts_project_order_unique
      ON execution_attempts(workspace_id, created_order);
    `);
    sqlite.pragma('user_version = 13');
  })();
};
