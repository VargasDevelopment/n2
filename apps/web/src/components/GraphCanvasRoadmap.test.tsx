import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { reactFlowRenderSpy } = vi.hoisted(() => ({ reactFlowRenderSpy: vi.fn() }));

vi.mock('@xyflow/react', async () => {
  const { createGraphCanvasReactFlowMock } = await import('./GraphCanvasReactFlowMock.js');
  return createGraphCanvasReactFlowMock(reactFlowRenderSpy);
});

import {
  makeNode,
  makeNote,
  makeProject,
  nodeById,
  renderCanvas
} from './GraphCanvasTestHarness.js';

afterEach(() => {
  cleanup();
  reactFlowRenderSpy.mockClear();
});

describe('GraphCanvas Roadmap interactions', () => {
  it('renders calendar placement and keeps all Roadmap geometry presentation-only', () => {
    const scheduled = makeNode('scheduled', {
      planningPlacement: {
        kind: 'window',
        startDate: '2026-09-10',
        endDate: '2026-09-12'
      },
      position: { x: 900, y: 700 }
    });
    const unscheduled = makeNode('unscheduled', { position: { x: 400, y: 300 } });
    const note = makeNote();
    const { callbacks } = renderCanvas({
      project: makeProject([scheduled, unscheduled, note]),
      transformations: new Set(['roadmap'])
    });

    expect(screen.getByRole('button', { name: 'Roadmap' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(screen.getByText('Scheduled work')).toBeTruthy();
    expect(screen.getByText('Unscheduled work')).toBeTruthy();
    expect(nodeById(scheduled.id).getAttribute('data-node-type')).toBe('roadmap');
    expect(nodeById(scheduled.id).getAttribute('data-node-placement-kind')).toBe('window');
    expect(nodeById(scheduled.id).getAttribute('data-node-placement-label')).toBe(
      'Sep 10 – Sep 12, 2026'
    );
    expect(nodeById(scheduled.id).getAttribute('data-node-width')).toBe('192');
    expect(nodeById(scheduled.id).getAttribute('data-node-x')).not.toBe('900');
    expect(nodeById(scheduled.id).getAttribute('data-node-draggable')).toBe('false');
    expect(nodeById(unscheduled.id).getAttribute('data-node-draggable')).toBe('false');
    expect(nodeById(unscheduled.id).getAttribute('data-node-type')).toBe('n2');
    expect(nodeById(note.id).getAttribute('data-node-height')).toBe('300');
    expect(nodeById(note.id).parentElement?.classList.contains('n2-canvas-note--folded')).toBe(
      true
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Mock move first node to next Kanban column' })
    );
    expect(callbacks.onSetRequestedStatus).not.toHaveBeenCalled();
    expect(callbacks.onMoveNodes).not.toHaveBeenCalled();
  });

  it('edits, scrubs, and restores the Roadmap range as presentation state', () => {
    const scheduled = makeNode('scheduled', {
      planningPlacement: {
        kind: 'window',
        startDate: '2026-09-10',
        endDate: '2026-09-12'
      }
    });
    const { callbacks } = renderCanvas({
      project: makeProject([scheduled]),
      transformations: new Set(['roadmap'])
    });

    const start = screen.getByLabelText('Roadmap range start');
    const end = screen.getByLabelText('Roadmap range end');
    expect(start.getAttribute('value')).toBe('2026-09-07');
    expect(end.getAttribute('value')).toBe('2026-09-15');
    expect(screen.getByText('Auto range')).toBeTruthy();

    fireEvent.change(start, { target: { value: '2026-09-08' } });
    expect(callbacks.onSetRoadmapRange).toHaveBeenLastCalledWith({
      startDate: '2026-09-08',
      endDate: '2026-09-15'
    });
    expect(screen.getByText('Roadmap range')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show next Roadmap range' }));
    expect(callbacks.onSetRoadmapRange).toHaveBeenLastCalledWith({
      startDate: '2026-09-16',
      endDate: '2026-09-23'
    });

    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
    expect(callbacks.onResetRoadmapRange).toHaveBeenCalledOnce();
    expect(screen.getByText('Auto range')).toBeTruthy();
  });

  it('keeps the Roadmap range ordered when either endpoint crosses the other', () => {
    const scheduled = makeNode('scheduled', {
      planningPlacement: { kind: 'milestone', date: '2026-09-10' }
    });
    const { callbacks } = renderCanvas({
      project: makeProject([scheduled]),
      transformations: new Set(['roadmap'])
    });

    fireEvent.change(screen.getByLabelText('Roadmap range start'), {
      target: { value: '2026-09-20' }
    });
    expect(callbacks.onSetRoadmapRange).toHaveBeenLastCalledWith({
      startDate: '2026-09-20',
      endDate: '2026-09-20'
    });

    fireEvent.change(screen.getByLabelText('Roadmap range end'), {
      target: { value: '2026-09-01' }
    });
    expect(callbacks.onSetRoadmapRange).toHaveBeenLastCalledWith({
      startDate: '2026-09-01',
      endDate: '2026-09-01'
    });
  });
});
