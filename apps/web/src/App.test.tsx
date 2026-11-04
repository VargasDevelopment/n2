import {
  resolveEffectiveProjectSettings,
  type ProjectActivity,
  type NodeStatus,
  type ProjectExecution,
  type ProjectedNode,
  type ProjectedProject
} from '@n2/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api.js';
import { canvasTransformations } from './canvasView.js';
import type { GraphCanvas } from './components/GraphCanvas.js';
import type { Inspector } from './components/Inspector.js';
import { projectQueryKey } from './useProjectCommands.js';
import { nodeSelection } from './graphInteraction.js';
import { createRoadmapRange } from './roadmapRange.js';
import { projectSettingsQueryKey } from './settingsQueries.js';

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  createProject: vi.fn(),
  getActivity: vi.fn(),
  getExecution: vi.fn(),
  getProject: vi.fn(),
  getProjectSettings: vi.fn(),
  listProjects: vi.fn(),
  markActivitySeen: vi.fn()
}));

vi.mock('./components/GraphCanvas.js', () => ({
  GraphCanvas: ({
    canvasSession,
    filterControls,
    focusRequest,
    keyboardShortcutsEnabled,
    settings,
    onSelectionChange,
    onShowFreeform,
    onToggleTransformation
  }: ComponentProps<typeof GraphCanvas>) => (
    <section aria-label="Mock graph canvas">
      <output data-testid="canvas-view-kind">{canvasSession.view.layout}</output>
      <output data-testid="visible-node-ids">
        {canvasSession.view.graph.nodes.map(({ id }) => id).join(',')}
      </output>
      <output data-testid="visible-relationship-ids">
        {canvasSession.view.graph.relationships.map(({ id }) => id).join(',')}
      </output>
      <output data-testid="hidden-statuses">
        {[...filterControls.hiddenStatuses].sort().join(',')}
      </output>
      <output data-testid="text-query">{filterControls.textQuery}</output>
      <output data-testid="focus-request">{focusRequest?.nodeId ?? ''}</output>
      <output data-testid="keyboard-shortcuts-enabled">{String(keyboardShortcutsEnabled)}</output>
      <output data-testid="handle-orientation">{settings.handleOrientation}</output>
      <output data-testid="minimap-visible">{String(settings.minimapVisible)}</output>
      <button type="button" onClick={() => onSelectionChange(nodeSelection('done'))}>
        Select done node
      </button>
      <button type="button" onClick={() => onSelectionChange(nodeSelection('ready'))}>
        Select ready node
      </button>
      <button type="button" onClick={() => filterControls.onToggleStatus('done')}>
        Toggle done filter
      </button>
      <button type="button" onClick={() => filterControls.onToggleStatus('in_progress')}>
        Toggle in progress filter
      </button>
      <button type="button" onClick={() => filterControls.onTextQueryChange('ready')}>
        Search ready title
      </button>
      <button type="button" onClick={() => filterControls.onTextQueryChange('')}>
        Clear text search
      </button>
      <button type="button" onClick={() => onToggleTransformation('kanban')}>
        Toggle Kanban
      </button>
      <button type="button" onClick={() => onToggleTransformation('roadmap')}>
        Toggle Roadmap
      </button>
      <button type="button" onClick={onShowFreeform}>
        Show Freeform
      </button>
      <output data-testid="transformations">
        {canvasTransformations(canvasSession.view).join(',')}
      </output>
      {canvasSession.kind === 'roadmap' ? (
        <>
          <output data-testid="roadmap-range">
            {canvasSession.view.board.axis
              ? `${canvasSession.view.board.axis.startDate}:${canvasSession.view.board.axis.endDate}`
              : 'none'}
          </output>
          <output data-testid="roadmap-range-kind">
            {canvasSession.isAutomaticRange ? 'auto' : 'custom'}
          </output>
          <button
            type="button"
            onClick={() =>
              canvasSession.onSetRoadmapRange(createRoadmapRange('2026-08-22', '2026-08-30'))
            }
          >
            Set August Roadmap range
          </button>
          <button type="button" onClick={canvasSession.onResetRoadmapRange}>
            Reset Roadmap range
          </button>
        </>
      ) : null}
    </section>
  )
}));

