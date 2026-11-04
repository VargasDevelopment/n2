import { describe, expect, it } from 'vitest';
import { resolveEffectiveProjectSettings } from './settings.js';

describe('effective Project Settings resolution', () => {
  it('inherits missing values and preserves explicit overrides equal to an Application default', () => {
    expect(
      resolveEffectiveProjectSettings({
        projectId: 'project-1',
        applicationValues: {
          handleOrientation: 'horizontal',
          minimapVisible: false,
          theme: 'ember'
        },
        overrides: { handleOrientation: 'horizontal', theme: 'system' }
      })
    ).toEqual({
      projectId: 'project-1',
      applicationValues: { handleOrientation: 'horizontal', minimapVisible: false, theme: 'ember' },
      effectiveValues: { handleOrientation: 'horizontal', minimapVisible: false, theme: 'system' },
      sources: { handleOrientation: 'project', minimapVisible: 'application', theme: 'project' },
      overrides: { handleOrientation: 'horizontal', theme: 'system' }
    });
  });
});
