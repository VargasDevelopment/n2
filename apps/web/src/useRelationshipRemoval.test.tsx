import type { ProjectedProject, ProjectedRelationship } from '@n2/contracts';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from './components/NotificationProvider.js';
import type { GraphSelection } from './graphInteraction.js';
import type { ProjectCommandDispatch, ProjectCommandResult } from './useProjectCommands.js';
import { useRelationshipRemoval } from './useRelationshipRemoval.js';

const now = '2026-08-21T12:00:00.000Z';
const task = (id: string, reference: string) => ({
  id,
  kind: 'task' as const,
  reference,
  title: `Title of ${id}`,
  description: '',
  requestedStatus: 'ready' as const,
  effectiveStatus: 'ready' as const,
  progress: 0,
  blockedBy: [],
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: now,
  updatedAt: now
});
const dependency: ProjectedRelationship = {
  id: 'dependency',
  kind: 'depends_on',
  dependentId: 'a',
  dependencyId: 'b',
  createdAt: now,
  isBlocking: false
};
const project: ProjectedProject = {
  id: 'project',
  name: 'N²',
  referenceKey: 'N2',
  nodes: [task('a', 'N2-5'), task('b', 'N2-6')],
  relationships: [dependency],
  warnings: [],
  latestSequence: 0
};

function RemoveButton({ dispatch }: { dispatch: ProjectCommandDispatch }) {
  const [selection, setSelection] = useState<GraphSelection>({
    nodeIds: [],
    relationshipIds: ['dependency'],
    inspectorPlacement: 'right'
  });
  const remove = useRelationshipRemoval({ project, dispatch, setSelection });
  return (
    <>
      <button type="button" onClick={() => void remove('dependency')}>
        Remove
      </button>
      <span data-testid="selected-relationships">{selection.relationshipIds.join(' ')}</span>
    </>
  );
}

afterEach(cleanup);

describe('useRelationshipRemoval', () => {
  it('removes, deselects, and offers an Undo that re-creates the relationship by its roles', async () => {
    const user = userEvent.setup();
    const executed: ProjectCommandResult = { status: 'executed', project };
    const dispatch = vi.fn<ProjectCommandDispatch>().mockResolvedValue(executed);
    render(
      <NotificationProvider>
        <RemoveButton dispatch={dispatch} />
      </NotificationProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(dispatch).toHaveBeenCalledWith({
      kind: 'delete_relationship',
      relationshipId: 'dependency'
    });
    expect(screen.getByTestId('selected-relationships').textContent).toBe('');
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toContain('N2-5 no longer depends on N2-6.');

    await user.click(within(notice).getByRole('button', { name: 'Undo' }));

    expect(dispatch).toHaveBeenLastCalledWith({
      kind: 'create_relationship',
      input: { kind: 'depends_on', dependentId: 'a', dependencyId: 'b' }
    });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('keeps the selection and stays silent when the removal does not run', async () => {
    const user = userEvent.setup();
    const dispatch = vi
      .fn<ProjectCommandDispatch>()
      .mockResolvedValue({ status: 'failed', project: null });
    render(
      <NotificationProvider>
        <RemoveButton dispatch={dispatch} />
      </NotificationProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('selected-relationships').textContent).toBe('dependency');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
