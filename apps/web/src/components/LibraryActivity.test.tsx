import type {
  CommandActor,
  LibraryActivity,
  LibraryActivityRun,
  ProjectSummary
} from '@n2/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api.js';
import { formatActors, libraryDigest } from '../activityPresentation.js';
import { NotificationProvider } from './NotificationProvider.js';
import { ProjectLibrary } from './ProjectLibrary.js';

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getApplicationPreferences: vi.fn(),
  getLibraryActivity: vi.fn(),
  listProjects: vi.fn(),
  markLibraryActivitySeen: vi.fn()
}));

const summary = (id: string, name: string, referenceKey: string, archived = false) =>
  ({
    id,
    name,
    referenceKey,
    canvasItemCount: 3,
    archivedAt: archived ? '2026-10-01T00:00:00.000Z' : null,
    lifecycleRevision: 0
  }) satisfies ProjectSummary;

const web = summary('web', 'Website relaunch', 'WEB');
const garden = summary('garden', 'Garden research', 'GARDEN');
const home = summary('home', 'Home errands', 'HOME');
const shelved = summary('shelved', 'Shelved', 'OLD', true);
const codex = { kind: 'agent', name: 'codex-review' } as const;
const lead = { kind: 'agent', name: 'example-lead' } as const;

const run = (
  projectId: string,
  actor: CommandActor | null,
  sequence: number,
  unseen: boolean
): LibraryActivityRun => ({
  projectId,
  actor,
  startedAt: `2026-10-20T0${sequence}:00:00.000Z`,
  endedAt: `2026-10-20T0${sequence}:10:00.000Z`,
  firstSequence: sequence,
  lastSequence: sequence,
  unseen,
  entries: [
    {
      subject: {
        id: `${projectId}-item-${sequence}`,
        reference: `${projectId.toUpperCase()}-${sequence}`,
        title: `Item ${sequence}`,
        kind: 'task',
        present: true
      },
      lastSequence: sequence,
      at: `2026-10-20T0${sequence}:10:00.000Z`,
      commandCount: 1,
      changes: [{ kind: 'created' }]
    }
  ]
});

/**
 * Newest first: example-lead and codex-review in WEB, then research in GARDEN, then the Person in WEB.
 * HOME holds only the Person's own changes since its marker, so it has nothing new.
 */
const changed: LibraryActivity = {
  projects: [
    {
      projectId: 'home',
      latestSequence: 3,
      seen: { sequence: 1, seenAt: '2026-10-19T18:40:00.000Z' },
      unseenItemCount: 0
    },
    { projectId: 'garden', latestSequence: 2, seen: null, unseenItemCount: 1 },
    {
      projectId: 'web',
      latestSequence: 9,
      seen: { sequence: 6, seenAt: '2026-10-19T18:40:00.000Z' },
      unseenItemCount: 2
    }
  ],
  runs: [
    run('web', lead, 9, true),
    run('web', codex, 8, true),
    run('garden', null, 2, true),
    run('web', { kind: 'person' }, 6, false),
    run('home', { kind: 'person' }, 1, false)
  ],
  hasEarlier: false
};

const caughtUp: LibraryActivity = {
  projects: changed.projects.map((project) => ({
    ...project,
    seen: { sequence: project.latestSequence, seenAt: '2026-10-20T09:30:00.000Z' },
    unseenItemCount: 0
  })),
  runs: changed.runs.map((run): LibraryActivityRun => ({ ...run, unseen: false })),
  hasEarlier: false
};

