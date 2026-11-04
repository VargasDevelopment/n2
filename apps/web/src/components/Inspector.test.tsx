import type {
  GroupEnablePreview,
  ProjectedNode,
  ProjectedWorkNode,
  TaskExecution
} from '@n2/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DirectlyRelatedWorkNode } from '../directRelationships.js';
import { Inspector } from './Inspector.js';

const node: ProjectedWorkNode = {
  id: 'node',
  reference: 'N2-1',
  title: 'Original',
  description: '',
  kind: 'task',
  requestedStatus: 'ready',
  effectiveStatus: 'ready',
  progress: 0,
  blockedBy: [],
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: '2026-08-21T12:00:00.000Z',
  updatedAt: '2026-08-21T12:00:00.000Z'
};

const note: ProjectedNode = {
  id: 'note',
  reference: 'N2-2',
  title: 'Context',
  content: '**Initial** thought',
  kind: 'note',
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: '2026-08-21T12:00:00.000Z',
  updatedAt: '2026-08-21T12:00:00.000Z'
};

const execution: TaskExecution = {
  taskId: 'node',
  reference: 'N2-1',
  title: 'Original',
  eligibility: 'instructions_changed',
  currentFingerprint: `sha256:${'1'.repeat(64)}`,
  enabledFingerprint: `sha256:${'2'.repeat(64)}`,
  enablementId: '00000000-0000-4000-8000-000000000001',
  enabledAt: '2026-08-21T12:00:00.000Z',
  disabledAt: null,
  dispatchable: false,
  claimBlockers: [{ code: 'instructions_changed', taskIds: [] }],
  activeAttempt: null,
  latestAttempt: null
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
};

const renderInspector = (props: Partial<ComponentProps<typeof Inspector>> = {}) =>
  render(
    <Inspector
      node={node}
      placement="right"
      onClose={vi.fn()}
      onDelete={vi.fn()}
      onUpdate={vi.fn()}
      {...props}
    />
  );

const related = (
  id: string,
  reference: string,
  title: string,
  effectiveStatus: ProjectedWorkNode['effectiveStatus'] = 'blocked'
): DirectlyRelatedWorkNode => ({
  relationshipId: `relationship-${id}`,
  isVisible: true,
  node: { ...node, id, reference, title, effectiveStatus }
});

const editTitle = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByTitle('Click to edit'));
  return screen.getByLabelText<HTMLTextAreaElement>('Title');
};

afterEach(() => {
  cleanup();
});