vi.mock('./components/Inspector.js', () => ({
  Inspector: ({ node, relationships }: ComponentProps<typeof Inspector>) => (
    <aside>
      <output data-testid="mock-inspector">{node.id}</output>
      {relationships?.items.dependencies.map(({ node: dependency, isVisible }) => (
        <button
          key={dependency.id}
          type="button"
          disabled={!isVisible}
          onClick={() => relationships.onNavigate(dependency.id)}
        >
          Depends on {dependency.id}
        </button>
      ))}
      {relationships?.items.dependents.map(({ node: dependent }) => (
        <button
          key={dependent.id}
          type="button"
          onClick={() => relationships.onNavigate(dependent.id)}
        >
          Dependent {dependent.id}
        </button>
      ))}
    </aside>
  )
}));

vi.mock('./components/SettingsModal.js', () => ({
  SettingsModal: ({
    initialScope,
    onClose,
    project
  }: {
    initialScope: 'application' | 'project';
    onClose: () => void;
    project?: { id: string; name: string };
  }) => (
    <aside aria-label="Mock Settings">
      <output data-testid="settings-scope">{initialScope}</output>
      <output data-testid="settings-project">{project?.id ?? ''}</output>
      <button type="button" onClick={onClose}>
        Close mock Settings
      </button>
    </aside>
  )
}));

import { App } from './App.js';

const now = '2026-08-21T12:00:00.000Z';

const workNode = (id: string, effectiveStatus: NodeStatus): ProjectedNode => ({
  id,
  reference: 'N2-1',
  title: id,
  description: '',
  kind: 'task',
  requestedStatus: effectiveStatus,
  effectiveStatus,
  progress: effectiveStatus === 'done' ? 1 : 0,
  blockedBy: [],
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: now,
  updatedAt: now
});

const project: ProjectedProject = {
  id: 'default',
  name: 'N²',
  referenceKey: 'N2',
  nodes: [
    workNode('ready', 'ready'),
    workNode('done', 'done'),
    {
      id: 'note',
      reference: 'N2-3',
      title: 'Note',
      content: '',
      kind: 'note',
      position: { x: 0, y: 0 },
      version: 0,
      createdAt: now,
      updatedAt: now
    }
  ],
  relationships: [
    {
      id: 'ready-needs-done',
      kind: 'depends_on',
      dependentId: 'ready',
      dependencyId: 'done',
      createdAt: now,
      isBlocking: false
    }
  ],
  warnings: [],
  // Reflects the agent run in `activity`, so Activity finds the graph current.
  latestSequence: 1
};

const projectSettings = resolveEffectiveProjectSettings({
  projectId: project.id,
  applicationValues: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
  overrides: {}
});

const projectExecution: ProjectExecution = {
  projectId: project.id,
  tasks: [],
  attempts: []
};

// One agent run that created the done node, still unseen.
const activity: ProjectActivity = {
  projectId: project.id,
  latestSequence: 1,
  seen: null,
  unseenItemCount: 1,
  runs: [
    {
      actor: { kind: 'agent', name: 'builder' },
      startedAt: now,
      endedAt: now,
      firstSequence: 1,
      lastSequence: 1,
      unseen: true,
      entries: [
        {
          subject: { id: 'done', reference: 'N2-1', title: 'done', kind: 'task', present: true },
          lastSequence: 1,
          at: now,
          commandCount: 1,
          changes: [{ kind: 'created' }]
        }
      ]
    }
  ],
  hasEarlier: false
};

beforeEach(() => {
  vi.mocked(api.getActivity).mockResolvedValue(activity);
  vi.mocked(api.listProjects).mockResolvedValue({ projects: [] });
  vi.mocked(api.getProjectSettings).mockResolvedValue(projectSettings);
  vi.mocked(api.getExecution).mockResolvedValue(projectExecution);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

const renderAt = (pathname: string) => {
  window.history.replaceState(null, '', pathname);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 10_000 } }
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
  return { ...rendered, queryClient };
};

const renderApp = () => renderAt('/projects/default');

