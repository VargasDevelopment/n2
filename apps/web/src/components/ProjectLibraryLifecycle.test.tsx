import type {
  ProjectLibrary as ProjectLibraryModel,
  ProjectSummary,
  ProjectUpdateResponse
} from '@n2/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api.js';
import { PROJECT_LIBRARY_QUERY_KEY } from '../projectLibraryQueries.js';
import { NotificationProvider } from './NotificationProvider.js';
import { ProjectLibrary } from './ProjectLibrary.js';

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  archiveProject: vi.fn(),
  listProjects: vi.fn(),
  renameProject: vi.fn(),
  restoreProject: vi.fn()
}));

const active: ProjectSummary = {
  id: 'default',
  name: 'Build N²',
  referenceKey: 'N2',
  canvasItemCount: 4,
  archivedAt: null,
  lifecycleRevision: 0
};
const finished: ProjectSummary = {
  id: '00000000-0000-4000-8000-000000000501',
  name: 'Electricity Renewal 2026',
  referenceKey: 'ELEC',
  canvasItemCount: 12,
  archivedAt: '2026-10-01T09:30:00.000Z',
  lifecycleRevision: 0
};
const archivedAt = '2026-10-18T12:00:00.000Z';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// The service's stored Library: lifecycle mocks change it, so a reconciling refetch sees the result.
let served: ProjectSummary[] = [];
const serve = (project: ProjectSummary): ProjectUpdateResponse => {
  served = [...served.filter(({ id }) => id !== project.id), project];
  return { disposition: 'updated', project };
};

const renderLibrary = (
  projects: ProjectSummary[],
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 10_000 } }
  })
) => {
  served = projects;
  vi.mocked(api.listProjects).mockImplementation(() =>
    Promise.resolve({
      projects: [...served].sort((left, right) => (left.name < right.name ? -1 : 1))
    })
  );
  const onOpenProject = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <NotificationProvider>
        <ProjectLibrary
          onCreationActiveChange={vi.fn()}
          onOpenProject={onOpenProject}
          onProjectCreated={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </NotificationProvider>
    </QueryClientProvider>
  );
  return { onOpenProject, queryClient, user: userEvent.setup() };
};

const projectList = () => screen.getByRole('generic', { name: 'Projects' });

/**
 * Starts a Library refetch that captures the service state now but answers only when the returned
 * function runs, as a slow response that crosses a lifecycle change would.
 */
const startSlowLibraryFetch = (queryClient: QueryClient) => {
  const captured = [...served];
  let answer = (): void => undefined;
  vi.mocked(api.listProjects).mockImplementationOnce(
    () =>
      new Promise<ProjectLibraryModel>((resolve) => {
        answer = () => resolve({ projects: captured });
      })
  );
  void queryClient.refetchQueries({ queryKey: PROJECT_LIBRARY_QUERY_KEY });
  return async () => {
    answer();
    await waitFor(() =>
      expect(queryClient.getQueryState(PROJECT_LIBRARY_QUERY_KEY)?.fetchStatus).toBe('idle')
    );
    // Query results reach components on a later tick; let that render land before asserting.
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    return queryClient.getQueryData<ProjectLibraryModel>(PROJECT_LIBRARY_QUERY_KEY)?.projects;
  };
};