describe('Inspector', () => {
  it('captures a blurred field edit and the action that caused the blur', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue({ ...node, title: 'Renamed', version: 1 });
    renderInspector({ onUpdate });

    expect(screen.getByText('N2-1')).toBeTruthy();
    const title = await editTitle(user);
    await user.clear(title);
    await user.type(title, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(onUpdate).toHaveBeenNthCalledWith(1, node, { title: 'Renamed' });
    expect(onUpdate).toHaveBeenNthCalledWith(2, node, { requestedStatus: 'done' });
  });

  it('restores authoritative field values after rejected updates', async () => {
    const user = userEvent.setup();
    renderInspector({ onUpdate: vi.fn().mockResolvedValue(null) });

    const title = await editTitle(user);
    await user.clear(title);
    await user.type(title, 'Rejected title');
    await user.tab();
    expect(await screen.findByRole('heading', { name: 'Original' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Edit description' }));
    const description = screen.getByLabelText<HTMLTextAreaElement>('Description');
    await user.type(description, 'Rejected description');
    await user.tab();
    await waitFor(() => expect(description.value).toBe(''));
  });

  it.each([
    { field: 'title' as const, label: 'Title', open: 'Click to edit', reopens: true },
    {
      field: 'description' as const,
      label: 'Description',
      open: 'Edit description',
      reopens: false
    }
  ])('preserves a newer $field draft when an in-flight save completes', async (scenario) => {
    const user = userEvent.setup();
    const update = deferred<ProjectedNode | null>();
    const onUpdate = vi.fn().mockReturnValue(update.promise);
    const open = () =>
      user.click(
        screen.queryByTitle(scenario.open) ?? screen.getByRole('button', { name: scenario.open })
      );
    const view = renderInspector({ onUpdate });

    await open();
    const field = () => screen.getByLabelText<HTMLTextAreaElement>(scenario.label);
    await user.clear(field());
    await user.type(field(), 'Saved draft');
    fireEvent.blur(field());
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());

    if (scenario.reopens) await open();
    await user.clear(field());
    await user.type(field(), 'Newer draft');

    const acceptedNode = { ...node, [scenario.field]: 'Saved draft', version: 1 };
    await act(async () => {
      update.resolve(acceptedNode);
      await update.promise;
    });
    view.rerender(
      <Inspector
        node={acceptedNode}
        placement="right"
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onUpdate={onUpdate}
      />
    );

    expect(field().value).toBe('Newer draft');
  });

  it('reads the complete title and edits all of it', async () => {
    const user = userEvent.setup();
    const longTitle = "Long task titles aren't fully viewable in details view";
    renderInspector({ node: { ...node, title: longTitle } });

    expect(screen.getByRole('heading', { name: longTitle })).toBeTruthy();
    const title = await editTitle(user);
    expect(title.value).toBe(longTitle);
  });

  it('commits a title with Enter without interrupting IME composition', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue({ ...node, title: 'Composed title', version: 1 });
    renderInspector({ onUpdate });
    const title = await editTitle(user);
    fireEvent.change(title, { target: { value: 'Composed\r\ntitle ' } });
    expect(title.value).toBe('Composed title ');

    fireEvent.keyDown(title, { key: 'Enter', isComposing: true });
    expect(document.activeElement).toBe(title);
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.keyDown(title, { key: 'Enter' });
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(node, { title: 'Composed title' }));
  });

  it('cancels a title edit with Escape, as on a card', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    renderInspector({ onUpdate });

    const title = await editTitle(user);
    await user.type(title, ' changed');
    await user.keyboard('{Escape}');

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Original' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTitle('Click to edit'));
  });

  it('keeps a description edit when Escape finishes editing, and shows it as Markdown', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue({ ...node, description: '**Kept**', version: 1 });
    renderInspector({ onUpdate });

    await user.click(screen.getByRole('button', { name: 'Edit description' }));
    await user.type(screen.getByLabelText('Description'), '**Kept**');
    await user.keyboard('{Escape}');

    expect(onUpdate).toHaveBeenCalledWith(node, { description: '**Kept**' });
    expect(screen.queryByLabelText('Description')).toBeNull();
    expect((await screen.findByText('Kept')).tagName).toBe('STRONG');
    // Focus leaves the field, so a second Escape reaches the canvas and closes the panel.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit description' }));
  });

  it('keeps long-text editing open when Escape ends an IME composition', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    renderInspector({ onUpdate });

    await user.click(screen.getByRole('button', { name: 'Edit description' }));
    fireEvent.keyDown(screen.getByLabelText('Description'), { key: 'Escape', isComposing: true });

    expect(screen.getByLabelText('Description')).toBe(document.activeElement);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('sends only real edits: none for a visit, one for an edit typed back to the original', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(node);
    renderInspector({ onUpdate });

    await editTitle(user);
    await user.tab();
    expect(onUpdate).not.toHaveBeenCalled();

    const title = await editTitle(user);
    await user.type(title, 'x{Backspace}');
    await user.tab();
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(node, { title: 'Original' });
  });

  it('saves an unsaved description when the panel is dismissed', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(null);
    const view = renderInspector({ onUpdate });

    await user.click(screen.getByRole('button', { name: 'Edit description' }));
    await user.type(screen.getByLabelText('Description'), 'Typed, never blurred');
    view.unmount();

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(node, {
      description: 'Typed, never blurred'
    });
  });

  it('names the blocker on the face and leads the relationships with it', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const storage = related('storage', 'N2-8', 'Provision storage');
    const ingress = related('ingress', 'N2-7', 'Install ingress', 'in_progress');
    const blocked = { ...node, effectiveStatus: 'blocked' as const, blockedBy: ['storage', 'x'] };
    renderInspector({
      node: blocked,
      relationships: {
        items: { dependencies: [ingress, storage], dependents: [], groups: [], members: [] },
        onNavigate,
        onRemove: vi.fn()
      }
    });

    const state = screen.getByText(/^by/u);
    expect(state.textContent).toBe('by N2-8 Provision storage and 1 more');
    await user.click(screen.getByRole('button', { name: 'N2-8 Provision storage' }));
    expect(onNavigate).toHaveBeenCalledWith('storage');

    const rows = screen.getAllByRole('button', { name: /^N2-\d .*, (Blocked|In progress)/u });
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'N2-8 Provision storage, Blocked, blocking',
      'N2-7 Install ingress, In progress'
    ]);
  });

  it('names no blocker when the requested status is Blocked', () => {
    const storage = related('storage', 'N2-8', 'Provision storage');
    renderInspector({
      node: {
        ...node,
        requestedStatus: 'blocked',
        effectiveStatus: 'blocked',
        blockedBy: ['storage']
      },
      relationships: {
        items: { dependencies: [storage], dependents: [], groups: [], members: [] },
        onNavigate: vi.fn(),
        onRemove: vi.fn()
      }
    });

    expect(screen.queryByText(/^by/u)).toBeNull();
    expect(screen.queryByText('Blocking')).toBeNull();
  });

  it('says when a Group is blocked by a member, and shows its member progress', () => {
    const member = related('storage', 'N2-8', 'Provision storage');
    const done = related('docs', 'N2-9', 'Write docs', 'done');
    renderInspector({
      node: {
        ...node,
        kind: 'group',
        effectiveStatus: 'blocked',
        // A member it also depends on is listed twice, but is one blocker.
        blockedBy: ['storage', 'storage'],
        progress: 0.5
      },
      relationships: {
        items: { dependencies: [], dependents: [], groups: [], members: [member, done] },
        onNavigate: vi.fn(),
        onRemove: vi.fn()
      }
    });

    expect(screen.getByText(/^by/u).textContent).toBe('by member N2-8 Provision storage');
    expect(
      screen.getByRole('progressbar', { name: 'Group progress' }).getAttribute('aria-valuenow')
    ).toBe('50');
    expect(screen.getByText('1 done')).toBeTruthy();
    expect(screen.getByText('1 blocked')).toBeTruthy();
  });

  it('shows no progress meter for a Task, whose progress only mirrors Done', () => {
    renderInspector();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('reads Planning as a summary row and changes it without a Save step', async () => {
    const user = userEvent.setup();
    const planningPlacement = {
      kind: 'window',
      startDate: '2026-09-10',
      endDate: '2026-09-10'
    } as const;
    const onUpdate = vi.fn().mockResolvedValue({ ...node, planningPlacement, version: 1 });
    renderInspector({
      node: { ...node, planningPlacement: { kind: 'milestone', date: '2026-08-01' } },
      onUpdate
    });

    const planning = screen.getByRole('region', { name: 'Planning' });
    expect(planning.textContent).toMatch(/^PlanningChangeMilestone.*2026$/u);
    expect(screen.queryByRole('button', { name: /Save/u })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Change planning' }));
    await user.click(screen.getByRole('button', { name: 'Planning Window' }));
    for (const label of ['Planned start', 'Planned end']) {
      await user.clear(screen.getByLabelText(label));
      await user.type(screen.getByLabelText(label), '2026-09-10');
    }
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'node' }), {
      planningPlacement
    });
  });

  it('explains the placement choices without implying a due date', async () => {
    const user = userEvent.setup();
    renderInspector();
    await user.click(screen.getByRole('button', { name: 'Change planning' }));

    expect(
      screen.getByRole('group', {
        name: 'Placement',
        description:
          'Planning Windows show when work is intended to happen. A Milestone is a checkpoint ' +
          'planned for one date. Neither sets a due date. Due dates are not tracked yet.'
      })
    ).toBeTruthy();
  });

  it('refuses an inverted Planning Window and explicitly unschedules existing placement', async () => {
    const user = userEvent.setup();
    const scheduledNode: ProjectedNode = {
      ...node,
      planningPlacement: { kind: 'window', startDate: '2026-09-10', endDate: '2026-09-20' }
    };
    const onUpdate = vi.fn().mockResolvedValue({ ...node, version: 1 });
    renderInspector({ node: scheduledNode, onUpdate });

    await user.click(screen.getByRole('button', { name: 'Change planning' }));
    const end = screen.getByLabelText<HTMLInputElement>('Planned end');
    await user.clear(end);
    await user.type(end, '2026-09-01');
    expect(screen.getByText('A Planning Window cannot end before it starts.')).toBeTruthy();
    expect(onUpdate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Unscheduled' }));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(scheduledNode, { planningPlacement: null });
  });

  it('finishes Planning with Escape, so only a second Escape reaches the canvas', async () => {
    const user = userEvent.setup();
    const canvasKeys = vi.fn();
    window.addEventListener('keydown', canvasKeys);
    try {
      renderInspector();
      await user.click(screen.getByRole('button', { name: 'Change planning' }));
      await user.click(screen.getByRole('button', { name: 'Milestone' }));
      await user.keyboard('{Escape}');

      expect(screen.queryByRole('group', { name: 'Placement' })).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change planning' }));
      expect(canvasKeys).not.toHaveBeenCalled();
      await user.keyboard('{Escape}');
      expect(canvasKeys).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('keydown', canvasKeys);
    }
  });

  it('shows a Note as rendered text or as Markdown source, never both', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue({ ...note, content: '# Revised' });
    renderInspector({ node: note, onUpdate });

    expect(screen.queryByText('Requested status')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Planning' })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('Initial').tagName).toBe('STRONG');
    expect(screen.queryByRole('textbox')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Edit note' }));
    const content = screen.getByLabelText<HTMLTextAreaElement>('Markdown');
    expect(content.value).toBe('**Initial** thought');
    expect(screen.queryByText('Initial')).toBeNull();
    await user.clear(content);
    await user.type(content, '# Revised');
    await user.click(screen.getByRole('button', { name: 'Finish editing note' }));

    expect(onUpdate).toHaveBeenCalledWith(note, { content: '# Revised' });
    expect(await screen.findByRole('heading', { name: 'Revised' })).toBeTruthy();
  });

  it('names the kind it deletes', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const view = renderInspector({ onDelete });
    await user.click(screen.getByRole('button', { name: 'Delete task' }));
    expect(onDelete).toHaveBeenCalledWith(node);
    expect(screen.queryByText(/SQLite/u)).toBeNull();

    for (const [subject, label] of [
      [{ ...node, kind: 'group' as const }, 'Delete group'],
      [note, 'Delete note']
    ] as const) {
      view.rerender(
        <Inspector
          node={subject}
          placement="right"
          onClose={vi.fn()}
          onDelete={onDelete}
          onUpdate={vi.fn()}
        />
      );
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('lets changed eligibility be re-enabled or disabled to request an active stop', async () => {
    const user = userEvent.setup();
    const onEnable = vi.fn().mockResolvedValue(undefined);
    const onDisable = vi.fn().mockResolvedValue(undefined);
    renderInspector({
      execution,
      onEnableTaskForAgents: onEnable,
      onDisableTaskForAgents: onDisable
    });

    expect(
      screen.getByText(
        "Enabled, but its instructions changed since. Agents can't pick it up until you re-enable it."
      )
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Re-enable for agents' }));
    expect(onEnable).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Disable for agents' }));
    expect(onDisable).toHaveBeenCalledOnce();
  });

  it('runs only one task authorization command and disables every task control while pending', async () => {
    const enablement = deferred<void>();
    const onEnable = vi.fn().mockReturnValue(enablement.promise);
    const onDisable = vi.fn().mockResolvedValue(undefined);
    renderInspector({
      execution,
      onEnableTaskForAgents: onEnable,
      onDisableTaskForAgents: onDisable
    });

    const reenable = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Re-enable for agents'
    });
    const disable = screen.getByRole<HTMLButtonElement>('button', { name: 'Disable for agents' });
    fireEvent.click(reenable);
    fireEvent.click(reenable);
    fireEvent.click(disable);

    await waitFor(() => expect(onEnable).toHaveBeenCalledOnce());
    expect(onDisable).not.toHaveBeenCalled();
    expect(reenable.disabled).toBe(true);
    expect(disable.disabled).toBe(true);

    await act(async () => {
      enablement.resolve();
      await enablement.promise;
    });
    await waitFor(() => expect(reenable.disabled).toBe(false));
    expect(disable.disabled).toBe(false);
  });

  it('re-enables task authorization controls when a command rejects', async () => {
    const enablement = deferred<void>();
    const onEnable = vi.fn().mockReturnValue(enablement.promise);
    renderInspector({
      execution,
      onEnableTaskForAgents: onEnable,
      onDisableTaskForAgents: vi.fn().mockResolvedValue(undefined)
    });

    const reenable = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Re-enable for agents'
    });
    fireEvent.click(reenable);
    await waitFor(() => expect(onEnable).toHaveBeenCalledOnce());
    expect(reenable.disabled).toBe(true);

    await act(async () => {
      enablement.reject(new Error('Enablement failed.'));
      await expect(enablement.promise).rejects.toThrow('Enablement failed.');
    });

    await waitFor(() => expect(reenable.disabled).toBe(false));
  });

  it('distinguishes Stop Requested from confirmed stopped Attempts', () => {
    const attempt = {
      attemptId: '00000000-0000-4000-8000-000000000002',
      taskId: 'node',
      workerId: 'worker',
      claimedFingerprint: execution.currentFingerprint,
      enablementId: execution.enablementId!,
      inputSnapshot: {
        taskId: 'node',
        reference: 'N2-1',
        title: 'Original',
        description: '',
        dependencies: [],
        dependents: []
      },
      state: 'stop_requested' as const,
      progress: null,
      claimedAt: '2026-08-21T12:00:00.000Z',
      heartbeatAt: '2026-08-21T12:01:00.000Z',
      stopRequestedAt: '2026-08-21T12:02:00.000Z',
      finishedAt: null,
      newerInstructionsExist: false,
      stopRequested: true
    };
    const { rerender } = renderInspector({
      execution: { ...execution, latestAttempt: attempt, activeAttempt: attempt }
    });
    expect(screen.getByText('Stop requested — agent still running')).toBeTruthy();

    rerender(
      <Inspector
        node={node}
        placement="right"
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
        execution={{
          ...execution,
          latestAttempt: {
            ...attempt,
            state: 'stopped',
            stopRequested: false,
            finishedAt: '2026-08-21T12:03:00.000Z'
          },
          activeAttempt: null
        }}
      />
    );
    expect(screen.getByText('Stopped (confirmed)')).toBeTruthy();
  });

  it('shows a Group preview list before the explicit confirm action', async () => {
    const user = userEvent.setup();
    const group = { ...node, kind: 'group' as const };
    const preview: GroupEnablePreview = {
      projectId: 'default',
      groupId: group.id,
      previewToken: `sha256:${'3'.repeat(64)}`,
      tasks: [{ taskId: 'task', reference: 'N2-9', title: 'Previewed Task' }]
    };
    const onConfirm = vi.fn().mockResolvedValue(true);
    renderInspector({
      node: group,
      onPreviewGroupEnablement: vi.fn().mockResolvedValue(preview),
      onConfirmGroupEnablement: onConfirm
    });

    await user.click(screen.getByRole('button', { name: 'Enable existing work for agents' }));
    expect(await screen.findByText('1 existing Task will be enabled:')).toBeTruthy();
    expect(screen.getByText('N2-9 · Previewed Task')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm enablement' }));
    expect(onConfirm).toHaveBeenCalledWith(preview);
  });

  it('runs only one Group confirmation and disables the entire enablement flow while pending', async () => {
    const user = userEvent.setup();
    const group = { ...node, kind: 'group' as const };
    const preview: GroupEnablePreview = {
      projectId: 'default',
      groupId: group.id,
      previewToken: `sha256:${'3'.repeat(64)}`,
      tasks: [{ taskId: 'task', reference: 'N2-9', title: 'Previewed Task' }]
    };
    const confirmation = deferred<boolean>();
    const onPreview = vi.fn().mockResolvedValue(preview);
    const onConfirm = vi.fn().mockReturnValue(confirmation.promise);
    renderInspector({
      node: group,
      onPreviewGroupEnablement: onPreview,
      onConfirmGroupEnablement: onConfirm
    });

    await user.click(screen.getByRole('button', { name: 'Enable existing work for agents' }));
    const confirm = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Confirm enablement'
    });
    const previewAgain = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Enable existing work for agents'
    });
    const cancel = screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' });

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(previewAgain);

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onPreview).toHaveBeenCalledOnce();
    expect(confirm.disabled).toBe(true);
    expect(previewAgain.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);

    await act(async () => {
      confirmation.resolve(true);
      await confirmation.promise;
    });
    await waitFor(() => expect(screen.queryByText('Confirm enablement')).toBeNull());
    expect(previewAgain.disabled).toBe(false);
  });
});
