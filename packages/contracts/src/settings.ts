import { z } from 'zod';

export const HandleOrientationSchema = z.enum(['horizontal', 'vertical']);
export type HandleOrientation = z.infer<typeof HandleOrientationSchema>;

// Built-in Theme choices. System resolves to Paper or Midnight in the browser; concrete Themes
// need token blocks in apps/web. Adding any choice needs a migration widening both SQLite CHECKs.
export const ThemeSchema = z.enum(['midnight', 'mono', 'paper', 'ember', 'system']);
export type Theme = z.infer<typeof ThemeSchema>;

// The values a Project resolves. Every one is also an Application Preference that supplies its
// default, so the two records share one shape (ADR 0009, ADR 0019).
export const SettingsValuesSchema = z
  .object({
    handleOrientation: HandleOrientationSchema,
    minimapVisible: z.boolean(),
    theme: ThemeSchema
  })
  .strict();
export type SettingsValues = z.infer<typeof SettingsValuesSchema>;

export const ApplicationPreferenceValuesSchema = SettingsValuesSchema;
export type ApplicationPreferenceValues = z.infer<typeof ApplicationPreferenceValuesSchema>;

export const PRODUCT_DEFAULT_SETTINGS = Object.freeze({
  handleOrientation: 'horizontal',
  minimapVisible: true,
  theme: 'midnight'
}) satisfies Readonly<ApplicationPreferenceValues>;

const ProductDefaultSettingsSchema = z
  .object({
    handleOrientation: z.literal(PRODUCT_DEFAULT_SETTINGS.handleOrientation),
    minimapVisible: z.literal(PRODUCT_DEFAULT_SETTINGS.minimapVisible),
    theme: z.literal(PRODUCT_DEFAULT_SETTINGS.theme)
  })
  .strict();

const HandleOrientationInputSchema = z
  .object({
    key: z.literal('handleOrientation'),
    value: HandleOrientationSchema
  })
  .strict();

const MinimapVisibilityInputSchema = z
  .object({
    key: z.literal('minimapVisible'),
    value: z.boolean()
  })
  .strict();

const ThemeInputSchema = z
  .object({
    key: z.literal('theme'),
    value: ThemeSchema
  })
  .strict();

export const StoredApplicationPreferencesSchema =
  ApplicationPreferenceValuesSchema.partial().strict();
export type StoredApplicationPreferences = z.infer<typeof StoredApplicationPreferencesSchema>;

export const ApplicationPreferenceKeySchema = ApplicationPreferenceValuesSchema.keyof();
export type ApplicationPreferenceKey = z.infer<typeof ApplicationPreferenceKeySchema>;

export const ApplicationPreferenceInputSchema = z.discriminatedUnion('key', [
  HandleOrientationInputSchema,
  MinimapVisibilityInputSchema,
  ThemeInputSchema
]);
export type ApplicationPreferenceInput = z.infer<typeof ApplicationPreferenceInputSchema>;

// Project override capability is intentionally explicit. Adding an Application Preference must
// not make it Project-overridable without also adding it to this designated schema.
export const ProjectOverrideableSettingsSchema = SettingsValuesSchema.pick({
  handleOrientation: true,
  minimapVisible: true,
  theme: true
}).strict();

export const ProjectSettingOverridesSchema = ProjectOverrideableSettingsSchema.partial().strict();
export type ProjectSettingOverrides = z.infer<typeof ProjectSettingOverridesSchema>;

export const ProjectSettingKeySchema = ProjectOverrideableSettingsSchema.keyof();
export type ProjectSettingKey = z.infer<typeof ProjectSettingKeySchema>;

export const ProjectSettingInputSchema = z.discriminatedUnion('key', [
  HandleOrientationInputSchema,
  MinimapVisibilityInputSchema,
  ThemeInputSchema
]);
export type ProjectSettingInput = z.infer<typeof ProjectSettingInputSchema>;

export const ApplicationPreferencesSchema = z
  .object({
    values: ApplicationPreferenceValuesSchema,
    productDefaults: ProductDefaultSettingsSchema,
    storedValues: StoredApplicationPreferencesSchema
  })
  .strict()
  .superRefine((preferences, context) => {
    const check = (key: ApplicationPreferenceKey): void => {
      const expected = preferences.storedValues[key] ?? preferences.productDefaults[key];
      if (preferences.values[key] !== expected) {
        context.addIssue({
          code: 'custom',
          path: ['values', key],
          message:
            'An Application Preference must resolve from its stored value or product default.'
        });
      }
    };
    check('handleOrientation');
    check('minimapVisible');
    check('theme');
  });
export type ApplicationPreferences = z.infer<typeof ApplicationPreferencesSchema>;

const SettingSourcesSchema = z
  .object({
    handleOrientation: z.enum(['application', 'project']),
    minimapVisible: z.enum(['application', 'project']),
    theme: z.enum(['application', 'project'])
  })
  .strict();

export const EffectiveProjectSettingsSchema = z
  .object({
    projectId: z.string().min(1),
    effectiveValues: SettingsValuesSchema,
    applicationValues: SettingsValuesSchema,
    sources: SettingSourcesSchema,
    overrides: ProjectSettingOverridesSchema
  })
  .strict()
  .superRefine((settings, context) => {
    const check = (key: ProjectSettingKey): void => {
      const override = settings.overrides[key];
      if (override === undefined) {
        if (settings.sources[key] !== 'application') {
          context.addIssue({
            code: 'custom',
            path: ['sources', key],
            message: 'A setting without a Project override must come from the application.'
          });
        }
        if (settings.effectiveValues[key] !== settings.applicationValues[key]) {
          context.addIssue({
            code: 'custom',
            path: ['effectiveValues', key],
            message: 'An inherited setting must equal its Application Preference.'
          });
        }
        return;
      }
      if (settings.sources[key] !== 'project') {
        context.addIssue({
          code: 'custom',
          path: ['sources', key],
          message: 'A stored Project override must be reported as the source.'
        });
      }
      if (settings.effectiveValues[key] !== override) {
        context.addIssue({
          code: 'custom',
          path: ['effectiveValues', key],
          message: 'An overridden setting must equal its stored Project override.'
        });
      }
    };
    check('handleOrientation');
    check('minimapVisible');
    check('theme');
  });
export type EffectiveProjectSettings = z.infer<typeof EffectiveProjectSettingsSchema>;

export const resolveEffectiveProjectSettings = ({
  applicationValues,
  overrides,
  projectId
}: {
  applicationValues: SettingsValues;
  overrides: ProjectSettingOverrides;
  projectId: string;
}): EffectiveProjectSettings => ({
  projectId,
  // Spelled out so a wider record passed in, such as a draft with extra fields, never leaks through.
  applicationValues: {
    handleOrientation: applicationValues.handleOrientation,
    minimapVisible: applicationValues.minimapVisible,
    theme: applicationValues.theme
  },
  effectiveValues: {
    handleOrientation: overrides.handleOrientation ?? applicationValues.handleOrientation,
    minimapVisible: overrides.minimapVisible ?? applicationValues.minimapVisible,
    theme: overrides.theme ?? applicationValues.theme
  },
  sources: {
    handleOrientation: overrides.handleOrientation === undefined ? 'application' : 'project',
    minimapVisible: overrides.minimapVisible === undefined ? 'application' : 'project',
    theme: overrides.theme === undefined ? 'application' : 'project'
  },
  overrides
});
