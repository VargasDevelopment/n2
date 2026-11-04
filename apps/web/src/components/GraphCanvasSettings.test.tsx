import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasTransformationId } from '../canvasView.js';

vi.mock('@xyflow/react', async () => {
  const { createGraphCanvasReactFlowMock } = await import('./GraphCanvasReactFlowMock.js');
  return createGraphCanvasReactFlowMock(vi.fn());
});

import { makeNode, makeProject, nodeById, renderCanvas } from './GraphCanvasTestHarness.js';

afterEach(cleanup);

const presentations: readonly (readonly [string, ReadonlySet<CanvasTransformationId>])[] = [
  ['Freeform', new Set()],
  ['Kanban', new Set(['kanban'])],
  ['Roadmap', new Set(['roadmap'])],
  ['Swimlane', new Set(['swimlane'])],
  ['Roadmap Swimlane', new Set(['roadmap', 'swimlane'])]
];

describe('GraphCanvas effective Settings', () => {
  it.each(presentations)('applies minimap visibility to %s presentation', (_, transformations) => {
    renderCanvas({
      settings: { handleOrientation: 'horizontal', minimapVisible: false, theme: 'midnight' },
      transformations
    });

    expect(screen.queryByTestId('mock-minimap')).toBeNull();
  });

  it('reconciles live Settings on one mounted graph without moving graph geometry', () => {
    const scheduled = makeNode('scheduled', {
      planningPlacement: {
        kind: 'window',
        startDate: '2026-09-10',
        endDate: '2026-09-12'
      },
      position: { x: 900, y: 700 }
    });
    const unscheduled = makeNode('unscheduled', { position: { x: 400, y: 300 } });
    const project = makeProject([scheduled, unscheduled]);

    const rendered = renderCanvas({
      project,
      settings: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
      transformations: new Set()
    });
    const horizontalGeometry = [scheduled.id, unscheduled.id].map((id) => ({
      x: nodeById(id).getAttribute('data-node-x'),
      y: nodeById(id).getAttribute('data-node-y')
    }));
    expect(nodeById(scheduled.id).getAttribute('data-node-handle-orientation')).toBe('horizontal');
    expect(nodeById(unscheduled.id).getAttribute('data-node-handle-orientation')).toBe(
      'horizontal'
    );
    expect(screen.getByTestId('mock-minimap')).toBeTruthy();
    rendered.replaceSettings({
      handleOrientation: 'vertical',
      minimapVisible: false,
      theme: 'midnight'
    });

    expect(nodeById(scheduled.id).getAttribute('data-node-type')).toBe('n2');
    expect(nodeById(unscheduled.id).getAttribute('data-node-type')).toBe('n2');
    expect(nodeById(scheduled.id).getAttribute('data-node-handle-orientation')).toBe('vertical');
    expect(nodeById(unscheduled.id).getAttribute('data-node-handle-orientation')).toBe('vertical');
    expect(nodeById(scheduled.id).getAttribute('data-node-handles')).toBe(
      'relationship-subject:source:top,relationship-object:target:bottom'
    );
    expect(nodeById(unscheduled.id).getAttribute('data-node-handles')).toBe(
      'relationship-subject:source:top,relationship-object:target:bottom'
    );
    expect(
      [scheduled.id, unscheduled.id].map((id) => ({
        x: nodeById(id).getAttribute('data-node-x'),
        y: nodeById(id).getAttribute('data-node-y')
      }))
    ).toEqual(horizontalGeometry);
    expect(screen.queryByTestId('mock-minimap')).toBeNull();
    expect(rendered.callbacks.onMoveNodes).not.toHaveBeenCalled();
    expect(rendered.callbacks.onSetRequestedStatus).not.toHaveBeenCalled();
    expect(rendered.callbacks.onSetRoadmapRange).not.toHaveBeenCalled();
  });

  it.each([
    ['Roadmap', new Set<CanvasTransformationId>(['roadmap'])],
    ['Roadmap Swimlane', new Set<CanvasTransformationId>(['roadmap', 'swimlane'])]
  ])('keeps every item left to right in %s despite a vertical preference', (_, transformations) => {
    const scheduled = makeNode('scheduled', {
      planningPlacement: {
        kind: 'milestone',
        date: '2026-09-10'
      }
    });
    const unscheduled = makeNode('unscheduled');

    renderCanvas({
      project: makeProject([scheduled, unscheduled]),
      settings: { handleOrientation: 'vertical', minimapVisible: true, theme: 'midnight' },
      transformations
    });

    expect(nodeById(scheduled.id).getAttribute('data-node-type')).toBe('roadmap');
    expect(nodeById(unscheduled.id).getAttribute('data-node-type')).toBe('n2');
    expect(nodeById(unscheduled.id).getAttribute('data-node-handle-orientation')).toBe(
      'horizontal'
    );
    expect(nodeById(scheduled.id).getAttribute('data-node-handles')).toBe(
      'relationship-subject:source:left,relationship-object:target:right'
    );
    expect(nodeById(unscheduled.id).getAttribute('data-node-handles')).toBe(
      'relationship-subject:source:left,relationship-object:target:right'
    );
  });
});
