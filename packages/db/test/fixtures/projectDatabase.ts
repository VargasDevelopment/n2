import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { ProjectRepository } from '../../src/index.js';
import { migrateDatabase } from '../../src/schemaMigrations.js';

let template: Buffer | undefined;

function migratedTemplate(): Buffer {
  if (template) return template;
  const database = new Database(':memory:');
  try {
    // Cache real migrations per isolated test module instead of repeating their disk writes.
    migrateDatabase(database);
    template = database.serialize();
    return template;
  } finally {
    database.close();
  }
}

/**
 * Fresh current-schema storage. Reopens and migrations from historical schemas use the constructor.
 * Tests may also use this to seed a current schema before restoring the historical shape under test.
 */
export function createTestProjectRepository(
  databasePath: string,
  options?: ConstructorParameters<typeof ProjectRepository>[1]
): ProjectRepository {
  // Exclusive creation prevents accidentally replacing a library or a migration fixture.
  writeFileSync(databasePath, migratedTemplate(), { flag: 'wx', mode: 0o600 });
  return new ProjectRepository(databasePath, options);
}
