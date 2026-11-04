import {
  ApplicationPreferenceInputSchema,
  ApplicationPreferenceKeySchema,
  PRODUCT_DEFAULT_SETTINGS,
  resolveEffectiveProjectSettings,
  ProjectSettingInputSchema,
  ProjectSettingKeySchema,
  type ApplicationPreferences,
  type ApplicationPreferenceInput,
  type ApplicationPreferenceKey,
  type EffectiveProjectSettings,
  type ProjectSettingOverrides,
  type ProjectSettingInput,
  type ProjectSettingKey,
  type SettingsValues
} from '@n2/contracts';

export interface SettingsStore {
  getApplicationPreferenceValues(): ApplicationPreferences['storedValues'];
  setApplicationPreference(input: ApplicationPreferenceInput): void;
  restoreApplicationPreference(key: ApplicationPreferenceKey): void;
  getProjectSettingOverrides(projectId: string): ProjectSettingOverrides;
  setProjectSettingOverride(projectId: string, input: ProjectSettingInput): void;
  clearProjectSettingOverride(projectId: string, key: ProjectSettingKey): void;
}

export interface SettingsUseCases {
  queryApplicationPreferences(): ApplicationPreferences;
  updateApplicationPreference(input: ApplicationPreferenceInput): ApplicationPreferences;
  restoreApplicationPreference(key: ApplicationPreferenceKey): ApplicationPreferences;
  queryProjectSettings(projectId: string): EffectiveProjectSettings;
  updateProjectSettingOverride(
    projectId: string,
    input: ProjectSettingInput
  ): EffectiveProjectSettings;
  clearProjectSettingOverride(projectId: string, key: ProjectSettingKey): EffectiveProjectSettings;
}

export const applicationPreferences = (store: SettingsStore): ApplicationPreferences => {
  const stored = store.getApplicationPreferenceValues();
  return {
    values: {
      handleOrientation: stored.handleOrientation ?? PRODUCT_DEFAULT_SETTINGS.handleOrientation,
      minimapVisible: stored.minimapVisible ?? PRODUCT_DEFAULT_SETTINGS.minimapVisible,
      theme: stored.theme ?? PRODUCT_DEFAULT_SETTINGS.theme
    },
    productDefaults: { ...PRODUCT_DEFAULT_SETTINGS },
    storedValues: stored
  };
};

export const effectiveProjectSettings = (
  store: SettingsStore,
  projectId: string
): EffectiveProjectSettings => {
  const applicationValues: SettingsValues = applicationPreferences(store).values;
  const overrides = store.getProjectSettingOverrides(projectId);
  return resolveEffectiveProjectSettings({
    projectId,
    applicationValues,
    overrides
  });
};

export const parseApplicationPreferenceInput = (
  input: ApplicationPreferenceInput
): ApplicationPreferenceInput => ApplicationPreferenceInputSchema.parse(input);

export const parseApplicationPreferenceKey = (
  key: ApplicationPreferenceKey
): ApplicationPreferenceKey => ApplicationPreferenceKeySchema.parse(key);

export const parseProjectSettingInput = (input: ProjectSettingInput): ProjectSettingInput =>
  ProjectSettingInputSchema.parse(input);

export const parseProjectSettingKey = (key: ProjectSettingKey): ProjectSettingKey =>
  ProjectSettingKeySchema.parse(key);
