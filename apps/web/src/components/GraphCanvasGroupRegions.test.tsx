import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasTransformationId } from '../canvasView.js';

const viewport = vi.hoisted(() => ({ zoom: 1 }));

vi.mock('@xyflow/react', async () => {
  const { createGraphCanvasReactFlowMock } = await import('./GraphCanvasReactFlowMock.js');
  return createGraphCanvasReactFlowMock(vi.fn(), () => viewport.zoom);
});

import {
  makeDependency,
  makeMembership,
  makeNode,
  makeProject,
  renderCanvas
} from './GraphCanvasTestHarness.js';

afterEach(() => {
  cleanup();
  viewport.zoom = 1;
});

const group = makeNode('group', { kind: 'group', position: { x: 0, y: 0 } });
const part = makeNode('part', { position: { x: 0, y: 220 } });
const project = makeProject([group, part], [makeMembership(part.id, group.id)]);
const canvas = (): HTMLElement => screen.getByRole('region', { name: 'N2 graph canvas' });
const region = (groupId: string): Element | null =>
  canvas().querySelector(`[data-group-region-id='${groupId}']`);

describe('GraphCanvas Group regions', () => {
  it('draws a Group region on the freeform canvas, in its detail tier', () => {
    renderCanvas({ project });

    expect(region(group.id)).not.toBeNull();
    expect(canvas().getAttribute('data-zoom-tier')).toBe('detail');
  });

  it.each<CanvasTransformationId>(['kanban', 'roadmap', 'swimlane'])(
    'draws no Group regions in %s, whose lanes already show membership',
    (transformation) => {
      renderCanvas({ project, transformations: new Set([transformation]) });

      expect(canvas().querySelector('.group-regions')).toBeNull();
      expect(canvas().hasAttribute('data-zoom-tier')).toBe(false);
    }
  );

  it('lights the selection’s Groups and marks the canvas while the selection focus is active', () => {
    renderCanvas({
      project,
      selection: { nodeIds: [part.id], relationshipIds: [], inspectorPlacement: 'right' }
    });

    expect(canvas().hasAttribute('data-relationship-focus-active')).toBe(true);
    expect(region(group.id)?.hasAttribute('data-group-region-focus')).toBe(true);
  });

  it('steps unrelated relationships back for a selected card that has none of its own', () => {
    const loner = makeNode('loner', { position: { x: 600, y: 0 } });
    renderCanvas({
      project: makeProject([group, part, loner], [makeMembership(part.id, group.id)]),
      selection: { nodeIds: [loner.id], relationshipIds: [], inspectorPlacement: 'right' }
    });

    expect(canvas().hasAttribute('data-relationship-focus-active')).toBe(true);
  });

  it('steps back the zoomed-out bundles that the selection does not reach', () => {
    viewport.zoom = 0.3;
    const other = makeNode('other', { kind: 'group', position: { x: 800, y: 0 } });
    const first = makeNode('first', { position: { x: 800, y: 220 } });
    const second = makeNode('second', { position: { x: 800, y: 440 } });
    const loner = makeNode('loner', { position: { x: 0, y: 900 } });
    const linked = makeProject(
      [group, part, other, first, second, loner],
      [
        makeMembership(part.id, group.id, 'part-of-group'),
        makeMembership(first.id, other.id, 'first-of-other'),
        makeMembership(second.id, other.id, 'second-of-other'),
        makeDependency('part-needs-first', part.id, first.id),
        makeDependency('part-needs-second', part.id, second.id)
      ]
    );
    const focusedWhenSelecting = (nodeId: string): boolean[] => {
      renderCanvas({
        project: linked,
        selection: { nodeIds: [nodeId], relationshipIds: [], inspectorPlacement: 'right' }
      });
      const marks = canvas().querySelectorAll(
        '.relationship-bundle, [data-relationship-bundle-count]'
      );
      const focused = [...marks].map((mark) => mark.hasAttribute('data-relationship-focus'));
      cleanup();
      return focused;
    };

    // The bundle and its count, from the Group's part to the other Group's two.
    expect(focusedWhenSelecting(loner.id)).toEqual([false, false]);
    expect(focusedWhenSelecting(first.id)).toEqual([true, true]);
  });

  it('keeps drawing the other regions when a Group spans too far to draw', () => {
    // Even relative to the Group's own cards, 1e14 px overflows Clipper's integers.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const far = makeNode('far', { position: { x: 1e14, y: 1e14 } });
    const other = makeNode('other', { kind: 'group', position: { x: 600, y: 0 } });
    const otherPart = makeNode('other-part', { position: { x: 600, y: 220 } });
    renderCanvas({
      project: makeProject(
        [group, part, far, other, otherPart],
        [
          makeMembership(part.id, group.id, 'part-of-group'),
          makeMembership(far.id, group.id, 'far-of-group'),
          makeMembership(otherPart.id, other.id, 'part-of-other')
        ]
      )
    });

    expect(region(other.id)).not.toBeNull();
    // The far Group keeps its padded cards, and the failure is reported once.
    expect(region(group.id)).not.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
