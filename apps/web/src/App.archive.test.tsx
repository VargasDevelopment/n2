import type {
  ActivityRun,
  ApplicationPreferences,
  EffectiveProjectSettings,
  ProjectActivity,
  ProjectedProject,
  ProjectSummary
} from '@n2/contracts';
import { N2ApiError } from '@n2/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api.js';
import type { GraphCanvas } from './components/GraphCanvas.js';
import { reconcileProjectSummary } from './projectLibraryQueries.js';
import { createQueryClient } from './queryClient.js';
import { projectQueryKey } from './useProjectCommands.js';

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  executeProjectCommand: vi.fn(),
  getActivity: vi.fn(),
  getApplicationPreferences: vi.fn(),
  getExecution: vi.fn(),
  getLibraryActivity: vi.fn(),
  getProject: vi.fn(),
  getProjectSettings: vi.fn(),
  listProjects: vi.fn(),
  markActivitySeen: vi.fn(),
  restoreProject: vi.fn(),
  updateProjectSettingOverride: vi.fn()
}));

vi.mock('./components/GraphCanvas.js', () => ({
  GraphCanvas: ({ canvasSession }: ComponentProps<typeof GraphCanvas>) => (
    <section aria-label="Mock graph canvas">
      <output data-testid="visible-node-ids">
        {canvasSession.view.graph.nodes.map(({ id }) => id).join(',')}
      </output>
      {canvasSession.kind === 'freeform' ? (
        <button
          type="button"
          onClick={() =>
            void canvasSession.onMoveNodes([{ nodeId: 'ready', position: { x: 5, y: 5 } }])
          }
        >
          Move ready node
        </button>
      ) : null}
    </section>
  )
}));

vi.mock('./components/SettingsPreview.js', () => ({ SettingsPreview: () => null }));

import { App } from './App.js';

const now = '2026-10-18T09:00:00.000Z';
const archivedAt = '2026-10-18T12:00:00.000Z';

const project: ProjectedProject = {
  id: 'default',
  name: 'N²',
  referenceKey: 'N2',
  nodes: [
    {
      id: 'ready',
      reference: 'N2-1',
      title: 'ready',
      description: '',
      kind: 'task',
      requestedStatus: 'ready',
      effectiveStatus: 'ready',
      progress: 0,
      blockedBy: [],
      position: { x: 0, y: 0 },
      version: 0,
      createdAt: now,
      updatedAt: now
    }
  ],
  relationships: [],
  warnings: [],
  latestSequence: 0
};

const summary: ProjectSummary = {
  id: project.id,
  name: project.name,
  referenceKey: project.referenceKey,
  canvasItemCount: project.nodes.length,
  archivedAt: null,
  lifecycleRevision: 0
};

const values = {
  handleOrientation: 'horizontal',
  minimapVisible: true,
  theme: 'midnight'
} as const;
const projectSettings: EffectiveProjectSettings = {
  projectId: project.id,
  applicationValues: values,
  effectiveValues: values,
  overrides: {},
  sources: { handleOrientation: 'application', minimapVisible: 'application', theme: 'application' }
};
const applicationPreferences: ApplicationPreferences = {
  values,
  productDefaults: values,
  storedValues: {}
};

// One agent run that created the ready node, still unseen.
const run: ActivityRun = {
  actor: { kind: 'agent', name: 'builder' },
  startedAt: now,
  endedAt: now,
  firstSequence: 1,
  lastSequence: 1,
  unseen: true,
  entries: [
    {
      subject: { id: 'ready', reference: 'N2-1', title: 'ready', kind: 'task', present: true },
      lastSequence: 1,
      at: now,
      commandCount: 1,
      changes: [{ kind: 'created' }]
    }
  ]
};
const activity: ProjectActivity = {
  projectId: project.id,
  latestSequence: 1,
  seen: null,
  unseenItemCount: 1,
  runs: [run],
  hasEarlier: false
};

beforeEach(() => {
  vi.mocked(api.getActivity).mockResolvedValue(activity);
  vi.mocked(api.getLibraryActivity).mockResolvedValue({
    projects: [{ projectId: project.id, latestSequence: 1, seen: null, unseenItemCount: 1 }],
    runs: [{ ...run, projectId: project.id }],
    hasEarlier: false
  });
  vi.mocked(api.markActivitySeen).mockResolvedValue({ sequence: 1, seenAt: now });
  vi.mocked(api.listProjects).mockResolvedValue({ projects: [summary] });
  vi.mocked(api.getProject).mockResolvedValue(project);
  vi.mocked(api.getProjectSettings).mockResolvedValue(projectSettings);
  vi.mocked(api.getApplicationPreferences).mockResolvedValue(applicationPreferences);
  vi.mocked(api.getExecution).mockResolvedValue({
    projectId: project.id,
    tasks: [],
    attempts: []
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

const renderWorkspace = (pathname = '/projects/default') => {
  window.history.replaceState(null, '', pathname);
  const queryClient = createQueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 10_000 } }
  });
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
  return queryClient;
};

