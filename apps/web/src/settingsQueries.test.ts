import type { ApplicationPreferences, EffectiveProjectSettings } from '@n2/contracts';
import { describe, expect, it } from 'vitest';
import { applyApplicationPreferences } from './settingsQueries.js';

const application: ApplicationPreferences = {
  values: { handleOrientation: 'vertical', minimapVisible: false, theme: 'ember' },
  productDefaults: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
  storedValues: { handleOrientation: 'vertical', minimapVisible: false, theme: 'ember' }
};

const project: EffectiveProjectSettings = {
  projectId: 'project-1',
  applicationValues: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
  effectiveValues: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
  overrides: {},
  sources: { handleOrientation: 'application', minimapVisible: 'application', theme: 'application' }
};

describe('settings query projection', () => {
  it('updates every inherited value, including the Theme, from new Application Preferences', () => {
    const inherited = { handleOrientation: 'vertical', minimapVisible: false, theme: 'ember' };
    const projected = applyApplicationPreferences(project, application);
    expect(projected.applicationValues).toEqual(inherited);
    expect(projected.effectiveValues).toEqual(inherited);
  });

  it('keeps explicit Project values pinned, including values equal to the old default', () => {
    const pinned: EffectiveProjectSettings = {
      ...project,
      overrides: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
      sources: { handleOrientation: 'project', minimapVisible: 'project', theme: 'project' }
    };

    expect(applyApplicationPreferences(pinned, application).effectiveValues).toEqual({
      handleOrientation: 'horizontal',
      minimapVisible: true,
      theme: 'midnight'
    });
  });
});
