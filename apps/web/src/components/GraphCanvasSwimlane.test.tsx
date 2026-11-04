import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@xyflow/react', async () => {
  const { createGraphCanvasReactFlowMock } = await import('./GraphCanvasReactFlowMock.js');
  return createGraphCanvasReactFlowMock(vi.fn());
});

import { makeMembership, makeNode, makeProject, renderCanvas } from './GraphCanvasTestHarness.js';

afterEach(cleanup);

describe('GraphCanvas Swimlane controls', () => {
  it('chooses a Group scope and preserves Swimlanes when switching primary structured views', () => {
    const root = makeNode('root', { kind: 'group', position: { x: 0, y: 0 } });
    const firstLane = makeNode('first-lane', { kind: 'group', position: { x: 0, y: 100 } });
    const secondLane = makeNode('second-lane', { kind: 'group', position: { x: 0, y: 200 } });
    const { callbacks } = renderCanvas({
      project: makeProject(
        [root, firstLane, secondLane],
        [makeMembership(firstLane.id, root.id), makeMembership(secondLane.id, root.id, 'second')]
      ),
      transformations: new Set(['swimlane'])
    });

    const scope = screen.getByRole('combobox', { name: 'Swimlane scope' });
    expect(scope.querySelector('option:checked')?.getAttribute('value')).toBe(root.id);
    fireEvent.change(scope, { target: { value: firstLane.id } });
    expect(callbacks.onSetSwimlaneScopeId).toHaveBeenCalledWith(firstLane.id);
    expect(scope.querySelector('option:checked')?.getAttribute('value')).toBe(firstLane.id);

    fireEvent.click(screen.getByRole('button', { name: 'Kanban' }));
    expect(screen.getByRole('button', { name: 'Kanban' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(screen.getByRole('button', { name: 'Swimlanes' }).getAttribute('aria-pressed')).toBe(
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Roadmap' }));
    expect(screen.getByRole('button', { name: 'Kanban' }).getAttribute('aria-pressed')).toBe(
      'false'
    );
    expect(screen.getByRole('button', { name: 'Roadmap' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(screen.getByRole('button', { name: 'Swimlanes' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('shows a stable filtered fallback when no Group is visible', () => {
    renderCanvas({
      project: makeProject([makeNode('visible-task')]),
      transformations: new Set(['swimlane'])
    });

    const scope = screen.getByRole('combobox', { name: 'Swimlane scope' });
    expect(scope.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('option', { name: 'No visible Groups' })).toBeTruthy();
  });
});
