import type Database from 'better-sqlite3';

type ForeignKeyViolation = {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
};

const violationKey = (violation: ForeignKeyViolation): string =>
  `${violation.table}:${violation.rowid ?? 'null'}:${violation.parent}:${violation.fkid}`;

export const rebuildTables = (
  sqlite: Database.Database,
  failureMessage: string,
  rebuild: () => void
): void => {
  sqlite.pragma('foreign_keys = OFF');
  try {
    const preexistingViolations = new Set(
      (sqlite.pragma('foreign_key_check') as ForeignKeyViolation[]).map(violationKey)
    );
    sqlite.transaction(() => {
      rebuild();
      const introducedViolations = (sqlite.pragma('foreign_key_check') as ForeignKeyViolation[])
        .map(violationKey)
        .filter((violation) => !preexistingViolations.has(violation));
      if (introducedViolations.length > 0) throw new Error(failureMessage);
    })();
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
};
