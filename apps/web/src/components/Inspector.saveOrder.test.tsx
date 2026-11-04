import type {
  NodePatch,
  ProjectCommandInput,
  ProjectCommandResponse,
  ProjectedNode,
  ProjectedProject,
  ProjectedWorkNode
} from '@n2/contracts';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectQueryKey, useProjectCommands } from '../useProjectCommands.js';
import { InlineTitleEditor } from './InlineTitleEditor.js';
import { Inspector } from './Inspector.js';

const api = vi.hoisted(() => ({ executeProjectCommand: vi.fn(), getProject: vi.fn() }));
vi.mock('../api.js', () => api);

const workNode = (id: string, reference: string): ProjectedWorkNode => ({
  id,
  reference,
  title: `Work ${reference}`,
  description: 'original',
  kind: 'task',
  requestedStatus: 'ready',
  effectiveStatus: 'ready',
  progress: 0,
  blockedBy: [],
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: '2026-08-21T12:00:00.000Z',
  updatedAt: '2026-08-21T12:00:00.000Z'
});

const withPatch = (node: ProjectedWorkNode, patch: NodePatch): ProjectedWorkNode => {
  const next: ProjectedWorkNode = { ...node, version: node.version + 1 };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.planningPlacement === null) delete next.planningPlacement;
  else if (patch.planningPlacement) next.planningPlacement = patch.planningPlacement;
  return next;
};

/** A server that holds each command until the test finishes it, so saves stay pending. */
const createServer = (nodes: ProjectedWorkNode[]) => {
  let project: ProjectedProject = {
    id: 'project',
    name: 'Project',
    referenceKey: 'N2',
    nodes,
    relationships: [],
    warnings: [],
    latestSequence: 0
  };
  const held: (() => void)[] = [];
  const patches: NodePatch[] = [];
  api.executeProjectCommand.mockImplementation(
    (_projectId: string, command: ProjectCommandInput) =>
      new Promise<ProjectCommandResponse>((resolve) => {
        if (command.kind !== 'update_node') throw new Error(`Unexpected ${command.kind}`);
        patches.push(command.patch);
        held.push(() => {
          project = {
            ...project,
            nodes: project.nodes.map((node) =>
              node.id === command.nodeId && node.kind !== 'note'
                ? withPatch(node, command.patch)
                : node
            )
          };
          resolve({
            commandId: command.commandId,
            disposition: 'applied',
            project,
            outcome: { kind: 'node_updated', nodeId: command.nodeId },
            effects: { completedGroupIds: [] }
          });
        });
      })
  );
  return {
    initial: project,
    patches,
    /** Finishes `count` commands, one at a time, as the queue sends each after the last. */
    finish: async (count: number) => {
      for (let finished = 0; finished < count; finished += 1) {
        await waitFor(() => expect(held.length).toBeGreaterThan(finished));
        act(() => held[finished]?.());
      }
      await waitFor(() => expect(held).toHaveLength(count));
    }
  };
};

/** The workspace: the useProjectCommands owner, node A's canvas title, and the selected Inspector. */
function Workspace({ selectedId }: { selectedId: string | null }) {
  const { dispatch } = useProjectCommands('project', () => undefined);
  const { data } = useQuery<ProjectedProject>({
    queryKey: projectQueryKey('project'),
    queryFn: () => Promise.reject(new Error('The test seeds the project.')),
    staleTime: Infinity
  });
  const onUpdate = async (target: ProjectedNode, patch: NodePatch) => {
    const result = await dispatch({ kind: 'update_node', nodeId: target.id, patch });
    return result.project?.nodes.find(({ id }) => id === target.id) ?? null;
  };
  const card = data?.nodes.find(({ id }) => id === 'a');
  const node = data?.nodes.find(({ id }) => id === selectedId);
  return (
    <>
      {card ? (
        <InlineTitleEditor
          title={card.title}
          onCommit={async (title) => (await onUpdate(card, { title }))?.title ?? null}
        />
      ) : null}
      {node ? (
        <Inspector
          key={node.id}
          node={node}
          placement="right"
          onClose={() => undefined}
          onDelete={() => undefined}
          onUpdate={onUpdate}
        />
      ) : null}
    </>
  );
}

const renderSelection = (project: ProjectedProject, selectedId: string) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  queryClient.setQueryData(projectQueryKey('project'), project);
  const wrap = (id: string | null, open = true) => (
    <QueryClientProvider client={queryClient}>
      {open ? <Workspace selectedId={id} /> : null}
    </QueryClientProvider>
  );
  const view = render(wrap(selectedId));
  return {
    ...view,
    select: (id: string | null) => view.rerender(wrap(id)),
    /** Unmounts the whole workspace, as moving to another Project does, keeping the QueryClient. */
    leaveWorkspace: () => view.rerender(wrap(null, false))
  };
};