describe('App and Project archive state', () => {
  it('shows an Archived Project link as archived and restores it into the workspace', async () => {
    const archived = { ...summary, archivedAt };
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [archived] });
    vi.mocked(api.restoreProject).mockImplementation(() => {
      // The service now lists the restored Project, so the reconciling refetch agrees.
      const restored = { ...archived, archivedAt: null, lifecycleRevision: 1 };
      vi.mocked(api.listProjects).mockResolvedValue({ projects: [restored] });
      return Promise.resolve({ disposition: 'updated', project: restored });
    });
    const user = userEvent.setup();
    renderWorkspace();

    expect(await screen.findByText(`${project.name} is archived.`)).toBeTruthy();
    expect(screen.queryByTestId('visible-node-ids')).toBeNull();
    expect(api.getProject).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Restore Project' }));
    expect(api.restoreProject).toHaveBeenCalledWith('default');
    expect(await screen.findByTestId('visible-node-ids')).toBeTruthy();
  });

  it('keeps the Library name when a command response from before a rename lands late', async () => {
    let answerMove = (): void => undefined;
    vi.mocked(api.executeProjectCommand).mockImplementation(
      (_projectId, command) =>
        new Promise((resolve) => {
          // The graph this response carries was read before the rename.
          answerMove = () =>
            resolve({
              commandId: command.commandId,
              disposition: 'applied',
              project,
              outcome: { kind: 'nodes_moved', nodeIds: ['ready'] },
              effects: { completedGroupIds: [] }
            });
        })
    );
    const workspaceTitle = () => document.querySelector('.brand-block strong')?.textContent;
    const user = userEvent.setup();
    const queryClient = renderWorkspace();
    await screen.findByTestId('visible-node-ids');
    expect(workspaceTitle()).toBe(project.name);

    await user.click(screen.getByRole('button', { name: 'Move ready node' }));
    const renamed = { ...summary, name: 'Renamed N²', lifecycleRevision: 1 };
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [renamed] });
    await act(() => reconcileProjectSummary(queryClient, renamed));
    await waitFor(() => expect(workspaceTitle()).toBe('Renamed N²'));

    act(() => answerMove());
    await waitFor(() =>
      expect(queryClient.getQueryData<ProjectedProject>(projectQueryKey('default'))?.name).toBe(
        project.name
      )
    );
    expect(workspaceTitle()).toBe('Renamed N²');
  });

  it('shows the archived state when a Settings write finds the Project archived elsewhere', async () => {
    vi.mocked(api.updateProjectSettingOverride).mockImplementation(() => {
      // Another client archived the Project; the service now lists it that way.
      vi.mocked(api.listProjects).mockResolvedValue({
        projects: [{ ...summary, archivedAt, lifecycleRevision: 1 }]
      });
      return Promise.reject(
        new N2ApiError(409, {
          code: 'project_archived',
          error: 'Project default is archived. Restore it before making changes.',
          details: { projectId: 'default', archivedAt }
        })
      );
    });
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByTestId('visible-node-ids');

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Shape this workspace.' });
    const fetchesBeforeWrite = vi.mocked(api.listProjects).mock.calls.length;
    await user.click(screen.getByRole('button', { name: /Top → Bottom.*Vertical/ }));

    expect(await screen.findByText(`${project.name} is archived.`)).toBeTruthy();
    expect(vi.mocked(api.listProjects).mock.calls.length).toBeGreaterThan(fetchesBeforeWrite);
    expect(screen.queryByTestId('visible-node-ids')).toBeNull();
  });

  it('opens Activity for an arrival once, so restoring after an archive does not replay it', async () => {
    vi.mocked(api.restoreProject).mockImplementation(() => {
      const restored = { ...summary, lifecycleRevision: 2 };
      vi.mocked(api.listProjects).mockResolvedValue({ projects: [restored] });
      return Promise.resolve({ disposition: 'updated', project: restored });
    });
    const user = userEvent.setup();
    const queryClient = renderWorkspace('/');

    await user.click(await screen.findByRole('button', { name: /Open what changed/ }));
    await user.click(await screen.findByRole('button', { name: 'Close activity' }));
    expect(screen.queryByRole('complementary', { name: 'Project activity' })).toBeNull();

    // Archived elsewhere, then restored: the gate remounts the workspace.
    const archived = { ...summary, archivedAt, lifecycleRevision: 1 };
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [archived] });
    await act(() => reconcileProjectSummary(queryClient, archived));
    await user.click(await screen.findByRole('button', { name: 'Restore Project' }));

    expect(await screen.findByTestId('visible-node-ids')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Project activity' })).toBeNull();
  });
});
