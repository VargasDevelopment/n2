// Schema migrations 1–9, written before migrations moved into their own modules. They are history:
// new migrations get a module of their own and register in schemaMigrations.ts.
import type Database from 'better-sqlite3';
import { rebuildTables } from './rebuildTables.js';

export const createLegacyBaseline = (sqlite: Database.Database): void => {
  sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS nodes (
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
      CREATE INDEX IF NOT EXISTS nodes_workspace_id_idx ON nodes(workspace_id);
      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        source TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        target TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('contains', 'depends_on')),
        created_at TEXT NOT NULL,
        CHECK (source <> target),
        UNIQUE (workspace_id, source, target, kind)
      );
      CREATE INDEX IF NOT EXISTS edges_workspace_id_idx ON edges(workspace_id);
    `);
    sqlite.pragma('user_version = 1');
  })();
};

export const upgradeRelationshipVocabulary = (sqlite: Database.Database): void => {
  sqlite.pragma('foreign_keys = OFF');
  try {
    sqlite.transaction(() => {
      const nodeColumns = sqlite.pragma('table_info(nodes)') as { name: string }[];
      if (!nodeColumns.some(({ name }) => name === 'description')) {
        sqlite.exec("ALTER TABLE nodes ADD COLUMN description TEXT NOT NULL DEFAULT '';");
      }

      // Version-zero databases predate migration tracking. Inspecting their table definition is a
      // one-time compatibility bridge; versioned databases never branch on schema text.
      const edgeTable = sqlite
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'edges'")
        .get() as { sql: string } | undefined;
      if (edgeTable?.sql && /\bcontains\b/.test(edgeTable.sql)) {
        sqlite.exec(`
          ALTER TABLE edges RENAME TO legacy_edges;
          CREATE TABLE edges (
            id TEXT PRIMARY KEY NOT NULL,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            source TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            target TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK (kind IN ('member_of', 'depends_on')),
            created_at TEXT NOT NULL,
            CHECK (source <> target),
            UNIQUE (workspace_id, source, target, kind)
          );
          INSERT INTO edges (id, workspace_id, source, target, kind, created_at)
          SELECT
            id,
            workspace_id,
            target,
            source,
            CASE kind WHEN 'contains' THEN 'member_of' ELSE kind END,
            created_at
          FROM legacy_edges;
          DROP TABLE legacy_edges;
          CREATE INDEX edges_workspace_id_idx ON edges(workspace_id);
        `);
      }

      sqlite.pragma('user_version = 2');
    })();
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
};

type MigrationNodeRow = {
  id: string;
  title: string;
  description: string;
  kind: 'task' | 'group' | 'note';
  requested_status: 'ready' | 'in_progress' | 'blocked' | 'done';
  position_x: number;
  position_y: number;
  version: number;
  created_at: string;
  updated_at: string;
};

type MigrationRelationshipRow = {
  id: string;
  source: string;
  target: string;
  kind: 'member_of' | 'depends_on';
  created_at: string;
};

type V3RelationshipViolation =
  | 'self_relationship'
  | 'missing_node'
  | 'duplicate_relationship'
  | 'group_required'
  | 'multiple_memberships'
  | 'cycle';

type V3RelationshipWarning = {
  relationshipId: string;
  violation: V3RelationshipViolation;
  message: string;
};

const migrationWouldCreateCycle = (
  relationships: readonly MigrationRelationshipRow[],
  candidate: MigrationRelationshipRow
): boolean => {
  const dependencies = new Map<string, string[]>();
  for (const relationship of [...relationships, candidate]) {
    const source = relationship.kind === 'member_of' ? relationship.target : relationship.source;
    const target = relationship.kind === 'member_of' ? relationship.source : relationship.target;
    dependencies.set(source, [...(dependencies.get(source) ?? []), target]);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visited.has(nodeId)) return false;
    if (visiting.has(nodeId)) return true;
    visiting.add(nodeId);
    if ((dependencies.get(nodeId) ?? []).some(visit)) return true;
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  return [...dependencies.keys()].some(visit);
};

// Version 3 shipped with these exact graph rules. Keep them migration-local so later domain
// vocabulary and invariants cannot retroactively change a historical database transition.
const canonicalizeV3Relationships = (
  nodes: readonly MigrationNodeRow[],
  candidates: readonly MigrationRelationshipRow[]
): V3RelationshipWarning[] => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const accepted: MigrationRelationshipRow[] = [];
  const warnings: V3RelationshipWarning[] = [];

  for (const candidate of [...candidates].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
  )) {
    let warning: Omit<V3RelationshipWarning, 'relationshipId'> | undefined;
    if (candidate.source === candidate.target) {
      warning = {
        violation: 'self_relationship',
        message: 'A node cannot be related to itself.'
      };
    } else if (!nodeById.has(candidate.source) || !nodeById.has(candidate.target)) {
      warning = {
        violation: 'missing_node',
        message: 'Both ends of a relationship must exist in this project.'
      };
    } else if (
      accepted.some(
        (relationship) =>
          relationship.kind === candidate.kind &&
          relationship.source === candidate.source &&
          relationship.target === candidate.target
      )
    ) {
      warning = {
        violation: 'duplicate_relationship',
        message: 'That relationship already exists.'
      };
    } else if (candidate.kind === 'member_of' && nodeById.get(candidate.target)?.kind !== 'group') {
      warning = {
        violation: 'group_required',
        message: 'A node can only be part of a group.'
      };
    } else if (
      candidate.kind === 'member_of' &&
      accepted.some(
        (relationship) =>
          relationship.kind === 'member_of' && relationship.source === candidate.source
      )
    ) {
      warning = {
        violation: 'multiple_memberships',
        message: 'A node can be part of only one group.'
      };
    } else if (migrationWouldCreateCycle(accepted, candidate)) {
      warning = {
        violation: 'cycle',
        message: 'That relationship would create a graph cycle.'
      };
    }

    if (warning) warnings.push({ relationshipId: candidate.id, ...warning });
    else accepted.push(candidate);
  }
  return warnings;
};

export const persistRelationshipQuarantine = (sqlite: Database.Database): void => {
  sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS relationship_quarantines (
        relationship_id TEXT PRIMARY KEY NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        violation TEXT NOT NULL CHECK (violation IN (
          'self_relationship',
          'missing_node',
          'duplicate_relationship',
          'group_required',
          'multiple_memberships',
          'cycle'
        )),
        message TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS relationship_quarantines_workspace_id_idx
      ON relationship_quarantines(workspace_id);
    `);

    const workspaceRows = sqlite.prepare('SELECT id, name FROM workspaces').all() as {
      id: string;
      name: string;
    }[];
    const nodeRows = sqlite.prepare(`
      SELECT id, title, description, kind, requested_status, position_x, position_y,
             version, created_at, updated_at
      FROM nodes
      WHERE workspace_id = ?
    `);
    const relationshipRows = sqlite.prepare(`
      SELECT id, source, target, kind, created_at
      FROM edges
      WHERE workspace_id = ?
    `);
    const existingQuarantineRows = sqlite.prepare(`
      SELECT relationship_id
      FROM relationship_quarantines
      WHERE workspace_id = ?
    `);
    const insertQuarantine = sqlite.prepare(`
      INSERT INTO relationship_quarantines (
        relationship_id, workspace_id, violation, message
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT (relationship_id) DO NOTHING
    `);

    for (const workspace of workspaceRows) {
      const existingQuarantines = new Set(
        (existingQuarantineRows.all(workspace.id) as { relationship_id: string }[]).map(
          ({ relationship_id }) => relationship_id
        )
      );
      const warnings = canonicalizeV3Relationships(
        nodeRows.all(workspace.id) as MigrationNodeRow[],
        (relationshipRows.all(workspace.id) as MigrationRelationshipRow[]).filter(
          ({ id }) => !existingQuarantines.has(id)
        )
      );
      for (const warning of warnings) {
        insertQuarantine.run(
          warning.relationshipId,
          workspace.id,
          warning.violation,
          warning.message
        );
      }
    }

    sqlite.pragma('user_version = 3');
  })();
};

