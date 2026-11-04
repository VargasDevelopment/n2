import type {
  EffectiveProjectSettings,
  ProjectCommandResponse,
  ProjectedProject,
  ProjectedWorkNode
} from '@n2/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api.js';
import type { GraphCanvas } from './components/GraphCanvas.js';
import { createQueryClient } from './queryClient.js';

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  executeProjectCommand: vi.fn(),
  getApplicationPreferences: vi.fn(),
  getExecution: vi.fn(),
  getProject: vi.fn(),
  getProjectSettings: vi.fn(),
  listProjects: vi.fn()
}));

// The real preview mounts React Flow, which jsdom cannot lay out.
vi.mock('./components/SettingsPreview.js', () => ({ SettingsPreview: () => null }));

vi.mock('./components/GraphCanvas.js', () => ({
  GraphCanvas: ({
    canvasSession,
    onCycleStatus,
    onDeleteSelection
  }: ComponentProps<typeof GraphCanvas>) => {
    const write = canvasSession.view.graph.nodes.find(({ id }) => id === 'write');
    return (
      <section aria-label="Mock graph canvas">
        <button
          type="button"
          onClick={() => onDeleteSelection({ nodeIds: ['group'], relationshipIds: [] })}
        >
          Delete the Group
        </button>
        <button
          type="button"
          onClick={() => onDeleteSelection({ nodeIds: ['write', 'polish'], relationshipIds: [] })}
        >
          Delete both tasks
        </button>
        <button
          type="button"
          onClick={() =>
            onDeleteSelection({
              nodeIds: ['write'],
              relationshipIds: ['write-membership', 'polish-membership']
            })
          }
        >
          Delete write and both links
        </button>
        {write?.kind === 'task' ? (
          <button type="button" onClick={() => onCycleStatus(write)}>
            Advance write
          </button>
        ) : null}
      </section>
    );
  }
}));

import { App } from './App.js';

const now = '2026-10-18T09:00:00.000Z';
const workNode = (
  id: string,
  reference: string,
  title: string,
  kind: ProjectedWorkNode['kind'],
  status: ProjectedWorkNode['effectiveStatus']
): ProjectedWorkNode => ({
  id,
  reference,
  title,
  description: '',
  kind,
  requestedStatus: status,
  effectiveStatus: status,
  progress: status === 'done' ? 1 : 0,
  blockedBy: [],
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: now,
  updatedAt: now
});

const graph = (writeStatus: 'in_progress' | 'done'): ProjectedProject => ({
  id: 'default',
  name: 'N²',
  referenceKey: 'N2',
  nodes: [
    workNode('group', 'N2-1', 'Ship it', 'group', writeStatus === 'done' ? 'done' : 'in_progress'),
    workNode('write', 'N2-2', 'Write tests', 'task', writeStatus),
    workNode('polish', 'N2-3', 'Polish', 'task', 'done')
  ],
  relationships: ['write', 'polish'].map((memberId) => ({
    id: `${memberId}-membership`,
    kind: 'member_of' as const,
    memberId,
    groupId: 'group',
    createdAt: now,
    isBlocking: false
  })),
  warnings: [],
  latestSequence: 0
});

const response = (
  project: ProjectedProject,
  completedGroupIds: string[] = []
): ProjectCommandResponse => ({
  commandId: '00000000-0000-4000-8000-000000000001',
  disposition: 'applied',
  project,
  outcome: { kind: 'node_updated', nodeId: 'write' },
  effects: { completedGroupIds }
});

const values = {
  handleOrientation: 'horizontal',
  minimapVisible: true,
  theme: 'midnight'
} as const;
const projectSettings: EffectiveProjectSettings = {
  projectId: 'default',
  applicationValues: values,
  effectiveValues: values,
  overrides: {},
  sources: { handleOrientation: 'application', minimapVisible: 'application', theme: 'application' }
};

beforeEach(() => {
  vi.mocked(api.listProjects).mockResolvedValue({
    projects: [
      {
        id: 'default',
        name: 'N²',
        referenceKey: 'N2',
        canvasItemCount: 3,
        archivedAt: null,
        lifecycleRevision: 0
      }
    ]
  });
  vi.mocked(api.getProjectSettings).mockResolvedValue(projectSettings);
  vi.mocked(api.getExecution).mockResolvedValue({ projectId: 'default', tasks: [], attempts: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

const renderWorkspace = async (
  project: ProjectedProject,
  queryClient = createQueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 10_000 } }
  })
) => {
  vi.mocked(api.getProject).mockResolvedValue(project);
  window.history.replaceState(null, '', '/projects/default');
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
  await screen.findByRole('region', { name: 'Mock graph canvas' });
  return userEvent.setup();
};

