import type { NodeStatus } from '@n2/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasToolbar } from './CanvasToolbar.js';

afterEach(cleanup);

type CanvasToolbarProps = ComponentProps<typeof CanvasToolbar>;

const renderToolbar = ({
  hiddenStatuses = new Set<NodeStatus>(),
  textQuery = '',
  onActivateNodeTool,
  onTextQueryChange,
  onToggleStatus
}: {
  hiddenStatuses?: ReadonlySet<NodeStatus>;
  textQuery?: string;
  onActivateNodeTool?: CanvasToolbarProps['onActivateNodeTool'];
  onTextQueryChange?: CanvasToolbarProps['onTextQueryChange'];
  onToggleStatus?: CanvasToolbarProps['onToggleStatus'];
} = {}) => {
  const activateNodeTool = onActivateNodeTool ?? vi.fn<CanvasToolbarProps['onActivateNodeTool']>();
  const toggleStatus = onToggleStatus ?? vi.fn<CanvasToolbarProps['onToggleStatus']>();
  render(
    <CanvasToolbar
      nodeKind="task"
      placementKind={null}
      relationshipKind="depends_on"
      hiddenStatuses={hiddenStatuses}
      textQuery={textQuery}
      onActivateNodeTool={activateNodeTool}
      onSelectRelationshipKind={vi.fn()}
      onTextQueryChange={onTextQueryChange ?? vi.fn()}
      onToggleStatus={toggleStatus}
    />
  );
  return { onActivateNodeTool: activateNodeTool, onToggleStatus: toggleStatus };
};

describe('CanvasToolbar', () => {
  it('creates the chosen node at center when activated from the keyboard', async () => {
    const user = userEvent.setup();
    const { onActivateNodeTool } = renderToolbar();

    screen.getByRole('button', { name: /Group node/ }).focus();
    await user.keyboard('{Enter}');

    expect(onActivateNodeTool).toHaveBeenCalledWith({ kind: 'group', method: 'keyboard' });
  });

  it('starts explicit placement when clicked with a pointer', async () => {
    const user = userEvent.setup();
    const { onActivateNodeTool } = renderToolbar();

    await user.click(screen.getByRole('button', { name: /Group node/ }));

    expect(onActivateNodeTool).toHaveBeenCalledWith({ kind: 'group', method: 'pointer' });
  });

  it('exposes the default kind separately from active placement', () => {
    const common = {
      nodeKind: 'group' as const,
      relationshipKind: 'depends_on' as const,
      hiddenStatuses: new Set<NodeStatus>(),
      textQuery: '',
      onActivateNodeTool: vi.fn(),
      onSelectRelationshipKind: vi.fn(),
      onTextQueryChange: vi.fn(),
      onToggleStatus: vi.fn()
    };
    const { rerender } = render(<CanvasToolbar {...common} placementKind={null} />);

    expect(screen.getByRole('button', { name: /Group node/ }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(screen.getByRole('status').textContent).toContain('Default node type: group');

    rerender(<CanvasToolbar {...common} placementKind="group" />);

    expect(
      screen.getByRole('button', { name: /Group node/ }).getAttribute('aria-describedby')
    ).toBe('node-tool-status');
    expect(screen.getByRole('status').textContent).toContain('Placing a group');
  });

  it('teaches canonical subject-to-object relationship direction', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: 'Depends on' }).getAttribute('title')).toBe(
      'Connect the dependent to the dependency'
    );
  });

  it('keeps status filters hidden until requested and exposes active filter state when collapsed', async () => {
    const user = userEvent.setup();
    const onToggleStatus = vi.fn();
    const { rerender } = render(
      <CanvasToolbar
        nodeKind="task"
        placementKind={null}
        relationshipKind="depends_on"
        hiddenStatuses={new Set()}
        textQuery=""
        onActivateNodeTool={vi.fn()}
        onSelectRelationshipKind={vi.fn()}
        onTextQueryChange={vi.fn()}
        onToggleStatus={onToggleStatus}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Filters' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Status filters' })).toBeNull();

    await user.click(trigger);

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const done = screen.getByRole('button', { name: 'Done work is shown' });
    expect(done.getAttribute('aria-pressed')).toBe('true');
    await user.click(done);
    expect(onToggleStatus).toHaveBeenCalledWith('done');

    rerender(
      <CanvasToolbar
        nodeKind="task"
        placementKind={null}
        relationshipKind="depends_on"
        hiddenStatuses={new Set<NodeStatus>(['done'])}
        textQuery=""
        onActivateNodeTool={vi.fn()}
        onSelectRelationshipKind={vi.fn()}
        onTextQueryChange={vi.fn()}
        onToggleStatus={onToggleStatus}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Done work is hidden' }).getAttribute('aria-pressed')
    ).toBe('false');
    expect(screen.getByLabelText('1 status hidden').textContent).toBe('1');

    await user.click(trigger);
    expect(screen.queryByRole('group', { name: 'Status filters' })).toBeNull();
    expect(trigger.getAttribute('title')).toBe('Canvas filters · 1 status hidden');
  });

  it('edits and clears text search while exposing it on the collapsed trigger', async () => {
    const user = userEvent.setup();
    const onTextQueryChange = vi.fn();
    const { rerender } = render(
      <CanvasToolbar
        nodeKind="task"
        placementKind={null}
        relationshipKind="member_of"
        hiddenStatuses={new Set()}
        textQuery=""
        onActivateNodeTool={vi.fn()}
        onSelectRelationshipKind={vi.fn()}
        onTextQueryChange={onTextQueryChange}
        onToggleStatus={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const search = screen.getByRole('searchbox', { name: 'Title or reference' });
    await user.type(search, 'roadmap');
    expect(onTextQueryChange).toHaveBeenCalled();

    rerender(
      <CanvasToolbar
        nodeKind="task"
        placementKind={null}
        relationshipKind="member_of"
        hiddenStatuses={new Set()}
        textQuery="roadmap"
        onActivateNodeTool={vi.fn()}
        onSelectRelationshipKind={vi.fn()}
        onTextQueryChange={onTextQueryChange}
        onToggleStatus={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Text search active').textContent).toBe('1');

    await user.click(screen.getByRole('button', { name: 'Clear text search' }));
    expect(onTextQueryChange).toHaveBeenLastCalledWith('');
  });

  it('dismisses the filter surface with Escape and an outside click', async () => {
    const user = userEvent.setup();
    renderToolbar();
    const trigger = screen.getByRole('button', { name: 'Filters' });

    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Status filters' })).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    await user.click(document.body);
    expect(screen.queryByRole('group', { name: 'Status filters' })).toBeNull();
  });
});
