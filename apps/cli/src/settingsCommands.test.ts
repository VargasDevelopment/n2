import { createN2Client } from '@n2/client';
import { describe, expect, it, vi } from 'vitest';
import { runSettingsCommand, SettingsCliInputError } from './settingsCommands.js';

const applicationUsage = 'Use settings application show, set <key> <value>, or restore <key>.';
const projectUsage = 'Use settings project show, set <key> <value>, or clear <key>.';
const keyError = 'Setting key must be handleOrientation, minimapVisible, or theme.';

const settingsInput = (scope: string | undefined, positionals: readonly string[]) => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = createN2Client({ fetch });
  return {
    fetch,
    command: {
      noun: 'settings',
      scope,
      positionals,
      projectId: 'project',
      hasProjectSelector: false,
      client
    }
  };
};

describe('Settings command scopes', () => {
  it('restores an Application Preference and returns its response unchanged', async () => {
    const test = settingsInput('application', ['restore', 'theme']);
    const preferences = {
      values: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
      productDefaults: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
      storedValues: {}
    };
    test.fetch.mockResolvedValue(Response.json(preferences));

    expect(await runSettingsCommand(test.command)).toEqual({
      handled: true,
      output: preferences
    });
    expect(test.fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/settings/application/theme',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('shows the selected Project Settings and returns their response unchanged', async () => {
    const test = settingsInput('project', ['show']);
    const values = { handleOrientation: 'horizontal', minimapVisible: true, theme: 'paper' };
    const settings = {
      projectId: 'project',
      effectiveValues: values,
      applicationValues: values,
      sources: {
        handleOrientation: 'application',
        minimapVisible: 'application',
        theme: 'project'
      },
      overrides: { theme: 'paper' }
    };
    test.fetch.mockResolvedValue(Response.json(settings));

    expect(await runSettingsCommand(test.command)).toEqual({ handled: true, output: settings });
    expect(test.fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/projects/project/settings',
      expect.any(Object)
    );
  });

  it.each([
    ['application', [], applicationUsage],
    ['project', [], projectUsage],
    ['application', ['show', 'theme'], applicationUsage],
    ['project', ['show', 'theme'], projectUsage],
    ['application', ['set', 'theme'], applicationUsage],
    ['project', ['set', 'theme'], projectUsage],
    ['application', ['clear', 'theme'], applicationUsage],
    ['project', ['restore', 'theme'], projectUsage],
    ['application', ['restore', 'theme', 'paper'], applicationUsage],
    ['project', ['clear', 'theme', 'paper'], projectUsage],
    ['application', ['restore', 'unknown'], keyError],
    ['project', ['clear', 'unknown'], keyError],
    [
      'application',
      ['set', 'theme', 'paper', 'extra'],
      'Too many Settings arguments were provided.'
    ]
  ] as const)('preserves %s argument errors for %j', async (scope, positionals, message) => {
    const test = settingsInput(scope, positionals);

    await expect(runSettingsCommand(test.command)).rejects.toThrow(
      new SettingsCliInputError(message)
    );
    expect(test.fetch).not.toHaveBeenCalled();
  });

  it('checks scope and Project selectors before action arguments', async () => {
    const test = settingsInput(undefined, ['set', 'theme', 'paper', 'extra']);
    await expect(runSettingsCommand(test.command)).rejects.toThrow(
      'Settings scope must be application or project.'
    );

    test.command.scope = 'application';
    test.command.hasProjectSelector = true;
    await expect(runSettingsCommand(test.command)).rejects.toThrow(
      'Application Settings do not accept --project.'
    );
    expect(test.fetch).not.toHaveBeenCalled();
  });

  it('leaves other command nouns unhandled before validating Settings arguments', async () => {
    const test = settingsInput(undefined, ['set', 'theme', 'paper', 'extra']);
    test.command.noun = 'project';

    expect(await runSettingsCommand(test.command)).toEqual({ handled: false });
    expect(test.fetch).not.toHaveBeenCalled();
  });
});