describe('App confirmations and notifications', () => {
  it('confirms a node delete in a modal that names it and what goes with it', async () => {
    const browserConfirm = vi.spyOn(window, 'confirm');
    const user = await renderWorkspace(graph('in_progress'));
    vi.mocked(api.executeProjectCommand).mockResolvedValue(response(graph('in_progress')));

    await user.click(screen.getByRole('button', { name: 'Delete the Group' }));
    let dialog = await screen.findByRole('dialog', { name: 'Delete group?' });
    expect(within(dialog).getByText('N2-1')).toBeTruthy();
    expect(within(dialog).getByText('Ship it')).toBeTruthy();
    expect(within(dialog).getByText('2 relationships will also be removed.')).toBeTruthy();
    expect(
      within(dialog).getByText('Members of the deleted group stay in the project.')
    ).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.executeProjectCommand).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete the Group' }));
    dialog = await screen.findByRole('dialog', { name: 'Delete group?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete group' }));
    await waitFor(() =>
      expect(api.executeProjectCommand).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({ kind: 'delete_node', nodeId: 'group' })
      )
    );
    expect(browserConfirm).not.toHaveBeenCalled();
  });

  it('confirms a multi-node delete once, then deletes every node in it', async () => {
    const user = await renderWorkspace(graph('in_progress'));
    const remaining = (...ids: string[]): ProjectedProject => ({
      ...graph('in_progress'),
      nodes: graph('in_progress').nodes.filter(({ id }) => ids.includes(id)),
      relationships: []
    });
    vi.mocked(api.executeProjectCommand)
      .mockResolvedValueOnce(response(remaining('group', 'polish')))
      .mockResolvedValueOnce(response(remaining('group')));

    await user.click(screen.getByRole('button', { name: 'Delete both tasks' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete 2 tasks?' });
    expect(within(dialog).getByText('Write tests')).toBeTruthy();
    expect(within(dialog).getByText('Polish')).toBeTruthy();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(api.executeProjectCommand).toHaveBeenCalledTimes(2));
    expect(
      vi.mocked(api.executeProjectCommand).mock.calls.map(([, command]) => command)
    ).toMatchObject([
      { kind: 'delete_node', nodeId: 'write' },
      { kind: 'delete_node', nodeId: 'polish' }
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('deletes relationships selected with the nodes, skipping those the nodes took along', async () => {
    const user = await renderWorkspace(graph('in_progress'));
    const withoutWrite: ProjectedProject = {
      ...graph('in_progress'),
      nodes: graph('in_progress').nodes.filter(({ id }) => id !== 'write'),
      relationships: graph('in_progress').relationships.filter(
        ({ id }) => id !== 'write-membership'
      )
    };
    vi.mocked(api.executeProjectCommand)
      .mockResolvedValueOnce(response(withoutWrite))
      .mockResolvedValueOnce(response({ ...withoutWrite, relationships: [] }));

    await user.click(screen.getByRole('button', { name: 'Delete write and both links' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete task?' });
    expect(within(dialog).getByText('2 relationships will also be removed.')).toBeTruthy();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(api.executeProjectCommand).toHaveBeenCalledTimes(2));
    expect(
      vi.mocked(api.executeProjectCommand).mock.calls.map(([, command]) => command)
    ).toMatchObject([
      { kind: 'delete_node', nodeId: 'write' },
      { kind: 'delete_relationship', relationshipId: 'polish-membership' }
    ]);
  });

  it('celebrates the Group Completions a receipt reports, but not one that loads complete', async () => {
    const user = await renderWorkspace(graph('in_progress'));
    expect(screen.queryByRole('status')).toBeNull();
    vi.mocked(api.executeProjectCommand).mockResolvedValue(response(graph('done'), ['group']));

    await user.click(screen.getByRole('button', { name: 'Advance write' }));

    const toast = await screen.findByRole('status');
    expect(toast.textContent).toBe('N2-1Ship it — complete×');
  });
});

const navigateBackToLibrary = async (): Promise<void> => {
  act(() => {
    window.history.pushState(null, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await screen.findByRole('heading', { name: 'Choose where to think.' });
};

describe('App workspace session', () => {
  it('cancels an open delete confirmation when the user navigates away', async () => {
    const user = await renderWorkspace(graph('in_progress'));

    await user.click(screen.getByRole('button', { name: 'Delete the Group' }));
    await screen.findByRole('dialog', { name: 'Delete group?' });
    await navigateBackToLibrary();

    expect(screen.queryByRole('dialog')).toBeNull();
    await user.keyboard('{Enter}');
    expect(api.executeProjectCommand).not.toHaveBeenCalled();
  });

  it('stays silent when a write fails after the user has left its workspace', async () => {
    const user = await renderWorkspace(graph('in_progress'));
    let failWrite: (cause: Error) => void = () => undefined;
    vi.mocked(api.executeProjectCommand).mockReturnValue(
      new Promise((_, reject) => {
        failWrite = reject;
      })
    );

    await user.click(screen.getByRole('button', { name: 'Advance write' }));
    await navigateBackToLibrary();
    failWrite(new Error('Write tests changed elsewhere.'));

    // The failure reconciles against the server before it would report.
    await waitFor(() => expect(api.getProject).toHaveBeenCalledTimes(2));
    await act(() => Promise.resolve());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the canvas and Settings usable when a refresh fails over loaded data', async () => {
    vi.mocked(api.getApplicationPreferences).mockResolvedValue({
      values,
      productDefaults: values,
      storedValues: {}
    });
    const queryClient = createQueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 10_000 } }
    });
    const user = await renderWorkspace(graph('in_progress'), queryClient);

    const unavailable = new Error('Local service unavailable.');
    vi.mocked(api.getProject).mockRejectedValue(unavailable);
    vi.mocked(api.getProjectSettings).mockRejectedValue(unavailable);
    vi.mocked(api.getExecution).mockRejectedValue(unavailable);
    await act(() => queryClient.refetchQueries());

    expect(screen.getByRole('region', { name: 'Mock graph canvas' })).toBeTruthy();
    expect(
      await screen.findByText('Could not refresh this Project. Showing the last loaded version.')
    ).toBeTruthy();

    // Opening Settings refetches the Project's settings, which fails too; the editor stays.
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(
      await screen.findByText('Could not refresh Settings. Showing the last saved values.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Paper/ })).toBeTruthy();
    expect(screen.queryByText('N² could not load Settings.')).toBeNull();
  });
});