export const persistCommandReceipts = (sqlite: Database.Database): void => {
  sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS command_receipts (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        command_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        outcome TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, command_id)
      );
      CREATE INDEX IF NOT EXISTS command_receipts_workspace_id_idx
      ON command_receipts(workspace_id);
    `);
    sqlite.pragma('user_version = 4');
  })();
};

export const reserveEntityIds = (sqlite: Database.Database): void => {
  sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS entity_id_reservations (
        entity_type TEXT NOT NULL CHECK (entity_type IN ('node', 'relationship')),
        entity_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (entity_type, entity_id)
      );
      INSERT OR IGNORE INTO entity_id_reservations (entity_type, entity_id, created_at)
      SELECT 'node', id, created_at FROM nodes;
      INSERT OR IGNORE INTO entity_id_reservations (entity_type, entity_id, created_at)
      SELECT 'relationship', id, created_at FROM edges;
      INSERT OR IGNORE INTO entity_id_reservations (entity_type, entity_id, created_at)
      SELECT 'node', json_extract(outcome, '$.nodeId'), created_at
      FROM command_receipts
      WHERE json_extract(outcome, '$.kind') IN ('node_created', 'node_updated', 'node_deleted');
      INSERT OR IGNORE INTO entity_id_reservations (entity_type, entity_id, created_at)
      SELECT 'relationship', json_extract(outcome, '$.relationshipId'), created_at
      FROM command_receipts
      WHERE json_extract(outcome, '$.kind') IN (
        'relationship_created', 'relationship_deleted'
      );
    `);
    sqlite.pragma('user_version = 5');
  })();
};