const setDate = async (user: ReturnType<typeof userEvent.setup>, date: string) => {
  const field = screen.getByLabelText<HTMLInputElement>('Milestone date');
  await user.clear(field);
  await user.type(field, date);
};

const milestone = (date: string) => ({ planningPlacement: { kind: 'milestone', date } });

beforeEach(() => {
  api.executeProjectCommand.mockReset();
});
afterEach(cleanup);

// The latest committed save intent for a node's field wins, across pending requests and remounts.
describe('Inspector save order', () => {
  it('sends a Planning revert made while the first change is saving', async () => {
    const user = userEvent.setup();
    const server = createServer([workNode('a', 'N2-1')]);
    renderSelection(server.initial, 'a');

    await user.click(screen.getByRole('button', { name: 'Change planning' }));
    await user.click(screen.getByRole('button', { name: 'Milestone' }));
    await user.click(screen.getByRole('button', { name: 'Unscheduled' }));
    await server.finish(2);

    // A Milestone starts on today's date, so only its kind is fixed here.
    expect(server.patches.map(({ planningPlacement }) => planningPlacement?.kind ?? null)).toEqual([
      'milestone',
      null
    ]);
    await user.click(screen.getByRole('button', { name: 'Done changing planning' }));
    expect(screen.getByRole('region', { name: 'Planning' }).textContent).toContain('Unscheduled');
  });

  it('applies the newest Planning change when the item is reopened while saves are pending', async () => {
    const user = userEvent.setup();
    const server = createServer([
      { ...workNode('a', 'N2-1'), planningPlacement: { kind: 'milestone', date: '2026-10-01' } },
      workNode('b', 'N2-2')
    ]);
    const view = renderSelection(server.initial, 'a');

    await user.click(screen.getByRole('button', { name: 'Change planning' }));
    await setDate(user, '2026-10-02');
    await setDate(user, '2026-10-03');
    view.select('b');
    view.select('a');
    await user.click(screen.getByRole('button', { name: 'Change planning' }));
    await setDate(user, '2026-10-04');
    await server.finish(3);

    expect(server.patches).toEqual([
      milestone('2026-10-02'),
      milestone('2026-10-03'),
      milestone('2026-10-04')
    ]);
    expect(screen.getByLabelText<HTMLInputElement>('Milestone date').value).toBe('2026-10-04');
  });

  it('sends a description revert when the panel is dismissed while the change is saving', async () => {
    const user = userEvent.setup();
    const server = createServer([workNode('a', 'N2-1')]);
    const view = renderSelection(server.initial, 'a');

    await user.click(screen.getByRole('button', { name: 'Edit description' }));
    const description = screen.getByLabelText('Description');
    await user.clear(description);
    await user.type(description, 'changed');
    await user.tab();
    await user.clear(description);
    await user.type(description, 'original');
    view.select(null);
    await server.finish(2);

    expect(server.patches).toEqual([{ description: 'changed' }, { description: 'original' }]);
  });
  it('never resends a submitted title when the panel closes after a newer canvas rename', async () => {
    const user = userEvent.setup();
    const server = createServer([workNode('a', 'N2-1')]);
    const view = renderSelection(server.initial, 'a');

    await user.click(screen.getByTitle('Click to edit'));
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'B{Enter}');
    await user.dblClick(screen.getByTitle('Double-click to edit'));
    await user.clear(screen.getByLabelText('Node title'));
    await user.type(screen.getByLabelText('Node title'), 'C{Enter}');
    view.select(null);
    await server.finish(2);
    await act(() => new Promise((settle) => setTimeout(settle, 20)));

    expect(server.patches).toEqual([{ title: 'B' }, { title: 'C' }]);
  });

  it('sends a revert made after leaving and reopening the workspace while a save is pending', async () => {
    const user = userEvent.setup();
    const server = createServer([workNode('a', 'N2-1')]);
    const view = renderSelection(server.initial, 'a');

    await user.click(screen.getByRole('button', { name: 'Edit description' }));
    await user.clear(screen.getByLabelText('Description'));
    await user.type(screen.getByLabelText('Description'), 'changed');
    await user.click(screen.getByRole('button', { name: 'Finish editing description' }));
    view.leaveWorkspace();
    view.select('a');
    await user.click(screen.getByRole('button', { name: 'Edit description' }));
    await user.clear(screen.getByLabelText('Description'));
    await user.type(screen.getByLabelText('Description'), 'original');
    await user.click(screen.getByRole('button', { name: 'Finish editing description' }));
    await server.finish(2);

    expect(server.patches).toEqual([{ description: 'changed' }, { description: 'original' }]);
    expect(await screen.findByText('original')).toBeTruthy();
  });
});
