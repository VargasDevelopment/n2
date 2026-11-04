import { describe, expect, it } from 'vitest';
import {
  ApplicationPreferenceInputSchema,
  ApplicationPreferencesSchema,
  EffectiveProjectSettingsSchema,
  ProjectSettingInputSchema,
  ProjectSettingOverridesSchema,
  ThemeSchema,
  StoredApplicationPreferencesSchema
} from '../src/index.js';

describe('Settings contracts', () => {
  it('keeps setting keys paired with their value types', () => {
    for (const schema of [ApplicationPreferenceInputSchema, ProjectSettingInputSchema]) {
      expect(schema.parse({ key: 'handleOrientation', value: 'vertical' })).toEqual({
        key: 'handleOrientation',
        value: 'vertical'
      });
      expect(schema.parse({ key: 'minimapVisible', value: false })).toEqual({
        key: 'minimapVisible',
        value: false
      });

      expect(schema.parse({ key: 'theme', value: 'paper' })).toEqual({
        key: 'theme',
        value: 'paper'
      });

      expect(() => schema.parse({ key: 'minimapVisible', value: 'false' })).toThrow();
      expect(() => schema.parse({ key: 'theme', value: 'vertical' })).toThrow();
      expect(() => schema.parse({ key: 'handleOrientation', value: true })).toThrow();
    }
  });

  it('stores System as a Theme choice in both scopes and rejects unknown choices', () => {
    expect(ThemeSchema.parse('system')).toBe('system');
    expect(ApplicationPreferenceInputSchema.parse({ key: 'theme', value: 'system' })).toEqual({
      key: 'theme',
      value: 'system'
    });
    expect(StoredApplicationPreferencesSchema.parse({ theme: 'system' })).toEqual({
      theme: 'system'
    });
    expect(
      ApplicationPreferencesSchema.parse({
        values: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'system' },
        productDefaults: {
          handleOrientation: 'horizontal',
          minimapVisible: true,
          theme: 'midnight'
        },
        storedValues: { theme: 'system' }
      }).values.theme
    ).toBe('system');
    for (const value of ['auto', 'System', 'neon', null]) {
      expect(ThemeSchema.safeParse(value).success).toBe(false);
      expect(ApplicationPreferenceInputSchema.safeParse({ key: 'theme', value }).success).toBe(
        false
      );
      expect(ProjectSettingOverridesSchema.safeParse({ theme: value }).success).toBe(false);
    }
    expect(ProjectSettingInputSchema.parse({ key: 'theme', value: 'system' })).toEqual({
      key: 'theme',
      value: 'system'
    });
    expect(ProjectSettingOverridesSchema.parse({ theme: 'system' })).toEqual({ theme: 'system' });
  });

  it('keeps product defaults canonical at the protocol boundary', () => {
    expect(() =>
      ApplicationPreferencesSchema.parse({
        values: { handleOrientation: 'vertical', minimapVisible: false },
        productDefaults: { handleOrientation: 'vertical', minimapVisible: false },
        storedValues: {}
      })
    ).toThrow();
    expect(() =>
      ApplicationPreferencesSchema.parse({
        values: { handleOrientation: 'horizontal', minimapVisible: true },
        productDefaults: { handleOrientation: 'horizontal', minimapVisible: true },
        storedValues: { handleOrientation: 'vertical' }
      })
    ).toThrow();
  });

  it('allows only designated Project overrides', () => {
    expect(StoredApplicationPreferencesSchema.parse({ minimapVisible: false })).toEqual({
      minimapVisible: false
    });
    expect(ProjectSettingOverridesSchema.parse({ handleOrientation: 'horizontal' })).toEqual({
      handleOrientation: 'horizontal'
    });
    expect(ProjectSettingOverridesSchema.parse({ theme: 'ember' })).toEqual({ theme: 'ember' });
    expect(() => ProjectSettingOverridesSchema.parse({ accent: 'ember' })).toThrow();
  });

  it('requires an explainable effective Project snapshot', () => {
    expect(
      EffectiveProjectSettingsSchema.parse({
        projectId: 'project',
        effectiveValues: { handleOrientation: 'vertical', minimapVisible: true, theme: 'paper' },
        applicationValues: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'mono' },
        sources: { handleOrientation: 'project', minimapVisible: 'application', theme: 'project' },
        overrides: { handleOrientation: 'vertical', theme: 'paper' }
      })
    ).toMatchObject({
      sources: { handleOrientation: 'project', minimapVisible: 'application', theme: 'project' },
      overrides: { handleOrientation: 'vertical', theme: 'paper' }
    });

    const base = {
      projectId: 'project',
      effectiveValues: {
        handleOrientation: 'horizontal' as const,
        minimapVisible: true,
        theme: 'midnight' as const
      },
      applicationValues: {
        handleOrientation: 'horizontal' as const,
        minimapVisible: true,
        theme: 'midnight' as const
      },
      sources: {
        handleOrientation: 'application' as const,
        minimapVisible: 'application' as const,
        theme: 'application' as const
      },
      overrides: {}
    };
    expect(() =>
      EffectiveProjectSettingsSchema.parse({
        ...base,
        effectiveValues: { ...base.effectiveValues, handleOrientation: 'horizontal' },
        sources: { ...base.sources, handleOrientation: 'project' },
        overrides: { handleOrientation: 'vertical' }
      })
    ).toThrow();
    expect(() =>
      EffectiveProjectSettingsSchema.parse({
        ...base,
        sources: { ...base.sources, minimapVisible: 'project' }
      })
    ).toThrow();
    // A pinned Theme must be the effective Theme, even when it differs from the application's.
    expect(() =>
      EffectiveProjectSettingsSchema.parse({
        ...base,
        sources: { ...base.sources, theme: 'project' },
        overrides: { theme: 'paper' }
      })
    ).toThrow();
  });
});