export const separateNotesFromWork = (sqlite: Database.Database): void => {
  rebuildTables(
    sqlite,
    'Separating Notes from Work Nodes introduced invalid database references.',
    () => {
      sqlite.exec(`
        CREATE TABLE next_nodes (
          id TEXT PRIMARY KEY NOT NULL,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL CHECK (kind IN ('task', 'group', 'note')),
          requested_status TEXT CHECK (
            (kind = 'note' AND requested_status IS NULL) OR
            (kind IN ('task', 'group') AND requested_status IN (
              'ready', 'in_progress', 'blocked', 'done'
            ))
          ),
          position_x REAL NOT NULL,
          position_y REAL NOT NULL,
          version INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO next_nodes (
          rowid, id, workspace_id, title, description, kind, requested_status,
          position_x, position_y, version, created_at, updated_at
        )
        SELECT
          rowid, id, workspace_id, title, description, kind,
          CASE WHEN kind = 'note' THEN NULL ELSE requested_status END,
          position_x, position_y, version, created_at, updated_at
        FROM nodes;
        DROP TABLE nodes;
        ALTER TABLE next_nodes RENAME TO nodes;
        CREATE INDEX nodes_workspace_id_idx ON nodes(workspace_id);

        CREATE TABLE next_relationship_quarantines (
          relationship_id TEXT PRIMARY KEY NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          violation TEXT NOT NULL CHECK (violation IN (
            'self_relationship',
            'missing_node',
            'duplicate_relationship',
            'work_node_required',
            'group_required',
            'multiple_memberships',
            'cycle'
          )),
          message TEXT NOT NULL
        );
        INSERT INTO next_relationship_quarantines (
          rowid, relationship_id, workspace_id, violation, message
        )
        SELECT rowid, relationship_id, workspace_id, violation, message
        FROM relationship_quarantines;
        DROP TABLE relationship_quarantines;
        ALTER TABLE next_relationship_quarantines RENAME TO relationship_quarantines;
        CREATE INDEX relationship_quarantines_workspace_id_idx
        ON relationship_quarantines(workspace_id);

        INSERT INTO relationship_quarantines (
          relationship_id, workspace_id, violation, message
        )
        SELECT
          edges.id,
          edges.workspace_id,
          'work_node_required',
          'Relationships can connect only tasks and groups; notes stand alone.'
        FROM edges
        JOIN nodes AS source_node ON source_node.id = edges.source
        JOIN nodes AS target_node ON target_node.id = edges.target
        WHERE source_node.kind = 'note' OR target_node.kind = 'note'
        ON CONFLICT (relationship_id) DO UPDATE SET
          violation = excluded.violation,
          message = excluded.message;
      `);
      sqlite.pragma('user_version = 6');
    }
  );
};

export const storeNoteContentExplicitly = (sqlite: Database.Database): void => {
  rebuildTables(sqlite, 'Separating Note content introduced invalid database references.', () => {
    sqlite.exec(`
        CREATE TABLE next_nodes (
          id TEXT PRIMARY KEY NOT NULL,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT,
          content TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('task', 'group', 'note')),
          requested_status TEXT,
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
          )
        );
        INSERT INTO next_nodes (
          rowid, id, workspace_id, title, description, content, kind, requested_status,
          position_x, position_y, version, created_at, updated_at
        )
        SELECT
          rowid,
          id,
          workspace_id,
          title,
          CASE WHEN kind = 'note' THEN NULL ELSE description END,
          CASE WHEN kind = 'note' THEN description ELSE NULL END,
          kind,
          requested_status,
          position_x,
          position_y,
          version,
          created_at,
          updated_at
        FROM nodes;
        DROP TABLE nodes;
        ALTER TABLE next_nodes RENAME TO nodes;
        CREATE INDEX nodes_workspace_id_idx ON nodes(workspace_id);
      `);
    sqlite.pragma('user_version = 7');
  });
};

