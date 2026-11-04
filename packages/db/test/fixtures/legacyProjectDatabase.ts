import Database from 'better-sqlite3';

export function createLegacyProjectDatabase(databasePath: string): void {
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE workspaces (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('task', 'group', 'note')),
      requested_status TEXT NOT NULL CHECK (
        requested_status IN ('ready', 'in_progress', 'blocked', 'done')
      ),
      position_x REAL NOT NULL,
      position_y REAL NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX nodes_workspace_id_idx ON nodes(workspace_id);
    CREATE TABLE edges (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      source TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('contains', 'depends_on')),
      created_at TEXT NOT NULL,
      CHECK (source <> target),
      UNIQUE (workspace_id, source, target, kind)
    );
    CREATE INDEX edges_workspace_id_idx ON edges(workspace_id);
    INSERT INTO workspaces VALUES ('default', 'Legacy project');
    INSERT INTO nodes VALUES
      ('group', 'default', 'Group', 'group', 'ready', 0, 0, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('other-group', 'default', 'Other group', 'group', 'ready', 0, 0, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('dependency', 'default', 'Dependency', 'task', 'blocked', 0, 0, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('dependent', 'default', 'Dependent', 'task', 'ready', 0, 0, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO edges VALUES
      ('membership', 'default', 'group', 'dependency', 'contains', '2026-01-01T00:00:00.000Z'),
      ('second-membership', 'default', 'other-group', 'dependency', 'contains', '2026-01-01T00:00:00.000Z'),
      ('invalid-group', 'default', 'dependency', 'dependent', 'contains', '2026-01-01T00:00:00.000Z'),
      ('dependency', 'default', 'dependency', 'dependent', 'depends_on', '2026-01-01T00:00:00.000Z');
  `);
  legacy.close();
}
