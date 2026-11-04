import type {
  ApplicationPreferences,
  ProjectLibrary as ProjectLibraryModel,
  SettingsValues
} from '@n2/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api.js';
import { APPLICATION_PREFERENCES_QUERY_KEY } from '../settingsQueries.js';
import { NotificationProvider } from './NotificationProvider.js';
import { ProjectLibrary } from './ProjectLibrary.js';

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  createProject: vi.fn(),
  getApplicationPreferences: vi.fn(),
  listProjects: vi.fn()
}));

vi.mock('./SettingsPreview.js', () => ({
  SettingsPreview: ({ values }: { values: SettingsValues }) => (
    <output data-testid="settings-preview-values">
      {values.handleOrientation}:{String(values.minimapVisible)}
    </output>
  )
}));

const library: ProjectLibraryModel = {
  projects: [
    {
      id: 'default',
      name: 'Build N²',
      referenceKey: 'N2',
      canvasItemCount: 42,
      archivedAt: null,
      lifecycleRevision: 0
    },
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Decision log',
      referenceKey: 'DL',
      canvasItemCount: 0,
      archivedAt: null,
      lifecycleRevision: 0
    }
  ]
};

const applicationPreferences: ApplicationPreferences = {
  values: { handleOrientation: 'vertical', minimapVisible: false, theme: 'midnight' },
  productDefaults: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
  storedValues: { handleOrientation: 'vertical', minimapVisible: false }
};

beforeEach(() => {
  vi.mocked(api.getApplicationPreferences).mockResolvedValue(applicationPreferences);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const renderLibrary = (onOpenProject = vi.fn(), onOpenSettings = vi.fn()) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 10_000 } }
  });
  const onCreationActiveChange = vi.fn();
  return {
    onCreationActiveChange,
    onOpenProject,
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <NotificationProvider>
          <ProjectLibrary
            onCreationActiveChange={onCreationActiveChange}
            onOpenProject={onOpenProject}
            onProjectCreated={onOpenProject}
            onOpenSettings={onOpenSettings}
          />
        </NotificationProvider>
      </QueryClientProvider>
    )
  };
};