export const rememberReservedNodeKinds = (sqlite: Database.Database): void => {
  sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE next_entity_id_reservations (
        entity_type TEXT NOT NULL CHECK (entity_type IN ('node', 'relationship')),
        entity_id TEXT NOT NULL,
        node_kind TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (entity_type, entity_id),
        CHECK (
          (entity_type = 'node' AND (node_kind IS NULL OR node_kind IN ('task', 'group', 'note'))) OR
          (entity_type = 'relationship' AND node_kind IS NULL)
        )
      );
      INSERT INTO next_entity_id_reservations (
        rowid, entity_type, entity_id, node_kind, created_at
      )
      SELECT
        reservations.rowid,
        reservations.entity_type,
        reservations.entity_id,
        CASE
          WHEN reservations.entity_type = 'relationship' THEN NULL
          ELSE COALESCE(
            (SELECT nodes.kind FROM nodes WHERE nodes.id = reservations.entity_id),
            (
              SELECT CASE json_extract(receipts.fingerprint, '$.input.kind')
                WHEN 'note' THEN 'note'
                WHEN 'group' THEN 'group'
                ELSE 'task'
              END
              FROM command_receipts AS receipts
              WHERE json_extract(receipts.outcome, '$.kind') = 'node_created'
                AND json_extract(receipts.outcome, '$.nodeId') = reservations.entity_id
              ORDER BY receipts.created_at, receipts.command_id
              LIMIT 1
            )
          )
        END,
        reservations.created_at
      FROM entity_id_reservations AS reservations;
      DROP TABLE entity_id_reservations;
      ALTER TABLE next_entity_id_reservations RENAME TO entity_id_reservations;
    `);
    sqlite.pragma('user_version = 8');
  })();
};

export const reactivateOverlappingMemberships = (sqlite: Database.Database): void => {
  rebuildTables(
    sqlite,
    'Reactivating overlapping memberships introduced invalid database references.',
    () => {
      const workspaceRows = sqlite.prepare('SELECT id FROM workspaces').all() as { id: string }[];
      const activeRelationshipRows = sqlite.prepare(`
        SELECT edges.id, edges.source, edges.target, edges.kind, edges.created_at
        FROM edges
        LEFT JOIN relationship_quarantines
          ON relationship_quarantines.relationship_id = edges.id
        WHERE edges.workspace_id = ? AND relationship_quarantines.relationship_id IS NULL
      `);
      const overlappingMembershipRows = sqlite.prepare(`
        SELECT edges.id, edges.source, edges.target, edges.kind, edges.created_at
        FROM edges
        JOIN relationship_quarantines
          ON relationship_quarantines.relationship_id = edges.id
        WHERE edges.workspace_id = ?
          AND relationship_quarantines.violation = 'multiple_memberships'
        ORDER BY edges.created_at, edges.id
      `);
      const releaseMembership = sqlite.prepare(`
        DELETE FROM relationship_quarantines WHERE relationship_id = ?
      `);
      const quarantineCycle = sqlite.prepare(`
        UPDATE relationship_quarantines
        SET violation = 'cycle', message = 'That relationship would create a graph cycle.'
        WHERE relationship_id = ?
      `);

      for (const workspace of workspaceRows) {
        const accepted = activeRelationshipRows.all(workspace.id) as MigrationRelationshipRow[];
        const candidates = overlappingMembershipRows.all(
          workspace.id
        ) as MigrationRelationshipRow[];
        for (const candidate of candidates) {
          if (migrationWouldCreateCycle(accepted, candidate)) {
            quarantineCycle.run(candidate.id);
          } else {
            releaseMembership.run(candidate.id);
            accepted.push(candidate);
          }
        }
      }

      sqlite.exec(`
        CREATE TABLE next_relationship_quarantines (
          relationship_id TEXT PRIMARY KEY NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          violation TEXT NOT NULL CHECK (violation IN (
            'self_relationship',
            'missing_node',
            'duplicate_relationship',
            'work_node_required',
            'group_required',
            'cycle'
          )),
          message TEXT NOT NULL
        );
        INSERT INTO next_relationship_quarantines (
          rowid, relationship_id, workspace_id, violation, message
        )
        SELECT rowid, relationship_id, workspace_id, violation, message
        FROM relationship_quarantines;
        DROP TABLE relationship_quarantines;
        ALTER TABLE next_relationship_quarantines RENAME TO relationship_quarantines;
        CREATE INDEX relationship_quarantines_workspace_id_idx
        ON relationship_quarantines(workspace_id);
      `);
      sqlite.pragma('user_version = 9');
    }
  );
};
