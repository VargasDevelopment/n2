import type { ProjectedNode } from '@n2/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  applyAuthoritativePositions,
  beginLocalDrag,
  finishLocalSave,
  prepareLocalSave,
  reconcileCanvasNodes,
  updateLocalDrag,
  type LocalNodePosition
} from '../graphReconciliation.js';
import type { N2CanvasNode } from '../canvasNodes.js';
import type { N2NodeActions } from './N2Node.js';

const node: ProjectedNode = {
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
  version: 0,
  createdAt: '2026-08-21T12:00:00.000Z',
  updatedAt: '2026-08-21T12:00:00.000Z'
};
const actions: N2NodeActions = {
  cycleStatus: vi.fn(),
  deleteNode: vi.fn(),
  rename: vi.fn(),
  toggleNoteFold: vi.fn(),
  touchNote: vi.fn()
};
const canvasNode = (x: number, dragging = false): N2CanvasNode => ({
  id: node.id,
  type: 'n2',
  position: { x, y: 0 },
  dragging,
  data: { node, actions, handleOrientation: 'horizontal', noteFold: 'slot' }
});

describe('reconcileCanvasNodes', () => {
  it('preserves an active drag across an unrelated project refresh', () => {
    const positions = new Map<string, LocalNodePosition>();
    beginLocalDrag(positions, node.id, { x: 90, y: 0 });
    const [reconciled] = reconcileCanvasNodes([canvasNode(90, true)], [canvasNode(0)], positions);

    expect(reconciled?.position).toEqual({ x: 90, y: 0 });
    expect(reconciled?.dragging).toBe(true);
  });

  it('preserves a dropped position until its owning persistence operation finishes', () => {
    const localPositions = new Map<string, LocalNodePosition>();
    beginLocalDrag(localPositions, node.id, { x: 0, y: 0 });
    updateLocalDrag(localPositions, node.id, { x: 90, y: 0 });
    const revision = prepareLocalSave(localPositions, node.id, { x: 90, y: 0 });
    expect(revision).not.toBeNull();
    const [whileSaving] = reconcileCanvasNodes([canvasNode(90)], [canvasNode(0)], localPositions);
    expect(whileSaving?.position).toEqual({ x: 90, y: 0 });

    expect(finishLocalSave(localPositions, node.id, revision!)).toBe(true);
    const [persisted] = reconcileCanvasNodes([canvasNode(90)], [canvasNode(90)], localPositions);
    expect(persisted?.position).toEqual({ x: 90, y: 0 });
    expect(localPositions.has(node.id)).toBe(false);
  });

  it('prevents an older save acknowledgement from clobbering a newer drag', () => {
    const localPositions = new Map<string, LocalNodePosition>();
    beginLocalDrag(localPositions, node.id, { x: 0, y: 0 });
    updateLocalDrag(localPositions, node.id, { x: 90, y: 0 });
    const firstRevision = prepareLocalSave(localPositions, node.id, { x: 90, y: 0 });
    expect(firstRevision).not.toBeNull();

    beginLocalDrag(localPositions, node.id, { x: 90, y: 0 });
    updateLocalDrag(localPositions, node.id, { x: 210, y: 0 });

    expect(finishLocalSave(localPositions, node.id, firstRevision!)).toBe(false);
    const [afterStaleAcknowledgement] = reconcileCanvasNodes(
      [canvasNode(210, true)],
      [canvasNode(90)],
      localPositions
    );
    expect(afterStaleAcknowledgement?.position).toEqual({ x: 210, y: 0 });
    expect(afterStaleAcknowledgement?.dragging).toBe(true);
  });

  it('never reuses a drag revision after an intervening save finishes', () => {
    const localPositions = new Map<string, LocalNodePosition>();
    beginLocalDrag(localPositions, node.id, { x: 0, y: 0 });
    updateLocalDrag(localPositions, node.id, { x: 90, y: 0 });
    const firstRevision = prepareLocalSave(localPositions, node.id, { x: 90, y: 0 });
    expect(firstRevision).not.toBeNull();

    beginLocalDrag(localPositions, node.id, { x: 90, y: 0 });
    updateLocalDrag(localPositions, node.id, { x: 180, y: 0 });
    const secondRevision = prepareLocalSave(localPositions, node.id, { x: 180, y: 0 });
    expect(secondRevision).not.toBeNull();
    expect(finishLocalSave(localPositions, node.id, secondRevision!)).toBe(true);

    beginLocalDrag(localPositions, node.id, { x: 180, y: 0 });
    expect(finishLocalSave(localPositions, node.id, firstRevision!)).toBe(false);
    expect(localPositions.get(node.id)?.position).toEqual({ x: 180, y: 0 });
  });

  it('releases a drag that ended without moving', () => {
    const localPositions = new Map<string, LocalNodePosition>();
    beginLocalDrag(localPositions, node.id, { x: 90, y: 0 });

    expect(prepareLocalSave(localPositions, node.id, { x: 90, y: 0 })).toBeNull();
    expect(localPositions.has(node.id)).toBe(false);
  });

  it('reconciles a current failed save to the latest authoritative position', () => {
    const localPositions = new Map<string, LocalNodePosition>();
    beginLocalDrag(localPositions, node.id, { x: 90, y: 0 });
    updateLocalDrag(localPositions, node.id, { x: 180, y: 0 });
    const revision = prepareLocalSave(localPositions, node.id, { x: 180, y: 0 });
    expect(revision).not.toBeNull();

    expect(finishLocalSave(localPositions, node.id, revision!)).toBe(true);
    const [reconciled] = reconcileCanvasNodes([canvasNode(180)], [canvasNode(90)], localPositions);
    expect(reconciled?.position).toEqual({ x: 90, y: 0 });
  });

  it('applies authoritative drag positions in one canvas pass', () => {
    const current = [canvasNode(180)];

    expect(
      applyAuthoritativePositions(current, new Map([[node.id, { x: 90, y: 0 }]]))[0]?.position
    ).toEqual({ x: 90, y: 0 });
    expect(applyAuthoritativePositions(current, new Map())).toBe(current);
  });
});
