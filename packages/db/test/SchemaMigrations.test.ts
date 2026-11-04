import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { addCanvasItemReferences } from '../src/canvasItemReferenceMigration.js';
import { addAgentExecution } from '../src/executionMigration.js';
import {
  createLegacyBaseline,
  persistCommandReceipts,
  persistRelationshipQuarantine,
  reactivateOverlappingMemberships,
  rememberReservedNodeKinds,
  reserveEntityIds,
  separateNotesFromWork,
  storeNoteContentExplicitly,
  upgradeRelationshipVocabulary
} from '../src/migrations.js';
import { addPlanningPlacements } from '../src/planningMigration.js';
import { LATEST_SCHEMA_VERSION, migrateDatabase } from '../src/schemaMigrations.js';
import { addSettings } from '../src/settingsMigration.js';

const historicalMigrations = [
  createLegacyBaseline,
  upgradeRelationshipVocabulary,
  persistRelationshipQuarantine,
  persistCommandReceipts,
  reserveEntityIds,
  separateNotesFromWork,
  storeNoteContentExplicitly,
  rememberReservedNodeKinds,
  reactivateOverlappingMemberships,
  addPlanningPlacements,
  addCanvasItemReferences,
  addSettings,
  addAgentExecution
];

describe('unversioned schema detection', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])(
    'selects the migration starting point for an unversioned v%i schema and preserves data',
    (version) => {
      const sqlite = new Database(':memory:');
      try {
        for (const migration of historicalMigrations.slice(0, version)) {
          migration(sqlite);
          if (migration === createLegacyBaseline) {
            sqlite.exec(`
              INSERT INTO workspaces (id, name) VALUES ('default', 'Preserved project');
              INSERT INTO nodes (
                id, workspace_id, title, kind, requested_status,
                position_x, position_y, created_at, updated_at
              ) VALUES (
                'task', 'default', 'Preserved Task', 'task', 'ready',
                10, 20, '2026-10-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z'
              );
            `);
          }
        }
        sqlite.pragma('user_version = 0');
        const pragma = vi.spyOn(sqlite, 'pragma');

        migrateDatabase(sqlite);

        // Versions before 7 use the legacy migration path. Recognized schemas are adopted first.
        const stamps = pragma.mock.calls
          .map(([statement]) => statement)
          .filter((statement) => statement.startsWith('user_version = '));
        expect(stamps[0]).toBe(`user_version = ${version >= 7 ? version : 1}`);
        expect(sqlite.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
        if (version > 0) {
          expect(sqlite.prepare('SELECT id, name FROM workspaces').all()).toEqual([
            { id: 'default', name: 'Preserved project' }
          ]);
          expect(sqlite.prepare('SELECT id, title, reference FROM nodes').all()).toEqual([
            { id: 'task', title: 'Preserved Task', reference: 'N2-1' }
          ]);
        }
      } finally {
        sqlite.close();
      }
    }
  );
});
