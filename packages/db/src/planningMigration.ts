import type Database from 'better-sqlite3';
import { NODES_PLANNING_SHAPE_SQL } from './planningConstraint.js';
import { rebuildTables } from './rebuildTables.js';

export const addPlanningPlacements = (sqlite: Database.Database): void => {
  rebuildTables(
    sqlite,
    'Adding Planning Placements introduced invalid database references.',
    () => {
      sqlite.exec(`
        CREATE TABLE next_nodes (
          id TEXT PRIMARY KEY NOT NULL,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT,
          content TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('task', 'group', 'note')),
          requested_status TEXT,
          planning_kind TEXT CHECK (planning_kind IN ('window', 'milestone')),
          planning_start_date TEXT,
          planning_end_date TEXT,
          position_x REAL NOT NULL,
          position_y REAL NOT NULL,
          version INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (
            (kind = 'note' AND description IS NULL AND content IS NOT NULL AND requested_status IS NULL) OR
            (kind IN ('task', 'group') AND description IS NOT NULL AND content IS NULL AND requested_status IN (
              'ready', 'in_progress', 'blocked', 'done'
            ))
          ),
          CONSTRAINT nodes_planning_shape CHECK (${NODES_PLANNING_SHAPE_SQL})
        );
        INSERT INTO next_nodes (
          rowid, id, workspace_id, title, description, content, kind, requested_status,
          planning_kind, planning_start_date, planning_end_date,
          position_x, position_y, version, created_at, updated_at
        )
        SELECT
          rowid, id, workspace_id, title, description, content, kind, requested_status,
          NULL, NULL, NULL,
          position_x, position_y, version, created_at, updated_at
        FROM nodes;
        DROP TABLE nodes;
        ALTER TABLE next_nodes RENAME TO nodes;
        CREATE INDEX nodes_workspace_id_idx ON nodes(workspace_id);
      `);
      sqlite.pragma('user_version = 10');
    }
  );
};
