import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityRun } from '@n2/contracts';
import type { ActivitySession } from '../activityQueries.js';
import type { NavigationIntent } from '../useCanvasNavigation.js';
import { ActivityPanel } from './ActivityPanel.js';

afterEach(cleanup);

function Harness({ onCanvasEscape }: { onCanvasEscape: () => void }) {
  const [open, setOpen] = useState(false);
  const session: ActivitySession = {
    activity: undefined,
    open,
    close: () => setOpen(false),
    toggle: () => setOpen(!open)
  };
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCanvasEscape();
      }}
    >
      <button type="button" onClick={session.toggle}>
        Activity
      </button>
      {open ? <ActivityPanel session={session} onOpenItem={() => undefined} /> : null}
    </div>
  );
}

describe('Activity sheet focus', () => {
  it('takes focus on open so the first Escape closes it, then returns focus', async () => {
    const user = userEvent.setup();
    const onCanvasEscape = vi.fn();
    render(<Harness onCanvasEscape={onCanvasEscape} />);
    const opener = screen.getByRole('button', { name: 'Activity' });

    await user.click(opener);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'What changed' }));

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Project activity' })).toBeNull();
    // The selection behind the sheet never hears that Escape.
    expect(onCanvasEscape).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });
});

const epic = {
  id: 'epic',
  reference: 'N2-2',
  title: 'Epic',
  kind: 'group',
  present: true
} as const;

/** One rename of the item, which every entry names by its title now, "C". */
const renameRun = (sequence: number, from: string | null, to: string): ActivityRun => ({
  actor: { kind: 'agent', name: 'lead' },
  startedAt: '2026-10-21T09:00:00.000Z',
  endedAt: '2026-10-21T09:00:00.000Z',
  firstSequence: sequence,
  lastSequence: sequence,
  unseen: true,
  entries: [
    {
      subject: { id: 'item', reference: 'N2-1', title: 'C', kind: 'task', present: true },
      lastSequence: sequence,
      at: '2026-10-21T09:00:00.000Z',
      commandCount: 1,
      changes: [
        { kind: 'renamed', from, to },
        { kind: 'relationship', change: 'added', relationship: 'member_of', other: epic }
      ]
    }
  ]
});

const renamedThrice: ActivitySession = {
  activity: {
    projectId: 'project',
    latestSequence: 3,
    seen: null,
    unseenItemCount: 1,
    runs: [renameRun(3, 'B', 'C'), renameRun(2, 'A', 'B'), renameRun(1, null, 'A')],
    hasEarlier: false
  },
  open: true,
  close: () => undefined,
  toggle: () => undefined
};

describe('Activity entry wording', () => {
  it('names where each rename went, since the subject shows only today’s title', () => {
    render(<ActivityPanel session={renamedThrice} onOpenItem={() => undefined} />);

    expect(
      screen.getAllByText(/^Renamed/).map((change) => change.textContent.replace(/\s+/g, ' '))
    ).toEqual(['Renamed “B” → “C”', 'Renamed “A” → “B”', 'Renamed to “A”']);
  });
});

describe('Activity links', () => {
  it('waits for the whole response, from an older entry or a relationship, and marks only its link', async () => {
    const user = userEvent.setup();
    const onOpenItem = vi.fn<(intent: NavigationIntent) => void>();
    const { rerender } = render(<ActivityPanel session={renamedThrice} onOpenItem={onOpenItem} />);
    const items = screen.getAllByRole('button', { name: /N2-1/ });
    const epics = screen.getAllByRole('button', { name: /N2-2/ });

    // The oldest entry already calls the item "C", so it needs a graph that has the latest rename.
    await user.click(items[2]!);
    await user.click(epics[2]!);
    expect(onOpenItem.mock.calls.map(([{ nodeId, sequence }]) => [nodeId, sequence])).toEqual([
      ['item', 3],
      ['epic', 3]
    ]);

    const oldest = onOpenItem.mock.calls[0]?.[0] ?? null;
    rerender(
      <ActivityPanel session={renamedThrice} onOpenItem={onOpenItem} pendingItem={oldest} />
    );
    const busy = [...items, ...epics].filter((link) => link.getAttribute('aria-busy') === 'true');
    expect(busy).toEqual([items[2]]);
  });
});

describe('Activity sections', () => {
  const sessionOf = (runs: ActivityRun[]): ActivitySession => ({
    ...renamedThrice,
    activity: {
      projectId: 'project',
      latestSequence: 3,
      seen: { sequence: 1, seenAt: '2026-10-21T08:00:00.000Z' },
      unseenItemCount: runs.some(({ unseen }) => unseen) ? 1 : 0,
      runs,
      hasEarlier: false
    }
  });
  const person = { ...renameRun(3, 'B', 'C'), actor: { kind: 'person' }, unseen: false } as const;
  const agent = renameRun(2, 'A', 'B');

  it('is caught up when only the Person changed things since they looked', () => {
    render(<ActivityPanel session={sessionOf([person])} onOpenItem={() => undefined} />);

    expect(screen.getByText('You’re caught up.')).toBeTruthy();
    expect(screen.queryByText('New since you last looked')).toBeNull();
  });

  it('lists as new only the runs the server marks unseen', () => {
    render(<ActivityPanel session={sessionOf([person, agent])} onOpenItem={() => undefined} />);

    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    ).toEqual(['New since you last looked', 'Earlier']);
    expect(
      screen.getAllByRole('article').map((run) => run.classList.contains('activity-run--new'))
    ).toEqual([true, false]);
  });
});
