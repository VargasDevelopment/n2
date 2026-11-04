import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { requireN2Library } from './databaseFile.js';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key] ?? null)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const digest = (text: string): string => createHash('sha256').update(text).digest('hex');

function sqliteValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (Buffer.isBuffer(value)) return { bytes: value.toString('hex') };
  throw new Error('Unsupported SQLite value in backup manifest');
}

function inspect(database: Database.Database) {
  const schema = database
    .prepare<[], unknown[]>('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name')
    .raw()
    .all()
    .map((row) => row.map(sqliteValue));
  const tables: Record<string, { rows: number; sha256: string }> = {};
  for (const { name } of database
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    .all()) {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    const rows = database
      .prepare<[], unknown[]>(`SELECT * FROM ${quoted}`)
      .raw()
      .all()
      .map((row) => canonical(row.map(sqliteValue)))
      .sort();
    tables[name] = { rows: rows.length, sha256: digest(rows.join('\n')) };
  }
  const result = {
    user_version: Number(database.pragma('user_version', { simple: true })),
    integrity_check: database
      .prepare<[], { integrity_check: string }>('PRAGMA integrity_check')
      .all()
      .map((row) => row.integrity_check),
    foreign_key_check: database
      .prepare<[], unknown[]>('PRAGMA foreign_key_check')
      .raw()
      .all()
      .map((row) => row.map(sqliteValue)),
    schema_sha256: digest(canonical(schema)),
    tables
  };
  if (
    result.integrity_check.length !== 1 ||
    result.integrity_check[0] !== 'ok' ||
    result.foreign_key_check.length
  ) {
    throw new Error('Backup integrity check failed; previous backups retained');
  }
  return { ...result, dataset_sha256: digest(canonical(result)) };
}

async function syncFile(path: string): Promise<void> {
  const file = await open(path, 'r');
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function backupDatabase(databasePath: string, directory: string) {
  requireN2Library(databasePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(/[-:.]/g, '');
  const name = `${stamp}-${randomUUID()}`;
  const published = join(directory, name);
  const temporary = join(directory, `.${name}.tmp`);
  const snapshotPath = join(temporary, 'n2.sqlite');
  const metadataPath = join(temporary, 'manifest.json');
  const source = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    await mkdir(temporary, { mode: 0o700 });
    const reserved = await open(snapshotPath, 'wx', 0o600);
    await reserved.close();
    await source.backup(snapshotPath);
    const snapshot = new Database(snapshotPath, { fileMustExist: true });
    let integrity;
    try {
      snapshot.pragma('journal_mode = DELETE');
      integrity = inspect(snapshot);
    } finally {
      snapshot.close();
    }
    await syncFile(snapshotPath);
    const checksum = createHash('sha256');
    await pipeline(createReadStream(snapshotPath), checksum);
    const metadata = {
      created_utc: stamp,
      file_sha256: checksum.digest('hex'),
      manifest_format: 'n2-json-v1',
      integrity
    };
    const file = await open(metadataPath, 'wx', 0o600);
    try {
      await file.writeFile(`${JSON.stringify(metadata, null, 2)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await syncFile(temporary);
    await rename(temporary, published);
    await syncFile(directory);
    return { backup: join(published, 'n2.sqlite'), dataset_sha256: integrity.dataset_sha256 };
  } finally {
    source.close();
    await rm(temporary, { recursive: true, force: true });
  }
}
