import type { NodeStatus } from '@n2/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DirectlyRelatedWorkNode, DirectRelationships } from '../directRelationships.js';
import { InspectorRelationships, RELATED_ROWS_SHOWN } from './InspectorRelationships.js';

const now = '2026-08-21T12:00:00.000Z';

const related = (
  id: string,
  reference: string,
  {
    effectiveStatus = 'ready',
    isGroup = false,
    isVisible = true
  }: { effectiveStatus?: NodeStatus; isGroup?: boolean; isVisible?: boolean } = {}
): DirectlyRelatedWorkNode => {
  const fields = {
    id,
    reference,
    title: `Title of ${id}`,
    description: '',
    requestedStatus: 'ready' as const,
    effectiveStatus,
    progress: 0,
    blockedBy: [],
    position: { x: 0, y: 0 },
    version: 0,
    createdAt: now,
    updatedAt: now
  };
  return {
    relationshipId: `relationship-${id}`,
    isVisible,
    node: isGroup ? { ...fields, kind: 'group' } : { ...fields, kind: 'task' }
  };
};

const empty: DirectRelationships = { dependencies: [], dependents: [], groups: [], members: [] };

afterEach(() => {
  cleanup();
});

describe('InspectorRelationships', () => {
  it('lists each populated named role with reference, title, and effective status', () => {
    render(
      <InspectorRelationships
        relationships={{
          ...empty,
          dependencies: [related('legal', 'N2-6', { effectiveStatus: 'blocked' })],
          groups: [related('launch', 'N2-1', { isGroup: true, effectiveStatus: 'in_progress' })]
        }}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    const section = screen.getByRole('region', { name: 'Direct relationships' });
    expect(within(section).getByRole('heading', { name: 'Depends on 1' })).toBeTruthy();
    expect(within(section).getByRole('heading', { name: 'Part of 1' })).toBeTruthy();
    expect(within(section).queryByRole('heading', { name: /Dependents/u })).toBeNull();
    expect(
      within(section).getByRole('button', { name: 'N2-6 Title of legal, Blocked' })
    ).toBeTruthy();
    expect(
      within(section).getByRole('button', { name: 'N2-1 Title of launch, In progress' })
    ).toBeTruthy();
  });

  it('selects a visible related node and refuses one hidden by the current view', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <InspectorRelationships
        relationships={{
          ...empty,
          dependents: [related('announce', 'N2-8'), related('hidden', 'N2-9', { isVisible: false })]
        }}
        onSelect={onSelect}
        onRemove={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'N2-8 Title of announce, Ready' }));
    expect(onSelect).toHaveBeenCalledWith('announce');

    const hidden = screen.getByRole<HTMLButtonElement>('button', {
      name: 'N2-9 Title of hidden, Ready, hidden in this view'
    });
    expect(hidden.disabled).toBe(true);
    await user.click(hidden);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("lists a Group's members and folds a long list behind an expander", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const members = Array.from({ length: RELATED_ROWS_SHOWN + 3 }, (_, index) =>
      related(`member-${index + 1}`, `N2-${index + 1}`)
    );
    render(
      <InspectorRelationships
        relationships={{ ...empty, members }}
        onSelect={onSelect}
        onRemove={vi.fn()}
      />
    );

    const section = screen.getByRole('region', { name: 'Direct relationships' });
    expect(
      within(section).getByRole('heading', { name: `Members ${members.length}` })
    ).toBeTruthy();
    expect(within(section).getAllByRole('listitem')).toHaveLength(RELATED_ROWS_SHOWN);

    await user.click(within(section).getByRole('button', { name: '+3 more' }));
    expect(within(section).getAllByRole('listitem')).toHaveLength(members.length);
    expect(within(section).queryByRole('button', { name: /more$/u })).toBeNull();

    const last = members.length;
    await user.click(
      within(section).getByRole('button', { name: `N2-${last} Title of member-${last}, Ready` })
    );
    expect(onSelect).toHaveBeenCalledWith(`member-${last}`);
  });

  it("folds a Group's done members and leads with the blocking one", async () => {
    const user = userEvent.setup();
    render(
      <InspectorRelationships
        relationships={{
          ...empty,
          members: [
            related('a', 'N2-1', { effectiveStatus: 'done' }),
            related('b', 'N2-2'),
            related('c', 'N2-3', { effectiveStatus: 'done' }),
            related('d', 'N2-4', { effectiveStatus: 'blocked' })
          ]
        }}
        blockedBy={['d']}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    const names = () =>
      screen
        .getAllByRole('listitem')
        .map((row) => within(row).getAllByRole('button')[0]?.ariaLabel);
    expect(names()).toEqual(['N2-4 Title of d, Blocked, blocking', 'N2-2 Title of b, Ready']);
    await user.click(screen.getByRole('button', { name: 'Show 2 done' }));
    expect(names()).toHaveLength(4);
  });

  it('removes a relationship from its row, named by its role, even when the other end is hidden', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    render(
      <InspectorRelationships
        relationships={{
          ...empty,
          dependencies: [related('legal', 'N2-6', { isVisible: false })],
          groups: [related('launch', 'N2-1', { isGroup: true })]
        }}
        onSelect={onSelect}
        onRemove={onRemove}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Remove from N2-1 Title of launch' }));
    expect(onRemove).toHaveBeenCalledWith('relationship-launch');
    await user.click(screen.getByRole('button', { name: 'Stop depending on N2-6 Title of legal' }));
    expect(onRemove).toHaveBeenLastCalledWith('relationship-legal');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders nothing for work without direct relationships', () => {
    const { container } = render(
      <InspectorRelationships relationships={empty} onSelect={vi.fn()} onRemove={vi.fn()} />
    );

    expect(container.childElementCount).toBe(0);
  });
});