describe('Project Library', () => {
  it('opens Application Preferences without leaving the Library', async () => {
    vi.mocked(api.listProjects).mockResolvedValue(library);
    const onOpenSettings = vi.fn();
    renderLibrary(vi.fn(), onOpenSettings);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('lists local Projects and opens the selected graph', async () => {
    vi.mocked(api.listProjects).mockResolvedValue(library);
    const { onOpenProject } = renderLibrary();
    const user = userEvent.setup();

    expect(await screen.findByText('Build N²')).toBeTruthy();
    expect(screen.getByText('42 canvas items')).toBeTruthy();
    expect(screen.getByText('0 canvas items')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Decision log.*canvas items/ }));
    expect(onOpenProject).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001', undefined);
  });

  it('keeps the listed Projects when a refresh fails, and says so', async () => {
    vi.mocked(api.listProjects).mockResolvedValue(library);
    const { queryClient } = renderLibrary();
    expect(await screen.findByText('Build N²')).toBeTruthy();

    vi.mocked(api.listProjects).mockRejectedValue(new Error('Local service unavailable.'));
    await act(() => queryClient.refetchQueries());

    expect(
      await screen.findByText(
        'Could not refresh the Project Library. Showing the last loaded list.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Build N²')).toBeTruthy();
    expect(screen.queryByText('N² could not reach its local service.')).toBeNull();
  });

  it('creates an empty Project with a durable reference-key preview and opens it', async () => {
    vi.mocked(api.listProjects).mockResolvedValue(library);
    vi.mocked(api.createProject).mockResolvedValue({
      disposition: 'created',
      project: {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Garden decision',
        referenceKey: 'GD',
        canvasItemCount: 0,
        archivedAt: null,
        lifecycleRevision: 0
      }
    });
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000002');
    const { onOpenProject } = renderLibrary();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'New Project' }));
    await user.type(screen.getByLabelText('Name'), 'Garden decision');
    expect(screen.getByLabelText<HTMLInputElement>('Reference key').value).toBe('GD');
    expect(screen.getByText('GD-1')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() =>
      expect(api.createProject).toHaveBeenCalledWith(
        {
          projectId: '00000000-0000-4000-8000-000000000002',
          name: 'Garden decision',
          referenceKey: 'GD'
        },
        expect.anything()
      )
    );
    expect(onOpenProject).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000002');
  });

  it('keeps creation Settings collapsed until requested and submits explicit draft overrides', async () => {
    const projectId = '00000000-0000-4000-8000-000000000004';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(projectId);
    vi.mocked(api.listProjects).mockResolvedValue(library);
    vi.mocked(api.createProject).mockResolvedValue({
      disposition: 'created',
      project: {
        id: projectId,
        name: 'Release map',
        referenceKey: 'RM',
        canvasItemCount: 0,
        archivedAt: null,
        lifecycleRevision: 0
      }
    });
    renderLibrary();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'New Project' }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'New Project' }).disabled).toBe(
      true
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Settings' }).disabled).toBe(true);
    expect(screen.getByText('Application defaults')).toBeTruthy();
    expect(api.getApplicationPreferences).not.toHaveBeenCalled();
    expect(screen.queryByTestId('settings-preview-values')).toBeNull();

    await user.click(screen.getByText('Project settings'));
    expect((await screen.findByTestId('settings-preview-values')).textContent).toBe(
      'vertical:false'
    );
    expect(screen.getAllByRole('button', { name: /use application default/i })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /left.*right.*horizontal/i }));
    await user.click(screen.getByRole('button', { name: /hidden.*keep the canvas quiet/i }));
    expect(screen.getByTestId('settings-preview-values').textContent).toBe('horizontal:false');
    expect(screen.getByText('Custom settings')).toBeTruthy();

    await user.type(screen.getByLabelText('Name'), 'Release map');
    await user.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() =>
      expect(api.createProject).toHaveBeenCalledWith(
        {
          projectId,
          name: 'Release map',
          referenceKey: 'RM',
          settings: { handleOrientation: 'horizontal', minimapVisible: false }
        },
        expect.anything()
      )
    );
  });

  it('discards creation-time Settings when the creator is cancelled', async () => {
    vi.mocked(api.listProjects).mockResolvedValue(library);
    renderLibrary();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'New Project' }));
    await user.click(screen.getByText('Project settings'));
    await screen.findByTestId('settings-preview-values');
    await user.click(screen.getByRole('button', { name: /left.*right.*horizontal/i }));
    expect(screen.getByText('Custom settings')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Close Project creator' }));
    await user.click(screen.getByRole('button', { name: 'New Project' }));

    expect(screen.getByText('Application defaults')).toBeTruthy();
    expect(screen.queryByTestId('settings-preview-values')).toBeNull();
  });

  it('releases the creation guard when the Project Library unmounts', async () => {
    vi.mocked(api.listProjects).mockResolvedValue(library);
    const { onCreationActiveChange, unmount } = renderLibrary();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'New Project' }));
    expect(onCreationActiveChange).toHaveBeenLastCalledWith(true);
    unmount();

    expect(onCreationActiveChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps cached settings visible when refreshing application defaults fails', async () => {
    vi.mocked(api.listProjects).mockResolvedValue(library);
    vi.mocked(api.getApplicationPreferences).mockRejectedValue(new Error('Refresh failed.'));
    const { queryClient } = renderLibrary();
    queryClient.setQueryData(APPLICATION_PREFERENCES_QUERY_KEY, applicationPreferences);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'New Project' }));
    await user.click(screen.getByText('Project settings'));

    expect((await screen.findByTestId('settings-preview-values')).textContent).toBe(
      'vertical:false'
    );
    expect(
      await screen.findByText(
        'Could not refresh application defaults. Using the last local values.'
      )
    ).toBeTruthy();
    expect(api.getApplicationPreferences).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /left.*right.*horizontal/i })).toBeTruthy();
  });

  it('freezes the complete creation intent while the atomic request is pending', async () => {
    const projectId = '00000000-0000-4000-8000-000000000005';
    let resolveCreation!: (value: Awaited<ReturnType<typeof api.createProject>>) => void;
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(projectId);
    vi.mocked(api.listProjects).mockResolvedValue(library);
    vi.mocked(api.createProject).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreation = resolve;
        })
    );
    const { onOpenProject } = renderLibrary();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'New Project' }));
    await user.click(screen.getByText('Project settings'));
    await screen.findByTestId('settings-preview-values');
    await user.click(screen.getByRole('button', { name: /left.*right.*horizontal/i }));
    await user.type(screen.getByLabelText('Name'), 'Release map');
    await user.click(screen.getByRole('button', { name: 'Create Project' }));

    expect(screen.getByLabelText<HTMLInputElement>('Name').disabled).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Reference key').disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /left.*right.*horizontal/i }).disabled
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Close Project creator' }).disabled
    ).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'New Project' }).disabled).toBe(
      true
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Settings' }).disabled).toBe(true);
    const projectCard = screen.getByText('Decision log').closest('button') as HTMLButtonElement;
    expect(projectCard.disabled).toBe(true);
    await user.click(projectCard);
    expect(onOpenProject).not.toHaveBeenCalled();

    resolveCreation({
      disposition: 'created',
      project: {
        id: projectId,
        name: 'Release map',
        referenceKey: 'RM',
        canvasItemCount: 0,
        archivedAt: null,
        lifecycleRevision: 0
      }
    });
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith(projectId));
  });

  it('rejects an invalid reference key before contacting the local service', async () => {
    vi.mocked(api.listProjects).mockResolvedValue(library);
    renderLibrary();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'New Project' }));
    await user.type(screen.getByLabelText('Name'), 'X');
    await user.click(screen.getByRole('button', { name: 'Create Project' }));

    expect((await screen.findByRole('alert')).textContent).toContain('2–10 uppercase');
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it('reuses the draft identity when retrying after an ambiguous failure', async () => {
    const projectId = '00000000-0000-4000-8000-000000000003';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(projectId);
    vi.mocked(api.listProjects).mockResolvedValue(library);
    vi.mocked(api.createProject)
      .mockRejectedValueOnce(new api.LocalTransportError('service_timeout', 'Response was lost.'))
      .mockResolvedValueOnce({
        disposition: 'existing',
        project: {
          id: projectId,
          name: 'Garden',
          referenceKey: 'GARDEN',
          canvasItemCount: 0,
          archivedAt: null,
          lifecycleRevision: 0
        }
      });
    const { onOpenProject } = renderLibrary();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'New Project' }));
    await user.click(screen.getByText('Project settings'));
    await screen.findByTestId('settings-preview-values');
    await user.click(screen.getByRole('button', { name: /left.*right.*horizontal/i }));
    await user.type(screen.getByLabelText('Name'), 'Garden');
    await user.click(screen.getByRole('button', { name: 'Create Project' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Response was lost.');
    expect(screen.getByLabelText<HTMLInputElement>('Name').disabled).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Reference key').disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /left.*right.*horizontal/i }).disabled
    ).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'New Project' }).disabled).toBe(
      true
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Settings' }).disabled).toBe(true);
    const projectCard = screen.getByText('Decision log').closest('button') as HTMLButtonElement;
    expect(projectCard.disabled).toBe(true);
    await user.click(projectCard);
    expect(onOpenProject).not.toHaveBeenCalled();
    await waitFor(() => expect(api.listProjects).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Retry creation' }));

    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.createProject).mock.calls.map(([input]) => input)).toEqual([
      {
        projectId,
        name: 'Garden',
        referenceKey: 'GARDEN',
        settings: { handleOrientation: 'horizontal' }
      },
      {
        projectId,
        name: 'Garden',
        referenceKey: 'GARDEN',
        settings: { handleOrientation: 'horizontal' }
      }
    ]);
    expect(onOpenProject).toHaveBeenCalledWith(projectId);
  });

  it('retries a failed Project Library query in place', async () => {
    vi.mocked(api.listProjects)
      .mockRejectedValueOnce(new Error('Service is starting.'))
      .mockResolvedValueOnce(library);
    renderLibrary();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Build N²')).toBeTruthy();
    expect(api.listProjects).toHaveBeenCalledTimes(2);
  });
});
