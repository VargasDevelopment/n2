import {
  ApplicationPreferenceInputSchema,
  ProjectSettingInputSchema,
  type ApplicationPreferenceInput,
  type ApplicationPreferenceKey,
  type ProjectSettingOverrides,
  type ProjectSettingInput,
  type ProjectSettingKey,
  type StoredApplicationPreferences
} from '@n2/contracts';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { WritableProject } from './projectLibraryRepository.js';
import { applicationPreferences, projectSettingOverrides, type schema } from './schema.js';

type N2Database = BetterSQLite3Database<typeof schema>;
type StoredApplicationPreferenceRow = { key: ApplicationPreferenceKey; value: string };
type StoredProjectSettingRow = { key: ProjectSettingKey; value: string };

const serializeSettingValue = (input: { value: unknown }): string => JSON.stringify(input.value);

const parseStoredApplicationPreference = ({
  key,
  value
}: StoredApplicationPreferenceRow): ApplicationPreferenceInput =>
  ApplicationPreferenceInputSchema.parse({ key, value: JSON.parse(value) as unknown });

const parseStoredProjectSetting = ({ key, value }: StoredProjectSettingRow): ProjectSettingInput =>
  ProjectSettingInputSchema.parse({ key, value: JSON.parse(value) as unknown });

const applicationRowsToValues = (
  rows: readonly StoredApplicationPreferenceRow[]
): StoredApplicationPreferences => {
  const values: StoredApplicationPreferences = {};
  for (const row of rows) {
    const setting = parseStoredApplicationPreference(row);
    if (setting.key === 'handleOrientation') values.handleOrientation = setting.value;
    else if (setting.key === 'minimapVisible') values.minimapVisible = setting.value;
    else values.theme = setting.value;
  }
  return values;
};

const projectRowsToValues = (rows: readonly StoredProjectSettingRow[]): ProjectSettingOverrides => {
  const values: ProjectSettingOverrides = {};
  for (const row of rows) {
    const setting = parseStoredProjectSetting(row);
    if (setting.key === 'handleOrientation') values.handleOrientation = setting.value;
    else if (setting.key === 'minimapVisible') values.minimapVisible = setting.value;
    else values.theme = setting.value;
  }
  return values;
};

export const initialSettingsFingerprint = (settings: ProjectSettingOverrides = {}): string =>
  JSON.stringify({
    ...(settings.handleOrientation === undefined
      ? {}
      : { handleOrientation: settings.handleOrientation }),
    ...(settings.minimapVisible === undefined ? {} : { minimapVisible: settings.minimapVisible }),
    ...(settings.theme === undefined ? {} : { theme: settings.theme })
  });

export const getApplicationPreferenceValues = (db: N2Database): StoredApplicationPreferences =>
  applicationRowsToValues(db.select().from(applicationPreferences).all());

export const setApplicationPreference = (
  db: N2Database,
  input: ApplicationPreferenceInput
): void => {
  db.insert(applicationPreferences)
    .values({
      key: input.key,
      value: serializeSettingValue(input),
      updatedAt: new Date().toISOString()
    })
    .onConflictDoUpdate({
      target: applicationPreferences.key,
      set: { value: serializeSettingValue(input), updatedAt: new Date().toISOString() }
    })
    .run();
};

export const restoreApplicationPreference = (
  db: N2Database,
  key: ApplicationPreferenceKey
): void => {
  db.delete(applicationPreferences).where(eq(applicationPreferences.key, key)).run();
};

export const getProjectSettingOverrides = (
  db: N2Database,
  projectId: string
): ProjectSettingOverrides =>
  projectRowsToValues(
    db
      .select({ key: projectSettingOverrides.key, value: projectSettingOverrides.value })
      .from(projectSettingOverrides)
      .where(eq(projectSettingOverrides.workspaceId, projectId))
      .all()
  );

export const setProjectSettingOverride = (
  db: N2Database,
  project: WritableProject,
  input: ProjectSettingInput
): void => {
  db.insert(projectSettingOverrides)
    .values({
      workspaceId: project.id,
      key: input.key,
      value: serializeSettingValue(input),
      updatedAt: new Date().toISOString()
    })
    .onConflictDoUpdate({
      target: [projectSettingOverrides.workspaceId, projectSettingOverrides.key],
      set: { value: serializeSettingValue(input), updatedAt: new Date().toISOString() }
    })
    .run();
};

export const clearProjectSettingOverride = (
  db: N2Database,
  project: WritableProject,
  key: ProjectSettingKey
): void => {
  db.delete(projectSettingOverrides)
    .where(
      and(eq(projectSettingOverrides.workspaceId, project.id), eq(projectSettingOverrides.key, key))
    )
    .run();
};

export const writeProjectSettingOverrides = (
  db: N2Database,
  project: WritableProject,
  settings: ProjectSettingOverrides
): void => {
  if (settings.handleOrientation !== undefined) {
    setProjectSettingOverride(db, project, {
      key: 'handleOrientation',
      value: settings.handleOrientation
    });
  }
  if (settings.minimapVisible !== undefined) {
    setProjectSettingOverride(db, project, {
      key: 'minimapVisible',
      value: settings.minimapVisible
    });
  }
  if (settings.theme !== undefined) {
    setProjectSettingOverride(db, project, { key: 'theme', value: settings.theme });
  }
};