beforeEach(() => {
  vi.mocked(api.getApplicationPreferences).mockResolvedValue({
    values: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
    productDefaults: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
    storedValues: {}
  });
  vi.mocked(api.listProjects).mockResolvedValue({ projects: [home, garden, web, shelved] });
  vi.mocked(api.markLibraryActivitySeen).mockResolvedValue({ projects: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderLibrary = (activity: LibraryActivity) => {
  vi.mocked(api.getLibraryActivity).mockResolvedValue(activity);
  const onOpenProject = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

const digest = () => screen.findByRole('region', { name: 'Since you last looked' });

describe('Library digest', () => {
  it('names each changed Project and who changed it, newest first', async () => {
    const { onOpenProject, user } = renderLibrary(changed);
    const rows = within(await digest()).getAllByRole('button', { name: /Open what changed/ });

    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('2 items changed by example-lead and codex-review'),
      expect.stringContaining('1 item changed by Unattributed')
    ]);
    // The card agrees with the digest about who changed it last.
    expect(screen.getByText(/new since you looked · latest by example-lead/)).toBeTruthy();
    await user.click(rows[0]!);
    expect(onOpenProject).toHaveBeenCalledWith('web', { kind: 'activity' });
  });

  it('says the Person is caught up when only their own or seen activity remains', async () => {
    renderLibrary(caughtUp);

    expect(within(await digest()).getByText(/You’re caught up/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open what changed/ })).toBeNull();
  });

  it('stays hidden until the Library has any activity', async () => {
    renderLibrary({ projects: [], runs: [], hasEarlier: false });

    expect(await screen.findByText('Website relaunch')).toBeTruthy();
    await waitFor(() => expect(api.getLibraryActivity).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Since you last looked' })).toBeNull();
  });

  it('leaves out a Project the Library shows as archived', async () => {
    renderLibrary({
      projects: [
        ...changed.projects,
        { projectId: 'shelved', latestSequence: 3, seen: null, unseenItemCount: 1 }
      ],
      runs: [run('shelved', codex, 3, true), ...changed.runs],
      hasEarlier: false
    });
    const rows = within(await digest()).getAllByRole('button', { name: /Open what changed/ });

    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Website relaunch'),
      expect.stringContaining('Garden research')
    ]);
  });
});

describe('Library feed', () => {
  const openFeed = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(within(await digest()).getByRole('button', { name: 'All activity' }));
    return screen.getByRole('complementary', { name: 'Library activity' });
  };

  it('marks exactly the Projects it loaded something new for when it closes', async () => {
    const { user } = renderLibrary(changed);
    const feed = await openFeed(user);

    expect(
      within(feed).getByText('3 items changed in 2 Projects since you last looked')
    ).toBeTruthy();
    // Every run is headed by the Project it happened in, newest first across Projects.
    expect(
      [...feed.querySelectorAll('.activity-run__project-key')].map((key) => key.textContent)
    ).toEqual(['WEB', 'WEB', 'GARDEN', 'WEB', 'HOME']);
    await user.click(within(feed).getByRole('button', { name: 'Close activity' }));

    // HOME moved on only by the Person's own changes, so it is never acknowledged.
    expect(api.markLibraryActivitySeen).toHaveBeenCalledExactlyOnceWith({
      projects: [
        { projectId: 'garden', sequence: 2 },
        { projectId: 'web', sequence: 9 }
      ]
    });
  });

  it('acknowledges what it opened onto, not what a poll brought in while it was open', async () => {
    const { queryClient, user } = renderLibrary(changed);
    const feed = await openFeed(user);
    const later: LibraryActivity = {
      ...changed,
      projects: changed.projects.map((project) =>
        project.projectId === 'web'
          ? { ...project, latestSequence: 10, unseenItemCount: 3 }
          : project
      ),
      // Its item is WEB-7; the run sits at sequence 10, after everything the feed loaded.
      runs: [
        { ...run('web', codex, 7, true), firstSequence: 10, lastSequence: 10 },
        ...changed.runs
      ]
    };
    vi.mocked(api.getLibraryActivity).mockResolvedValue(later);
    await queryClient.refetchQueries({ queryKey: ['library-activity'] });
    // The digest moves on; the open sheet stays as it was read.
    await waitFor(() => expect(screen.getByText(/3 items changed by/)).toBeTruthy());
    expect(within(feed).queryByRole('button', { name: /WEB-7/ })).toBeNull();

    await user.click(within(feed).getByRole('button', { name: 'Close activity' }));
    expect(api.markLibraryActivitySeen).toHaveBeenCalledExactlyOnceWith({
      projects: [
        { projectId: 'garden', sequence: 2 },
        { projectId: 'web', sequence: 9 }
      ]
    });
  });

  it('drops a Project archived while it is open for good, even once it is restored', async () => {
    const { queryClient, user } = renderLibrary(changed);
    const feed = await openFeed(user);
    vi.mocked(api.listProjects).mockResolvedValue({
      projects: [home, { ...garden, archivedAt: '2026-10-20T10:00:00.000Z' }, web, shelved]
    });
    await queryClient.refetchQueries({ queryKey: ['project-library'] });
    await waitFor(() =>
      expect(within(feed).queryByRole('button', { name: /GARDEN-2/ })).toBeNull()
    );

    vi.mocked(api.listProjects).mockResolvedValue({ projects: [home, garden, web, shelved] });
    await queryClient.refetchQueries({ queryKey: ['project-library'] });
    // The digest shows it again; the open sheet does not.
    await waitFor(async () =>
      expect(
        within(await digest()).getAllByRole('button', { name: /Open what changed/ })
      ).toHaveLength(2)
    );
    expect(within(feed).queryByRole('button', { name: /GARDEN-2/ })).toBeNull();
    await user.click(within(feed).getByRole('button', { name: 'Close activity' }));
    expect(api.markLibraryActivitySeen).toHaveBeenCalledExactlyOnceWith({
      projects: [{ projectId: 'web', sequence: 9 }]
    });
  });

  it('keeps an open Project draft: no feed link leaves the Library while creating', async () => {
    const { onOpenProject, user } = renderLibrary(changed);
    const feed = await openFeed(user);

    await user.click(screen.getByRole('button', { name: 'New Project' }));
    await user.click(within(feed).getByRole('button', { name: /GARDEN-2/ }));
    await user.click(within(feed).getAllByRole('button', { name: /Website relaunch/ })[0]!);
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it('writes nothing when nothing it loaded was new', async () => {
    const { user } = renderLibrary(caughtUp);
    const feed = await openFeed(user);

    await user.keyboard('{Escape}');
    expect(feed.isConnected).toBe(false);
    expect(api.markLibraryActivitySeen).not.toHaveBeenCalled();
  });

  it('opens an item in its Project as of the response, without acknowledging the feed', async () => {
    const { onOpenProject, user } = renderLibrary(changed);
    const feed = await openFeed(user);

    await user.click(within(feed).getByRole('button', { name: /GARDEN-2/ }));
    expect(onOpenProject).toHaveBeenCalledWith('garden', {
      kind: 'item',
      nodeId: 'garden-item-2',
      sequence: 2
    });
    expect(api.markLibraryActivitySeen).not.toHaveBeenCalled();
  });
});

describe('Library digest rows', () => {
  it('reads only unseen runs and names each actor once', () => {
    const runs = [
      run('web', codex, 9, true),
      run('web', codex, 8, true),
      run('web', lead, 7, false)
    ];
    expect(libraryDigest({ ...changed, runs })).toEqual([
      { projectId: 'web', unseenItemCount: 2, actors: [codex], latestAt: runs[0]!.endedAt }
    ]);
    expect(formatActors([codex, lead, null, { kind: 'agent', name: 'x' }])).toBe(
      'codex-review, example-lead and 2 others'
    );
  });
});