describe('App Project navigation', () => {
  it('feeds the live effective Project Settings snapshot into the canvas', async () => {
    vi.mocked(api.getProject).mockResolvedValue(project);
    const { queryClient } = renderApp();

    expect((await screen.findByTestId('handle-orientation')).textContent).toBe('horizontal');
    expect(screen.getByTestId('minimap-visible').textContent).toBe('true');

    act(() => {
      queryClient.setQueryData(
        projectSettingsQueryKey(project.id),
        resolveEffectiveProjectSettings({
          projectId: project.id,
          applicationValues: projectSettings.applicationValues,
          overrides: { handleOrientation: 'vertical', minimapVisible: false }
        })
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId('handle-orientation').textContent).toBe('vertical')
    );
    expect(screen.getByTestId('minimap-visible').textContent).toBe('false');
  });

  it('opens Settings in the contextual scope and closes over the unchanged location', async () => {
    vi.mocked(api.listProjects).mockResolvedValue({
      projects: [
        {
          id: 'default',
          name: project.name,
          referenceKey: project.referenceKey,
          canvasItemCount: project.nodes.length,
          archivedAt: null,
          lifecycleRevision: 0
        }
      ]
    });
    vi.mocked(api.getProject).mockResolvedValue(project);
    const user = userEvent.setup();
    renderAt('/');

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(screen.getByTestId('settings-scope').textContent).toBe('application');
    expect(screen.getByRole('main').hasAttribute('inert')).toBe(true);
    expect(window.location.pathname).toBe('/');
    await user.click(screen.getByRole('button', { name: 'Close mock Settings' }));
    expect(screen.queryByLabelText('Mock Settings')).toBeNull();
    expect(screen.getByRole('main').hasAttribute('inert')).toBe(false);

    await user.click(screen.getByRole('button', { name: /N².*canvas items/ }));
    await screen.findByTestId('visible-node-ids');
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByTestId('settings-scope').textContent).toBe('project');
    expect(screen.getByTestId('settings-project').textContent).toBe('default');
    expect(screen.getByTestId('keyboard-shortcuts-enabled').textContent).toBe('false');
    expect(screen.getByRole('main').hasAttribute('inert')).toBe(true);
    expect(window.location.pathname).toBe('/projects/default');
    await user.click(screen.getByRole('button', { name: 'Close mock Settings' }));
    expect(screen.getByTestId('keyboard-shortcuts-enabled').textContent).toBe('true');
    expect(screen.getByRole('main').hasAttribute('inert')).toBe(false);
  });

  it('dismisses Project Settings when browser navigation changes its location context', async () => {
    vi.mocked(api.getProject).mockResolvedValue(project);
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [] });
    const user = userEvent.setup();
    renderApp();

    await screen.findByTestId('visible-node-ids');
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByTestId('settings-project').textContent).toBe('default');

    act(() => {
      window.history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => expect(screen.queryByLabelText('Mock Settings')).toBeNull());
    expect(await screen.findByRole('heading', { name: 'Choose where to think.' })).toBeTruthy();

    act(() => {
      window.history.pushState(null, '', '/projects/default');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await screen.findByTestId('visible-node-ids');
    expect(screen.queryByLabelText('Mock Settings')).toBeNull();
  });

  it('retries a failed Project query without leaving the application', async () => {
    vi.mocked(api.getProject)
      .mockRejectedValueOnce(new Error('Service is starting.'))
      .mockResolvedValueOnce(project);
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByTestId('visible-node-ids')).toBeTruthy();
    expect(api.getProject).toHaveBeenCalledTimes(2);
  });

  it('opens a Project from the library and resets canvas state when leaving it', async () => {
    vi.mocked(api.listProjects).mockResolvedValue({
      projects: [
        {
          id: 'default',
          name: project.name,
          referenceKey: project.referenceKey,
          canvasItemCount: project.nodes.length,
          archivedAt: null,
          lifecycleRevision: 0
        }
      ]
    });
    vi.mocked(api.getProject).mockResolvedValue(project);
    const user = userEvent.setup();
    renderAt('/');

    await user.click(await screen.findByRole('button', { name: /N².*canvas items/ }));
    expect(await screen.findByTestId('hidden-statuses')).toHaveProperty('textContent', '');
    expect(window.location.pathname).toBe('/projects/default');

    await user.click(screen.getByRole('button', { name: 'Toggle done filter' }));
    expect(screen.getByTestId('hidden-statuses')).toHaveProperty('textContent', 'done');
    await user.click(screen.getByRole('button', { name: 'Open Project Library' }));
    await user.click(await screen.findByRole('button', { name: /N².*canvas items/ }));

    expect(await screen.findByTestId('hidden-statuses')).toHaveProperty('textContent', '');
    expect(api.getProject).toHaveBeenCalledTimes(2);
  });
});

