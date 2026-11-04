import {
  resolveEffectiveProjectSettings,
  type ApplicationPreferences,
  type EffectiveProjectSettings
} from '@n2/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api.js';
import {
  APPLICATION_PREFERENCES_QUERY_KEY,
  applyApplicationPreferences,
  projectSettingsQueryKey
} from '../settingsQueries.js';
import { createQueryClient } from '../queryClient.js';
import { SettingsModal } from './SettingsModal.js';

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  clearProjectSettingOverride: vi.fn(),
  getApplicationPreferences: vi.fn(),
  getProjectSettings: vi.fn(),
  restoreApplicationPreference: vi.fn(),
  updateApplicationPreference: vi.fn(),
  updateProjectSettingOverride: vi.fn()
}));

vi.mock('./SettingsPreview.js', () => ({
  SettingsPreview: ({ values }: { values: ApplicationPreferences['values'] }) => (
    <output data-testid="settings-preview-values">
      {values.handleOrientation}:{String(values.minimapVisible)}
    </output>
  )
}));

const applicationPreferences: ApplicationPreferences = {
  values: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
  productDefaults: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
  storedValues: {}
};

const projectSettings: EffectiveProjectSettings = {
  projectId: 'default',
  effectiveValues: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
  applicationValues: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
  sources: {
    handleOrientation: 'application',
    minimapVisible: 'application',
    theme: 'application'
  },
  overrides: {}
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Reads answer with what the server last acknowledged, as the real one does; saves refetch after
// they are acknowledged, so a mock frozen at the first snapshot would undo every save.
const server = { application: applicationPreferences, project: projectSettings };

function acknowledge<Snapshot extends ApplicationPreferences | EffectiveProjectSettings>(
  snapshot: Snapshot
): Snapshot {
  if ('projectId' in snapshot) {
    server.project = snapshot;
  } else {
    server.application = snapshot;
    server.project = applyApplicationPreferences(server.project, snapshot);
  }
  return snapshot;
}

const acknowledging =
  <Snapshot extends ApplicationPreferences | EffectiveProjectSettings>(snapshot: Snapshot) =>
  () =>
    Promise.resolve(acknowledge(snapshot));

const renderModal = (
  props:
    | { initialScope: 'application'; onClose?: () => void }
    | {
        initialScope: 'project';
        onClose?: () => void;
        project: { id: string; name: string };
      },
  applicationSnapshot = applicationPreferences,
  projectSnapshot = projectSettings
) => {
  server.application = applicationSnapshot;
  server.project = projectSnapshot;
  vi.mocked(api.getApplicationPreferences).mockImplementation(() =>
    Promise.resolve(server.application)
  );
  vi.mocked(api.getProjectSettings).mockImplementation(() => Promise.resolve(server.project));
  const queryClient = createQueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = props.onClose ?? vi.fn();
  return {
    onClose,
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <SettingsModal {...props} onClose={onClose} />
      </QueryClientProvider>
    )
  };
};