describe('Project Library lifecycle', () => {
  it('keeps Archived Projects in a collapsed section and restores them', async () => {
    vi.mocked(api.restoreProject).mockImplementation(() =>
      Promise.resolve(serve({ ...finished, archivedAt: null }))
    );
    const { user } = renderLibrary([active, finished]);

    await screen.findByText('Build N²');
    expect(api.listProjects).toHaveBeenCalledWith({ includeArchived: true });
    expect(within(projectList()).queryByText('Electricity Renewal 2026')).toBeNull();
    const toggle = screen.getByRole('button', { name: /Archived/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Electricity Renewal 2026')).toBeNull();

    await user.click(toggle);
    const archived = screen.getByRole('list', { name: 'Archived Projects' });
    expect(within(archived).getByText('Electricity Renewal 2026')).toBeTruthy();
    expect(within(archived).getByText(/12 canvas items/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Restore Electricity Renewal 2026' }));
    expect(api.restoreProject).toHaveBeenCalledWith(finished.id);
    await waitFor(() =>
      expect(within(projectList()).getByText('Electricity Renewal 2026')).toBeTruthy()
    );
    expect(screen.queryByRole('button', { name: /Archived/ })).toBeNull();
  });

  it('archives without confirmation and offers an immediate undo', async () => {
    vi.mocked(api.archiveProject).mockImplementation(() =>
      Promise.resolve(serve({ ...active, archivedAt }))
    );
    vi.mocked(api.restoreProject).mockImplementation(() => Promise.resolve(serve(active)));
    const confirm = vi.spyOn(window, 'confirm');
    const { user } = renderLibrary([active]);

    await user.click(await screen.findByRole('button', { name: 'Archive Build N²' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(api.archiveProject).toHaveBeenCalledWith('default');
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toContain('Build N² was archived.');
    expect(screen.getByText(/Every Project is archived/)).toBeTruthy();

    await user.click(within(notice).getByRole('button', { name: 'Undo' }));
    expect(api.restoreProject).toHaveBeenCalledWith('default');
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(within(projectList()).getByText('Build N²')).toBeTruthy();
  });

  it('holds Undo while another lifecycle change to the same Project is pending', async () => {
    let finishArchive = (): void => undefined;
    vi.mocked(api.archiveProject)
      .mockImplementationOnce(() => Promise.resolve(serve({ ...active, archivedAt })))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishArchive = () => resolve(serve({ ...active, archivedAt, lifecycleRevision: 2 }));
          })
      );
    vi.mocked(api.restoreProject).mockImplementation(() =>
      Promise.resolve(serve({ ...active, lifecycleRevision: 1 }))
    );
    const { user } = renderLibrary([active]);

    await user.click(await screen.findByRole('button', { name: 'Archive Build N²' }));
    const undo = within(await screen.findByRole('status')).getByRole('button', { name: 'Undo' });
    await user.click(screen.getByRole('button', { name: /Archived/ }));
    await user.click(screen.getByRole('button', { name: 'Restore Build N²' }));
    await user.click(await screen.findByRole('button', { name: 'Archive Build N²' }));

    // Restoring now could finish first, report success, and then lose to the pending archive.
    await waitFor(() => expect(undo.hasAttribute('disabled')).toBe(true));
    await user.click(undo);
    expect(api.restoreProject).toHaveBeenCalledOnce();

    await act(() => {
      finishArchive();
      return Promise.resolve();
    });
    const renewed = within(await screen.findByRole('status')).getByRole('button', { name: 'Undo' });
    await waitFor(() => expect(renewed.hasAttribute('disabled')).toBe(false));
  });

  it('shows a failed undo beside the notice and lets it be retried', async () => {
    vi.mocked(api.archiveProject).mockImplementation(() =>
      Promise.resolve(serve({ ...active, archivedAt }))
    );
    vi.mocked(api.restoreProject)
      .mockRejectedValueOnce(new Error('N² could not reach its local service.'))
      .mockImplementationOnce(() => Promise.resolve(serve(active)));
    const { user } = renderLibrary([active]);

    await user.click(await screen.findByRole('button', { name: 'Archive Build N²' }));
    const notice = await screen.findByRole('status');
    await user.click(within(notice).getByRole('button', { name: 'Undo' }));
    expect((await within(notice).findByRole('alert')).textContent).toContain(
      'could not reach its local service'
    );

    await user.click(within(notice).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(api.restoreProject).toHaveBeenCalledTimes(2);
    expect(within(projectList()).getByText('Build N²')).toBeTruthy();
  });

  it('shows a refused archive on the card that stays in the list', async () => {
    vi.mocked(api.archiveProject).mockRejectedValue(
      new Error('Stop and confirm every active Execution Attempt before archiving this Project.')
    );
    const { user } = renderLibrary([active]);

    await user.click(await screen.findByRole('button', { name: 'Archive Build N²' }));
    expect((await screen.findByRole('alert')).textContent).toContain('active Execution Attempt');
    expect(within(projectList()).getByText('Build N²')).toBeTruthy();
  });

  it('renames inline with Enter, cancels with Escape, and never opens the Project', async () => {
    vi.mocked(api.renameProject).mockImplementation(() =>
      Promise.resolve(serve({ ...active, name: 'Build N² v2' }))
    );
    const { onOpenProject, user } = renderLibrary([active]);

    await user.click(await screen.findByRole('button', { name: 'Rename Build N²' }));
    await user.keyboard('{Escape}');
    expect(api.renameProject).not.toHaveBeenCalled();
    expect(within(projectList()).getByText('Build N²')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Rename Build N²' }));
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Rename Build N²' });
    expect(input.value).toBe('Build N²');
    await user.clear(input);
    await user.type(input, '  Build N² v2 {Enter}');

    expect(api.renameProject).toHaveBeenCalledWith('default', { name: 'Build N² v2' });
    expect(await within(projectList()).findByText('Build N² v2')).toBeTruthy();
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it('shows a change still in flight as pending after the card remounts', async () => {
    let answerRename = (): void => undefined;
    vi.mocked(api.renameProject).mockImplementation(
      () =>
        new Promise((resolve) => {
          answerRename = () => resolve(serve({ ...active, name: 'Build N² v2' }));
        })
    );
    const { queryClient, user } = renderLibrary([active]);
    await user.click(await screen.findByRole('button', { name: 'Rename Build N²' }));
    await user.keyboard('{Control>}a{/Control}Build N² v2{Enter}');

    // Leaving and reopening the Library mounts a fresh card for the same Project.
    cleanup();
    renderLibrary(served, queryClient);
    expect(await within(projectList()).findByText('Build N² v2')).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Rename Build N²' }).disabled
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Archive Build N²' }).disabled
    ).toBe(true);

    act(() => answerRename());
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Archive Build N² v2' }).disabled
      ).toBe(false)
    );
  });

  it('ignores a blank rename', async () => {
    const { user } = renderLibrary([active]);

    await user.click(await screen.findByRole('button', { name: 'Rename Build N²' }));
    await user.clear(screen.getByRole('textbox', { name: 'Rename Build N²' }));
    await user.keyboard('{Enter}');
    expect(api.renameProject).not.toHaveBeenCalled();
    expect(within(projectList()).getByText('Build N²')).toBeTruthy();
  });
});

describe('Project Library responses that cross a lifecycle change', () => {
  it('keeps an archive when an older Library fetch answers afterwards', async () => {
    vi.mocked(api.archiveProject).mockImplementation(() =>
      Promise.resolve(serve({ ...active, archivedAt }))
    );
    const { queryClient, user } = renderLibrary([active]);
    const archive = await screen.findByRole('button', { name: 'Archive Build N²' });
    const answerSlowFetch = startSlowLibraryFetch(queryClient);

    await user.click(archive);
    await screen.findByRole('status');
    expect(await answerSlowFetch()).toEqual([{ ...active, archivedAt }]);

    expect(screen.getByText(/Every Project is archived/)).toBeTruthy();
    expect(screen.queryByRole('generic', { name: 'Projects' })).toBeNull();
  });

  it('keeps a rename when an older Library fetch answers afterwards', async () => {
    vi.mocked(api.renameProject).mockImplementation(() =>
      Promise.resolve(serve({ ...active, name: 'Build N² v2' }))
    );
    const { queryClient, user } = renderLibrary([active]);
    await user.click(await screen.findByRole('button', { name: 'Rename Build N²' }));
    const answerSlowFetch = startSlowLibraryFetch(queryClient);

    await user.keyboard('{Control>}a{/Control}Build N² v2{Enter}');
    await within(projectList()).findByText('Build N² v2');
    expect(await answerSlowFetch()).toEqual([{ ...active, name: 'Build N² v2' }]);

    expect(within(projectList()).getByText('Build N² v2')).toBeTruthy();
    expect(within(projectList()).queryByText('Build N²')).toBeNull();
  });
});
