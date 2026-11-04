import type { ProjectedWorkNode } from '@n2/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { N2CanvasNode } from './canvasNodes.js';
import type { N2NodeActions, StandardCanvasNode } from './components/N2Node.js';
import { reconcileCanvasNodes } from './graphReconciliation.js';

const now = '2026-08-24T12:00:00.000Z';
const node: ProjectedWorkNode = {
  id: 'node',
  reference: 'N2-1',
  title: 'Node',
  description: '',
  kind: 'task',
  requestedStatus: 'ready',
  effectiveStatus: 'ready',
  progress: 0,
  blockedBy: [],
  position: { x: 0, y: 0 },
  version: 1,
  createdAt: now,
  updatedAt: now
};
const actions: N2NodeActions = {
  cycleStatus: vi.fn(),
  deleteNode: vi.fn(),
  rename: vi.fn(),
  toggleNoteFold: vi.fn(),
  touchNote: vi.fn()
};
const resolvedNode = (overrides: Partial<StandardCanvasNode> = {}): N2CanvasNode => ({
  id: node.id,
  type: 'n2',
  position: node.position,
  width: 230,
  height: 140,
  draggable: true,
  focusable: true,
  data: { actions, handleOrientation: 'horizontal', node, noteFold: 'slot' },
  ...overrides
});

describe('reconcileCanvasNodes', () => {
  it('makes the next resolved presentation authoritative instead of carrying optional fields', () => {
    const current = resolvedNode({
      ariaLabel: 'stale presentation',
      className: 'structured-only',
      height: 360,
      hidden: true,
      measured: { width: 230, height: 360 },
      style: { minHeight: 360 }
    });
    const next = resolvedNode();

    const [reconciled] = reconcileCanvasNodes([current], [next], new Map());

    expect(reconciled).toEqual(next);
  });

  it('preserves only measured runtime geometry when geometry is unchanged', () => {
    const current = resolvedNode({
      measured: { width: 230, height: 140 },
      style: { minHeight: 140 }
    });
    const next = resolvedNode({ style: { minHeight: 140 } });

    const [reconciled] = reconcileCanvasNodes([current], [next], new Map());

    expect(reconciled?.measured).toEqual({ width: 230, height: 140 });
  });

  it('drops measured runtime geometry when resolved style values change', () => {
    const current = resolvedNode({
      measured: { width: 230, height: 140 },
      style: { minHeight: 140 }
    });
    const next = resolvedNode({ style: { minHeight: 180 } });

    const [reconciled] = reconcileCanvasNodes([current], [next], new Map());

    expect(reconciled?.measured).toBeUndefined();
  });
});