describe('Settings modal', () => {
  it('lands on Application Preferences from the Library and closes without navigation', async () => {
    const onClose = vi.fn();
    renderModal({ initialScope: 'application', onClose });
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'How N² looks and works.' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Current Project/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close Settings' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('consumes Escape before the underlying canvas can change context', async () => {
    const onClose = vi.fn();
    const underlyingCanvasHandler = vi.fn();
    window.addEventListener('keydown', underlyingCanvasHandler);
    renderModal({ initialScope: 'application', onClose });

    await screen.findByRole('heading', { name: 'How N² looks and works.' });
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
    expect(underlyingCanvasHandler).not.toHaveBeenCalled();
    window.removeEventListener('keydown', underlyingCanvasHandler);
  });

  it('lands on the Current Project from a canvas and switches contexts in place', async () => {
    renderModal({
      initialScope: 'project',
      project: { id: 'default', name: 'Build N²' }
    });
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Shape this workspace.' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Application Preferences/ }));
    expect(await screen.findByRole('heading', { name: 'How N² looks and works.' })).toBeTruthy();
  });

  it('previews and confirms an Application Preference only after it persists', async () => {
    let resolveUpdate: ((value: ApplicationPreferences) => void) | undefined;
    vi.mocked(api.updateApplicationPreference).mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      })
    );
    renderModal({ initialScope: 'application' });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'How N² looks and works.' });
    await user.click(screen.getByRole('button', { name: /Top → Bottom.*Vertical/ }));
    expect(screen.getByTestId('settings-preview-values').textContent).toBe('vertical:true');
    expect(screen.queryByLabelText('Saved')).toBeNull();

    resolveUpdate?.({
      ...applicationPreferences,
      values: { ...applicationPreferences.values, handleOrientation: 'vertical' },
      storedValues: { handleOrientation: 'vertical' }
    });
    expect(await screen.findByLabelText('Saved')).toBeTruthy();
    expect(api.updateApplicationPreference).toHaveBeenCalledWith({
      key: 'handleOrientation',
      value: 'vertical'
    });
  });

  it('rolls a failed save back to durable state and retries the unchanged intent', async () => {
    vi.mocked(api.updateApplicationPreference)
      .mockRejectedValueOnce(new Error('Local service unavailable.'))
      .mockImplementationOnce(
        acknowledging({
          ...applicationPreferences,
          values: { ...applicationPreferences.values, handleOrientation: 'vertical' },
          storedValues: { handleOrientation: 'vertical' }
        })
      );
    renderModal({ initialScope: 'application' });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'How N² looks and works.' });
    await user.click(screen.getByRole('button', { name: /Top → Bottom.*Vertical/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Local service unavailable.');
    expect(screen.getByTestId('settings-preview-values').textContent).toBe('horizontal:true');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Saved')).toBeTruthy();
    expect(screen.getByTestId('settings-preview-values').textContent).toBe('vertical:true');
    expect(api.updateApplicationPreference).toHaveBeenCalledTimes(2);
  });

  it('distinguishes an explicit Project value from the matching Application default', async () => {
    vi.mocked(api.updateProjectSettingOverride).mockResolvedValue({
      ...projectSettings,
      sources: { ...projectSettings.sources, handleOrientation: 'project' },
      overrides: { handleOrientation: 'horizontal' }
    });
    vi.mocked(api.clearProjectSettingOverride).mockResolvedValue(projectSettings);
    renderModal({
      initialScope: 'project',
      project: { id: 'default', name: 'Build N²' }
    });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Shape this workspace.' });
    await user.click(screen.getByRole('button', { name: /Left → Right.*Horizontal/ }));
    await waitFor(() =>
      expect(api.updateProjectSettingOverride).toHaveBeenCalledWith('default', {
        key: 'handleOrientation',
        value: 'horizontal'
      })
    );
    await user.click(screen.getByRole('button', { name: /Use application default.*Left → Right/ }));
    await waitFor(() =>
      expect(api.clearProjectSettingOverride).toHaveBeenCalledWith('default', 'handleOrientation')
    );
  });

  it('refreshes an inheriting Project when an Application Preference changes', async () => {
    const verticalApplication = {
      ...applicationPreferences,
      values: { ...applicationPreferences.values, handleOrientation: 'vertical' as const },
      storedValues: { handleOrientation: 'vertical' as const }
    };
    vi.mocked(api.updateApplicationPreference).mockImplementation(
      acknowledging(verticalApplication)
    );
    renderModal({ initialScope: 'project', project: { id: 'default', name: 'Build N²' } });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Shape this workspace.' });
    await user.click(screen.getByRole('button', { name: /Application Preferences/ }));
    await user.click(screen.getByRole('button', { name: /Top → Bottom.*Vertical/ }));
    await screen.findByLabelText('Saved');
    await user.click(screen.getByRole('button', { name: /Current Project/ }));

    expect(
      await screen.findByRole('button', { name: /Use application default.*Top → Bottom/ })
    ).toBeTruthy();
    expect(screen.getByTestId('settings-preview-values').textContent).toBe('vertical:true');
  });

  it('disables every command control while a save is pending', async () => {
    const storedApplication = {
      ...applicationPreferences,
      storedValues: {
        handleOrientation: applicationPreferences.values.handleOrientation,
        minimapVisible: applicationPreferences.values.minimapVisible
      }
    };
    vi.mocked(api.updateApplicationPreference).mockReturnValue(
      new Promise<ApplicationPreferences>(() => undefined)
    );
    renderModal({ initialScope: 'application' }, storedApplication);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'How N² looks and works.' });
    await user.click(screen.getByRole('button', { name: /Hidden.*Keep the canvas quiet/ }));

    for (const button of screen.getAllByRole('button', { name: 'Restore product default' })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(api.restoreApplicationPreference).not.toHaveBeenCalled();
  });

  it('clears an old Saved confirmation as soon as the next intent begins', async () => {
    const verticalApplication = {
      ...applicationPreferences,
      values: { ...applicationPreferences.values, handleOrientation: 'vertical' as const },
      storedValues: { handleOrientation: 'vertical' as const }
    };
    vi.mocked(api.updateApplicationPreference)
      .mockResolvedValueOnce(verticalApplication)
      .mockReturnValueOnce(new Promise<ApplicationPreferences>(() => undefined));
    renderModal({ initialScope: 'application' });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'How N² looks and works.' });
    await user.click(screen.getByRole('button', { name: /Top → Bottom.*Vertical/ }));
    await screen.findByLabelText('Saved');
    await user.click(screen.getByRole('button', { name: /Left → Right.*Horizontal/ }));

    expect(screen.queryByLabelText('Saved')).toBeNull();
    expect(screen.getByTestId('settings-preview-values').textContent).toBe('horizontal:true');
  });

  it('keeps a pending controller alive by blocking scope changes and dismissal', async () => {
    let rejectUpdate: ((cause: Error) => void) | undefined;
    vi.mocked(api.updateProjectSettingOverride).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectUpdate = reject;
      })
    );
    const { onClose } = renderModal({
      initialScope: 'project',
      project: { id: 'default', name: 'Build N²' }
    });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Shape this workspace.' });
    await user.click(screen.getByRole('button', { name: /Top → Bottom.*Vertical/ }));
    expect(
      screen.getByRole('button', { name: /Application Preferences/ }).hasAttribute('disabled')
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Close Settings' }).hasAttribute('disabled')).toBe(
      true
    );

    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Shape this workspace.' })).toBeTruthy();

    await act(async () => {
      rejectUpdate?.(new Error('Write failed.'));
      await Promise.resolve();
    });
    expect((await screen.findByRole('alert')).textContent).toContain('Write failed.');
    expect(
      screen.getByRole('button', { name: /Application Preferences/ }).hasAttribute('disabled')
    ).toBe(false);
  });

  it('keeps one setting failure and Retry visible while another setting saves', async () => {
    let resolveMinimap: (() => void) | undefined;
    vi.mocked(api.updateApplicationPreference).mockImplementation((input) => {
      if (input.key !== 'minimapVisible') {
        return Promise.reject(new Error('Orientation write failed.'));
      }
      return new Promise((resolve) => {
        resolveMinimap = () =>
          resolve({
            ...applicationPreferences,
            values: { ...applicationPreferences.values, minimapVisible: input.value },
            storedValues: { minimapVisible: input.value }
          });
      });
    });
    renderModal({ initialScope: 'application' });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'How N² looks and works.' });
    await user.click(screen.getByRole('button', { name: /Top → Bottom.*Vertical/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Orientation write failed.');

    await user.click(screen.getByRole('button', { name: /Hidden.*Keep the canvas quiet/ }));
    expect(screen.getByRole('button', { name: 'Retry' }).hasAttribute('disabled')).toBe(true);
    expect(api.updateApplicationPreference).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveMinimap?.();
      await Promise.resolve();
    });
    await screen.findByLabelText('Saved');

    expect(screen.getByRole('alert').textContent).toContain('Orientation write failed.');
    expect(screen.getByRole('button', { name: 'Retry' }).hasAttribute('disabled')).toBe(false);
  });

  it.each(['paper', 'system'] as const)(
    'saves %s as the application Theme from inside a Project that inherits it',
    async (theme) => {
      const updated: ApplicationPreferences = {
        ...applicationPreferences,
        values: { ...applicationPreferences.values, theme },
        storedValues: { theme }
      };
      vi.mocked(api.updateApplicationPreference).mockImplementation(acknowledging(updated));
      const { queryClient } = renderModal({
        initialScope: 'project',
        project: { id: 'default', name: 'Build N²' }
      });
      const user = userEvent.setup();

      await screen.findByRole('heading', { name: 'Shape this workspace.' });
      await user.click(screen.getByRole('button', { name: /Application Preferences/ }));
      await user.click(
        await screen.findByRole('button', { name: theme === 'paper' ? /Paper/ : /System/ })
      );

      expect(api.updateApplicationPreference).toHaveBeenCalledWith({ key: 'theme', value: theme });
      // The document follows this cache entry (see useDocumentTheme).
      await waitFor(() =>
        expect(
          queryClient.getQueryData<ApplicationPreferences>(APPLICATION_PREFERENCES_QUERY_KEY)
            ?.values.theme
        ).toBe(theme)
      );
      expect(
        screen
          .getByRole('button', { name: theme === 'paper' ? /Paper/ : /System/ })
          .getAttribute('aria-pressed')
      ).toBe('true');
      expect(screen.getByRole('button', { name: 'Restore product default' })).toBeTruthy();
    }
  );

  it('pins a Theme to the Project, says so in both scopes, and returns to inheriting', async () => {
    const pinned: EffectiveProjectSettings = {
      ...projectSettings,
      effectiveValues: { ...projectSettings.effectiveValues, theme: 'paper' },
      sources: { ...projectSettings.sources, theme: 'project' },
      overrides: { theme: 'paper' }
    };
    vi.mocked(api.updateProjectSettingOverride).mockImplementation(acknowledging(pinned));
    vi.mocked(api.clearProjectSettingOverride).mockImplementation(acknowledging(projectSettings));
    renderModal({ initialScope: 'project', project: { id: 'default', name: 'Build N²' } });
    const user = userEvent.setup();

    const inherit = await screen.findByRole('button', {
      name: /Use application default.*Midnight, the same as the Library/
    });
    expect(inherit.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Follows the application Theme, Midnight.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^Paper/ }));
    expect(api.updateProjectSettingOverride).toHaveBeenCalledWith('default', {
      key: 'theme',
      value: 'paper'
    });
    expect(
      await screen.findByText('Pinned to Paper here. The Library and other Projects keep Midnight.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Paper/ }).getAttribute('aria-pressed')).toBe(
      'true'
    );

    // Changing the application Theme here would not change this window, so the field says why.
    await user.click(screen.getByRole('button', { name: /Application Preferences/ }));
    expect(
      await screen.findByText(
        'Build N² pins Paper, so this window stays Paper. The Library and other Projects use this Theme.'
      )
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Current Project/ }));
    await user.click(
      await screen.findByRole('button', { name: /Use application default.*Midnight/ })
    );
    expect(api.clearProjectSettingOverride).toHaveBeenCalledWith('default', 'theme');
    expect(await screen.findByText('Follows the application Theme, Midnight.')).toBeTruthy();
  });

  it.each(['application', 'project'] as const)(
    'keeps the editor on an acknowledged save when the refresh after it fails (%s scope)',
    async (scope) => {
      vi.mocked(api.updateApplicationPreference).mockImplementation(
        acknowledging({
          ...applicationPreferences,
          values: { ...applicationPreferences.values, theme: 'paper' },
          storedValues: { theme: 'paper' }
        })
      );
      vi.mocked(api.updateProjectSettingOverride).mockImplementation(
        acknowledging(
          resolveEffectiveProjectSettings({
            projectId: 'default',
            applicationValues: applicationPreferences.values,
            overrides: { theme: 'paper' }
          })
        )
      );
      renderModal(
        scope === 'application'
          ? { initialScope: 'application' }
          : { initialScope: 'project', project: { id: 'default', name: 'Build N²' } }
      );
      const user = userEvent.setup();
      await screen.findByRole('button', { name: /^Paper/ });
      const unavailable = new Error('Local service unavailable.');
      vi.mocked(api.getApplicationPreferences).mockRejectedValue(unavailable);
      vi.mocked(api.getProjectSettings).mockRejectedValue(unavailable);

      await user.click(screen.getByRole('button', { name: /^Paper/ }));
      expect(
        await screen.findByText('Could not refresh Settings. Showing the last saved values.')
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: /^Paper/ }).getAttribute('aria-pressed')).toBe(
        'true'
      );
      expect(screen.queryByText('N² could not load Settings.')).toBeNull();
    }
  );

  const savedValues = { theme: 'paper', minimapVisible: false } as const;
  const savesUnderOverlappingReads = (['application', 'project'] as const).flatMap((scope) => [
    { scope, key: 'theme', button: /^Paper/ } as const,
    { scope, key: 'minimapVisible', button: /Hidden.*Keep the canvas quiet/ } as const
  ]);

  it.each(savesUnderOverlappingReads)(
    'never lets a read that started before a $key save undo it ($scope scope)',
    async ({ scope, key, button }) => {
      vi.mocked(api.updateApplicationPreference).mockImplementation((input) =>
        Promise.resolve(
          acknowledge({
            ...server.application,
            values: { ...server.application.values, [input.key]: input.value }
          })
        )
      );
      vi.mocked(api.updateProjectSettingOverride).mockImplementation((projectId, input) =>
        Promise.resolve(
          acknowledge(
            resolveEffectiveProjectSettings({
              projectId,
              applicationValues: server.application.values,
              overrides: { ...server.project.overrides, [input.key]: input.value }
            })
          )
        )
      );
      const { queryClient } = renderModal(
        scope === 'application'
          ? { initialScope: 'application' }
          : { initialScope: 'project', project: { id: 'default', name: 'Build N²' } }
      );
      const savedValue = () =>
        (scope === 'application'
          ? queryClient.getQueryData<ApplicationPreferences>(APPLICATION_PREFERENCES_QUERY_KEY)
              ?.values
          : queryClient.getQueryData<EffectiveProjectSettings>(projectSettingsQueryKey('default'))
              ?.effectiveValues)?.[key];
      const user = userEvent.setup();
      await screen.findByRole('button', { name: button });

      // A refetch is still answering with the old snapshot when the save is acknowledged.
      let answerOldRead: () => void = () => undefined;
      const oldRead = new Promise<void>((resolve) => {
        answerOldRead = resolve;
      });
      if (scope === 'application') {
        vi.mocked(api.getApplicationPreferences).mockReturnValueOnce(
          oldRead.then(() => applicationPreferences)
        );
      } else {
        vi.mocked(api.getProjectSettings).mockReturnValueOnce(oldRead.then(() => projectSettings));
      }
      void queryClient.refetchQueries({ queryKey: ['settings', scope] });
      await user.click(screen.getByRole('button', { name: button }));
      await waitFor(() => expect(savedValue()).toBe(savedValues[key]));

      await act(async () => {
        answerOldRead();
        await oldRead;
      });
      await waitFor(() => expect(queryClient.isFetching()).toBe(0));
      expect(savedValue()).toBe(savedValues[key]);
    }
  );
});
