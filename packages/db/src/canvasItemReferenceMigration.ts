import { formatCanvasItemReference, ProjectReferenceKeySchema } from '@n2/contracts';
import type Database from 'better-sqlite3';
import { NODES_PLANNING_SHAPE_SQL } from './planningConstraint.js';
import { rebuildTables } from './rebuildTables.js';

type LegacyProject = { id: string; name: string };
type LegacyCanvasItem = { id: string; workspace_id: string };
type LegacyReservedNodeId = { id: string };

const candidateReferenceKey = ({ id, name }: LegacyProject): string => {
  if (id === 'default') return 'N2';
  const lettersAndNumbers = name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  const prefixed = /^[A-Z]/.test(lettersAndNumbers) ? lettersAndNumbers : `P${lettersAndNumbers}`;
  return (prefixed || 'PROJECT').slice(0, 8).padEnd(2, 'X');
};

const allocateProjectReferenceKeys = (projects: LegacyProject[]): Map<string, string> => {
  const used = new Set<string>();
  const keys = new Map<string, string>();
  const defaultFirst = (left: LegacyProject, right: LegacyProject): number => {
    if (left.id === right.id) return 0;
    if (left.id === 'default') return -1;
    if (right.id === 'default') return 1;
    return left.id.localeCompare(right.id);
  };
  for (const project of [...projects].sort(defaultFirst)) {
    const base = candidateReferenceKey(project);
    let key = base;
    let suffix = 2;
    while (used.has(key)) {
      const suffixText = String(suffix++);
      key = `${base.slice(0, 10 - suffixText.length)}${suffixText}`;
    }
    keys.set(project.id, ProjectReferenceKeySchema.parse(key));
    used.add(key);
  }
  return keys;
};

const requireProjectReferenceKey = (keys: Map<string, string>, projectId: string): string => {
  const key = keys.get(projectId);
  if (!key) throw new Error(`Project ${projectId} is missing a Project Reference Key.`);
  return key;
};

const reservedSequenceForProject = (itemId: string, projectReferenceKey: string): number => {
  const match = new RegExp(`^${projectReferenceKey}-([1-9]\\d*)$`, 'i').exec(itemId);
  if (!match) return 0;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) ? sequence : 0;
};

export const addCanvasItemReferences = (sqlite: Database.Database): void => {
  rebuildTables(
    sqlite,
    'Adding Canvas Item References introduced invalid database references.',
    () => {
      const projects = sqlite.prepare('SELECT id, name FROM workspaces').all() as LegacyProject[];
      const projectReferenceKeys = allocateProjectReferenceKeys(projects);
      const items = sqlite
        .prepare('SELECT id, workspace_id FROM nodes ORDER BY workspace_id, created_at, id')
        .all() as LegacyCanvasItem[];
      const reservedNodeIds = sqlite
        .prepare("SELECT entity_id AS id FROM entity_id_reservations WHERE entity_type = 'node'")
        .all() as LegacyReservedNodeId[];
      const canonicalNodeIds = new Set([
        ...reservedNodeIds.map(({ id }) => id),
        ...items.map(({ id }) => id)
      ]);
      const sequenceByProject = new Map<string, number>();
      const reservedSequenceCeilingByProject = new Map<string, number>();
      const reservedLocatorKeys = new Set([...canonicalNodeIds].map((id) => id.toUpperCase()));
      const referenceByItemId = new Map<string, string>();
      for (const project of projects) {
        const key = requireProjectReferenceKey(projectReferenceKeys, project.id);
        let reservedSequenceCeiling = 0;
        for (const id of canonicalNodeIds) {
          reservedSequenceCeiling = Math.max(
            reservedSequenceCeiling,
            reservedSequenceForProject(id, key)
          );
        }
        reservedSequenceCeilingByProject.set(project.id, reservedSequenceCeiling);
      }
      for (const item of items) {
        const key = requireProjectReferenceKey(projectReferenceKeys, item.workspace_id);
        let sequence = sequenceByProject.get(item.workspace_id) ?? 0;
        let reference: string;
        do {
          reference = formatCanvasItemReference(key, ++sequence);
        } while (reservedLocatorKeys.has(reference));
        sequenceByProject.set(item.workspace_id, sequence);
        referenceByItemId.set(item.id, reference);
      }

      sqlite.exec(`
        CREATE TABLE next_workspaces (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          reference_key TEXT NOT NULL,
          next_canvas_item_number INTEGER NOT NULL CHECK (next_canvas_item_number >= 1)
        );
        CREATE TABLE next_nodes (
          id TEXT PRIMARY KEY NOT NULL,
          reference TEXT NOT NULL,
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
      `);

      const insertProject = sqlite.prepare(`
        INSERT INTO next_workspaces (
          id, name, reference_key, next_canvas_item_number
        ) VALUES (?, ?, ?, ?)
      `);
      for (const project of projects) {
        insertProject.run(
          project.id,
          project.name,
          requireProjectReferenceKey(projectReferenceKeys, project.id),
          Math.max(
            sequenceByProject.get(project.id) ?? 0,
            reservedSequenceCeilingByProject.get(project.id) ?? 0
          ) + 1
        );
      }

      const insertReference = sqlite.prepare(`
        INSERT INTO next_nodes (
          rowid, id, reference, workspace_id, title, description, content, kind, requested_status,
          planning_kind, planning_start_date, planning_end_date,
          position_x, position_y, version, created_at, updated_at
        )
        SELECT
          rowid, id, ?, workspace_id, title, description, content, kind, requested_status,
          planning_kind, planning_start_date, planning_end_date,
          position_x, position_y, version, created_at, updated_at
        FROM nodes WHERE id = ?
      `);
      for (const item of items) {
        const reference = referenceByItemId.get(item.id);
        if (!reference)
          throw new Error(`Canvas item ${item.id} is missing its backfilled reference.`);
        insertReference.run(reference, item.id);
      }

      sqlite.exec(`
        DROP TABLE nodes;
        DROP TABLE workspaces;
        ALTER TABLE next_workspaces RENAME TO workspaces;
        ALTER TABLE next_nodes RENAME TO nodes;
        CREATE UNIQUE INDEX workspaces_reference_key_unique ON workspaces(reference_key);
        CREATE INDEX nodes_workspace_id_idx ON nodes(workspace_id);
        CREATE UNIQUE INDEX nodes_reference_unique ON nodes(reference);
      `);
      sqlite.pragma('user_version = 11');
    }
  );
};
