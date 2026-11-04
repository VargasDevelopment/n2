import type { N2Client } from '@n2/client';
import {
  ApplicationPreferenceInputSchema,
  ApplicationPreferenceKeySchema,
  ProjectSettingOverridesSchema,
  ProjectSettingInputSchema,
  ProjectSettingKeySchema,
  ThemeSchema,
  type ApplicationPreferenceInput,
  type ApplicationPreferenceKey,
  type ProjectSettingOverrides,
  type ProjectSettingInput,
  type ProjectSettingKey
} from '@n2/contracts';

export class SettingsCliInputError extends Error {}

const parseApplicationPreferenceKey = (value: string | undefined): ApplicationPreferenceKey => {
  const result = ApplicationPreferenceKeySchema.safeParse(value);
  if (!result.success) {
    throw new SettingsCliInputError(
      'Setting key must be handleOrientation, minimapVisible, or theme.'
    );
  }
  return result.data;
};

const parseProjectSettingKey = (value: string | undefined): ProjectSettingKey => {
  const result = ProjectSettingKeySchema.safeParse(value);
  if (!result.success) {
    throw new SettingsCliInputError(
      'Setting key must be handleOrientation, minimapVisible, or theme.'
    );
  }
  return result.data;
};

const rawSettingInput = (key: string, value: string | undefined) => ({
  key,
  value:
    key === 'minimapVisible' ? (value === 'true' ? true : value === 'false' ? false : value) : value
});

const SETTING_VALUE_ERRORS: Readonly<Record<ApplicationPreferenceKey, string>> = {
  handleOrientation: 'Handle orientation must be horizontal or vertical.',
  minimapVisible: 'Minimap visibility must be true or false.',
  theme: `Theme must be one of ${ThemeSchema.options.join(', ')}.`
};

const settingValueError = (key: ApplicationPreferenceKey): SettingsCliInputError =>
  new SettingsCliInputError(SETTING_VALUE_ERRORS[key]);

const parseApplicationPreferenceValue = (
  key: ApplicationPreferenceKey,
  value: string | undefined
): ApplicationPreferenceInput => {
  const result = ApplicationPreferenceInputSchema.safeParse(rawSettingInput(key, value));
  if (!result.success) throw settingValueError(key);
  return result.data;
};

const parseProjectSettingValue = (
  key: ProjectSettingKey,
  value: string | undefined
): ProjectSettingInput => {
  const result = ProjectSettingInputSchema.safeParse(rawSettingInput(key, value));
  if (!result.success) throw settingValueError(key);
  return result.data;
};

export const parseInitialProjectSettings = (
  source: string | undefined
): ProjectSettingOverrides | undefined => {
  if (source === undefined) return undefined;
  let candidate: unknown;
  try {
    candidate = JSON.parse(source) as unknown;
  } catch {
    throw new SettingsCliInputError('Project settings must be valid JSON.');
  }
  const result = ProjectSettingOverridesSchema.safeParse(candidate);
  if (!result.success) {
    throw new SettingsCliInputError(
      result.error.issues[0]?.message ?? 'Project settings are invalid.'
    );
  }
  return result.data;
};

const runApplicationSettingsAction = async (positionals: readonly string[], client: N2Client) => {
  const [action, rawKey, rawValue] = positionals;
  if (action === 'show' && rawKey === undefined) {
    return client.getApplicationPreferences();
  }
  if (action === 'set' && rawKey !== undefined && rawValue !== undefined) {
    return client.updateApplicationPreference(
      parseApplicationPreferenceValue(parseApplicationPreferenceKey(rawKey), rawValue)
    );
  }
  if (action === 'restore' && rawKey !== undefined && rawValue === undefined) {
    return client.restoreApplicationPreference(parseApplicationPreferenceKey(rawKey));
  }
  throw new SettingsCliInputError(
    'Use settings application show, set <key> <value>, or restore <key>.'
  );
};

const runProjectSettingsAction = async (
  positionals: readonly string[],
  projectId: string,
  client: N2Client
) => {
  const [action, rawKey, rawValue] = positionals;
  if (action === 'show' && rawKey === undefined) {
    return client.getProjectSettings(projectId);
  }
  if (action === 'set' && rawKey !== undefined && rawValue !== undefined) {
    return client.updateProjectSettingOverride(
      projectId,
      parseProjectSettingValue(parseProjectSettingKey(rawKey), rawValue)
    );
  }
  if (action === 'clear' && rawKey !== undefined && rawValue === undefined) {
    return client.clearProjectSettingOverride(projectId, parseProjectSettingKey(rawKey));
  }
  throw new SettingsCliInputError('Use settings project show, set <key> <value>, or clear <key>.');
};

export const runSettingsCommand = async (input: {
  noun: string;
  scope: string | undefined;
  positionals: readonly string[];
  projectId: string;
  hasProjectSelector: boolean;
  client: N2Client;
}): Promise<{ handled: false } | { handled: true; output: unknown }> => {
  const { noun, scope, positionals, projectId, hasProjectSelector, client } = input;
  if (noun !== 'settings') return { handled: false };
  if (scope !== 'application' && scope !== 'project') {
    throw new SettingsCliInputError('Settings scope must be application or project.');
  }
  if (scope === 'application' && hasProjectSelector) {
    throw new SettingsCliInputError('Application Settings do not accept --project.');
  }
  if (positionals.length > 3) {
    throw new SettingsCliInputError('Too many Settings arguments were provided.');
  }
  return {
    handled: true,
    output:
      scope === 'application'
        ? await runApplicationSettingsAction(positionals, client)
        : await runProjectSettingsAction(positionals, projectId, client)
  };
};