describe('App Inspector relationships', () => {
  it('follows a dependency and back by selecting and focusing the related node', async () => {
    vi.mocked(api.getProject).mockResolvedValue(project);
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Select ready node' }));
    expect(screen.getByTestId('focus-request').textContent).toBe('');

    await user.click(screen.getByRole('button', { name: 'Depends on done' }));
    expect(screen.getByTestId('mock-inspector').textContent).toBe('done');
    expect(screen.getByTestId('focus-request').textContent).toBe('done');

    await user.click(screen.getByRole('button', { name: 'Dependent ready' }));
    expect(screen.getByTestId('mock-inspector').textContent).toBe('ready');
    expect(screen.getByTestId('focus-request').textContent).toBe('ready');
  });

  it('keeps a dependency hidden by a filter in the Inspector without making it selectable', async () => {
    vi.mocked(api.getProject).mockResolvedValue(project);
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Toggle done filter' }));
    await user.click(screen.getByRole('button', { name: 'Select ready node' }));

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Depends on done' }).disabled
    ).toBe(true);
  });
});

describe('App canvas filtering', () => {
  it('filters projected topology without hiding Notes and dismisses a hidden selection', async () => {
    vi.mocked(api.getProject).mockResolvedValue(project);
    const user = userEvent.setup();
    renderApp();

    expect((await screen.findByTestId('visible-node-ids')).textContent).toBe('ready,done,note');
    expect(screen.getByTestId('visible-relationship-ids').textContent).toBe('ready-needs-done');

    await user.click(screen.getByRole('button', { name: 'Select done node' }));
    expect(screen.getByTestId('mock-inspector').textContent).toBe('done');

    await user.click(screen.getByRole('button', { name: 'Toggle done filter' }));

    expect(screen.getByTestId('visible-node-ids').textContent).toBe('ready,note');
    expect(screen.getByTestId('visible-relationship-ids').textContent).toBe('');
    expect(screen.getByTestId('hidden-statuses').textContent).toBe('done');
    await waitFor(() => expect(screen.queryByTestId('mock-inspector')).toBeNull());
  });

  it('does not resurrect a selection invalidated by an authoritative status change', async () => {
    vi.mocked(api.getProject).mockResolvedValue(project);
    const user = userEvent.setup();
    const { queryClient } = renderApp();

    await screen.findByTestId('visible-node-ids');
    await user.click(screen.getByRole('button', { name: 'Toggle in progress filter' }));
    await user.click(screen.getByRole('button', { name: 'Select ready node' }));
    expect(screen.getByTestId('mock-inspector').textContent).toBe('ready');

    const updatedProject: ProjectedProject = {
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === 'ready' ? workNode('ready', 'in_progress') : node
      )
    };
    act(() => {
      queryClient.setQueryData(projectQueryKey('default'), updatedProject);
    });

    await waitFor(() => expect(screen.queryByTestId('mock-inspector')).toBeNull());
    expect(screen.getByTestId('visible-node-ids').textContent).toBe('done,note');

    act(() => {
      queryClient.setQueryData(projectQueryKey('default'), project);
    });

    await waitFor(() =>
      expect(screen.getByTestId('visible-node-ids').textContent).toBe('ready,done,note')
    );
    expect(screen.queryByTestId('mock-inspector')).toBeNull();
  });

  it('composes status filtering with Kanban instead of replacing the filtered graph', async () => {
    vi.mocked(api.getProject).mockResolvedValue(project);
    const user = userEvent.setup();
    renderApp();

    await screen.findByTestId('visible-node-ids');
    await user.click(screen.getByRole('button', { name: 'Toggle Kanban' }));
    expect(screen.getByTestId('canvas-view-kind').textContent).toBe('kanban');
    expect(screen.getByTestId('transformations').textContent).toBe('kanban');

    await user.click(screen.getByRole('button', { name: 'Toggle done filter' }));
    expect(screen.getByTestId('canvas-view-kind').textContent).toBe('kanban');
    expect(screen.getByTestId('visible-node-ids').textContent).toBe('ready,note');

    await user.click(screen.getByRole('button', { name: 'Search ready title' }));
    expect(screen.getByTestId('text-query').textContent).toBe('ready');
    expect(screen.getByTestId('visible-node-ids').textContent).toBe('ready');

    await user.click(screen.getByRole('button', { name: 'Show Freeform' }));
    expect(screen.getByTestId('canvas-view-kind').textContent).toBe('freeform');
    expect(screen.getByTestId('visible-node-ids').textContent).toBe('ready');
  });

  it('composes filters with Roadmap and explicitly replaces Kanban', async () => {
    vi.mocked(api.getProject).mockResolvedValue(project);
    const user = userEvent.setup();
    renderApp();

    await screen.findByTestId('visible-node-ids');
    await user.click(screen.getByRole('button', { name: 'Toggle Kanban' }));
    await user.click(screen.getByRole('button', { name: 'Toggle Roadmap' }));
    expect(screen.getByTestId('transformations').textContent).toBe('roadmap');

    await user.click(screen.getByRole('button', { name: 'Toggle done filter' }));
    expect(screen.getByTestId('canvas-view-kind').textContent).toBe('roadmap');
    expect(screen.getByTestId('visible-node-ids').textContent).toBe('ready,note');

    await user.click(screen.getByRole('button', { name: 'Toggle Kanban' }));
    expect(screen.getByTestId('transformations').textContent).toBe('kanban');
    expect(screen.getByTestId('visible-node-ids').textContent).toBe('ready,note');
  });

  it('dismisses a selection hidden by text search and does not restore it when cleared', async () => {
    vi.mocked(api.getProject).mockResolvedValue(project);
    const user = userEvent.setup();
    renderApp();

    await screen.findByTestId('visible-node-ids');
    await user.click(screen.getByRole('button', { name: 'Select done node' }));
    expect(screen.getByTestId('mock-inspector').textContent).toBe('done');

    await user.click(screen.getByRole('button', { name: 'Search ready title' }));
    expect(screen.getByTestId('visible-node-ids').textContent).toBe('ready');
    await waitFor(() => expect(screen.queryByTestId('mock-inspector')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Clear text search' }));
    expect(screen.getByTestId('visible-node-ids').textContent).toBe('ready,done,note');
    expect(screen.queryByTestId('mock-inspector')).toBeNull();
  });

  it('keeps an explicit Roadmap range as view state and composes it with visible topology', async () => {
    const scheduledProject: ProjectedProject = {
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === 'ready'
          ? {
              ...node,
              planningPlacement: { kind: 'milestone' as const, date: '2026-08-25' }
            }
          : node.id === 'done'
            ? {
                ...node,
                planningPlacement: { kind: 'milestone' as const, date: '2026-09-10' }
              }
            : node
      )
    };
    vi.mocked(api.getProject).mockResolvedValue(scheduledProject);
    const user = userEvent.setup();
    renderApp();

    await screen.findByTestId('visible-node-ids');
    await user.click(screen.getByRole('button', { name: 'Toggle Roadmap' }));
    expect(screen.getByTestId('roadmap-range-kind').textContent).toBe('auto');

    await user.click(screen.getByRole('button', { name: 'Select done node' }));
    expect(screen.getByTestId('mock-inspector').textContent).toBe('done');
    await user.click(screen.getByRole('button', { name: 'Set August Roadmap range' }));

    expect(screen.getByTestId('roadmap-range-kind').textContent).toBe('custom');
    expect(screen.getByTestId('roadmap-range').textContent).toBe('2026-08-22:2026-08-30');
    expect(screen.getByTestId('visible-node-ids').textContent).toBe('ready,note');
    expect(screen.getByTestId('visible-relationship-ids').textContent).toBe('');
    await waitFor(() => expect(screen.queryByTestId('mock-inspector')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Show Freeform' }));
    expect(screen.getByTestId('visible-node-ids').textContent).toBe('ready,done,note');
    await user.click(screen.getByRole('button', { name: 'Toggle Roadmap' }));
    expect(screen.getByTestId('roadmap-range-kind').textContent).toBe('custom');
    expect(screen.getByTestId('visible-node-ids').textContent).toBe('ready,note');

    await user.click(screen.getByRole('button', { name: 'Reset Roadmap range' }));
    expect(screen.getByTestId('roadmap-range-kind').textContent).toBe('auto');
    expect(screen.getByTestId('visible-node-ids').textContent).toBe('ready,done,note');
  });
});

describe('App Activity links', () => {
  it('clears the filters hiding a linked item, shows it, and says so', async () => {
    vi.mocked(api.getProject).mockResolvedValue(project);
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Search ready title' }));
    expect(screen.getByTestId('visible-node-ids').textContent).toBe('ready');

    await user.click(screen.getByRole('button', { name: /^Activity/ }));
    await user.click(await screen.findByTitle('Show N2-1 on the canvas'));

    expect(screen.getByTestId('text-query').textContent).toBe('');
    expect(screen.getByTestId('visible-node-ids').textContent).toBe('ready,done,note');
    expect(screen.getByTestId('mock-inspector').textContent).toBe('done');
    expect(screen.getByTestId('focus-request').textContent).toBe('done');
    expect(screen.getByText('Cleared the filters to show N2-1.')).toBeTruthy();
  });

  // The graph loaded before an agent's change to `done`, which Activity already lists. Until the
  // refresh lands, the cached graph cannot show what the link reports.
  it.each([
    [
      'created',
      'Search ready title',
      'text-query',
      project.nodes.filter(({ id }) => id !== 'done')
    ],
    [
      'renamed out of the search',
      'Search ready title',
      'text-query',
      project.nodes.map((node) => (node.id === 'done' ? { ...node, title: 'ready too' } : node))
    ],
    [
      'moved into a hidden status',
      'Toggle done filter',
      'hidden-statuses',
      project.nodes.map((node) => (node.id === 'done' ? workNode('done', 'in_progress') : node))
    ]
  ])(
    'holds a link to an item %s until the graph reflects it, then reveals it',
    async (_change, filterControl, filterState, cachedNodes) => {
      let landRefresh: (value: ProjectedProject) => void = () => undefined;
      vi.mocked(api.getProject)
        .mockResolvedValueOnce({ ...project, latestSequence: 0, nodes: cachedNodes })
        .mockImplementation(() => new Promise((resolve) => (landRefresh = resolve)));
      const user = userEvent.setup();
      renderApp();

      await user.click(await screen.findByRole('button', { name: filterControl }));
      const filtered = screen.getByTestId(filterState).textContent;
      await user.click(screen.getByRole('button', { name: /^Activity/ }));
      const link = await screen.findByTitle('Show N2-1 on the canvas');
      await user.click(link);

      // Nothing changes yet but the link, which shows it heard the click.
      expect(screen.getByTestId(filterState).textContent).toBe(filtered);
      expect(screen.queryByTestId('mock-inspector')).toBeNull();
      expect(screen.getByTestId('focus-request').textContent).toBe('');
      expect(link.getAttribute('aria-busy')).toBe('true');

      act(() => landRefresh(project));

      await waitFor(() => expect(screen.getByTestId('focus-request').textContent).toBe('done'));
      expect(screen.getByTestId(filterState).textContent).toBe('');
      expect(screen.getByTestId('mock-inspector').textContent).toBe('done');
      expect(screen.getByText('Cleared the filters to show N2-1.')).toBeTruthy();
      expect(screen.getByTitle('Show N2-1 on the canvas').getAttribute('aria-busy')).toBeNull();
    }
  );

  it('leaves the filters alone when the linked item already shows', async () => {
    vi.mocked(api.getProject).mockResolvedValue(project);
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Toggle in progress filter' }));
    await user.click(screen.getByRole('button', { name: /^Activity/ }));
    await user.click(await screen.findByTitle('Show N2-1 on the canvas'));

    expect(screen.getByTestId('hidden-statuses').textContent).toBe('in_progress');
    expect(screen.getByTestId('mock-inspector').textContent).toBe('done');
    expect(screen.queryByText(/Cleared the filters/)).toBeNull();
  });
});
