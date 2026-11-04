import type Database from 'better-sqlite3';
import { addProjectActivity } from './activityMigration.js';
import { addCanvasItemReferences } from './canvasItemReferenceMigration.js';
import { addAgentExecution } from './executionMigration.js';
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
} from './migrations.js';
import { addPlanningPlacements } from './planningMigration.js';
import { addProjectArchive } from './projectArchiveMigration.js';
import { addProjectTheme } from './projectThemeMigration.js';
import { addSettings } from './settingsMigration.js';
import { addSystemTheme } from './systemThemeMigration.js';
import { addThemePreference } from './themeMigration.js';

// The schema's version history and the runner that applies it. Each migration since version 10
// lives in its own module, so adding one touches only that module and this list.
type Migration = {
  version: number;
  migrate: (sqlite: Database.Database) => void;
};

const migrations: Migration[] = [
  { version: 1, migrate: createLegacyBaseline },
  { version: 2, migrate: upgradeRelationshipVocabulary },
  { version: 3, migrate: persistRelationshipQuarantine },
  { version: 4, migrate: persistCommandReceipts },
  { version: 5, migrate: reserveEntityIds },
  { version: 6, migrate: separateNotesFromWork },
  { version: 7, migrate: storeNoteContentExplicitly },
  { version: 8, migrate: rememberReservedNodeKinds },
  { version: 9, migrate: reactivateOverlappingMemberships },
  { version: 10, migrate: addPlanningPlacements },
  { version: 11, migrate: addCanvasItemReferences },
  { version: 12, migrate: addSettings },
  { version: 13, migrate: addAgentExecution },
  { version: 14, migrate: addProjectArchive },
  { version: 15, migrate: addThemePreference },
  { version: 16, migrate: addProjectActivity },
  { version: 17, migrate: addSystemTheme },
  { version: 18, migrate: addProjectTheme }
];

// Derived so that adding a migration also raises the version every guard (open, backup) accepts.
export const LATEST_SCHEMA_VERSION = Math.max(...migrations.map(({ version }) => version));

const hasUnversionedV7Schema = (definitions: ReadonlyMap<string, string>): boolean => {
  const requiredTables = [
    'workspaces',
    'nodes',
    'edges',
    'relationship_quarantines',
    'command_receipts',
    'entity_id_reservations'
  ];
  if (requiredTables.some((table) => !definitions.has(table))) return false;

  const nodesDefinition = definitions.get('nodes') ?? '';
  const edgesDefinition = definitions.get('edges') ?? '';
  const quarantinesDefinition = definitions.get('relationship_quarantines') ?? '';
  return (
    /\bcontent\b/i.test(nodesDefinition) &&
    /content\s+is\s+not\s+null/i.test(nodesDefinition) &&
    /\bmember_of\b/i.test(edgesDefinition) &&
    !/\bcontains\b/i.test(edgesDefinition) &&
    /\bwork_node_required\b/i.test(quarantinesDefinition)
  );
};

const currentUnversionedSchemaVersion = (
  sqlite: Database.Database
): 7 | 8 | 9 | 10 | 11 | 12 | 13 | null => {
  const definitions = new Map(
    (
      sqlite
        .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL")
        .all() as { name: string; sql: string }[]
    ).map(({ name, sql }) => [name, sql])
  );
  if (!hasUnversionedV7Schema(definitions)) return null;

  const nodesDefinition = definitions.get('nodes') ?? '';
  const quarantinesDefinition = definitions.get('relationship_quarantines') ?? '';
  if (!/\bnode_kind\b/i.test(definitions.get('entity_id_reservations') ?? '')) return 7;
  if (/\bmultiple_memberships\b/i.test(quarantinesDefinition)) return 8;
  if (!/\bplanning_kind\b/i.test(nodesDefinition)) return 9;
  const hasCanvasItemReferences =
    /\breference_key\b/i.test(definitions.get('workspaces') ?? '') &&
    /\bnext_canvas_item_number\b/i.test(definitions.get('workspaces') ?? '') &&
    /\breference\b/i.test(nodesDefinition);
  if (!hasCanvasItemReferences) return 10;
  const hasSettings =
    /\binitial_settings\b/i.test(definitions.get('workspaces') ?? '') &&
    definitions.has('application_preferences') &&
    definitions.has('project_setting_overrides');
  if (!hasSettings) return 11;
  return definitions.has('execution_eligibilities') &&
    definitions.has('execution_enablement_reservations') &&
    definitions.has('execution_attempts')
    ? 13
    : 12;
};

export function migrateDatabase(sqlite: Database.Database): void {
  let currentVersion = sqlite.pragma('user_version', { simple: true }) as number;
  if (currentVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than supported version ${LATEST_SCHEMA_VERSION}.`
    );
  }

  if (currentVersion === 0) {
    const detectedVersion = currentUnversionedSchemaVersion(sqlite);
    if (detectedVersion !== null) {
      sqlite.pragma(`user_version = ${detectedVersion}`);
      currentVersion = detectedVersion;
    }
  }

  for (const migration of migrations) {
    if (migration.version > currentVersion) migration.migrate(sqlite);
  }
}
