import type { ProjectedNode } from '@n2/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  canvasCards,
  presentCanvasNodes,
  toCanvasNodes,
  type N2CanvasNode
} from './canvasNodes.js';
import { KANBAN_NOTE_HEIGHT, resolveCanvasView } from './canvasView.js';
import type { N2NodeActions } from './components/N2Node.js';

const now = '2026-10-20T12:00:00.000Z';
const note: ProjectedNode = {
  id: 'note',
  reference: 'N2-2',
  title: 'Long note',
  content: 'Plenty of context.',
  kind: 'note',
  position: { x: 400, y: 0 },
  version: 0,
  createdAt: now,
  updatedAt: now
};
const task: ProjectedNode = {
  id: 'task',
  reference: 'N2-1',
  title: 'Task',
  description: '',
  kind: 'task',
  requestedStatus: 'ready',
  effectiveStatus: 'ready',
  progress: 0,
  blockedBy: [],
  position: { x: 0, y: 0 },
  version: 0,
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
const otherNote: ProjectedNode = { ...note, id: 'other-note', reference: 'N2-3' };
const graph = { nodes: [task, note, otherNote], relationships: [] };
const canvasNodes = (transformations: ReadonlySet<'kanban'> = new Set()) =>
  toCanvasNodes(resolveCanvasView(graph, transformations), actions, 'horizontal');
const byId = (nodes: readonly N2CanvasNode[], id: string): N2CanvasNode => {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`No canvas node ${id}`);
  return node;
};
const noteFoldOf = (node: N2CanvasNode) =>
  node.type === 'n2' ? node.data.noteFold : 'not a standard card';

describe('Note folding on canvas nodes', () => {
  it('folds a Freeform Note sized by its content, and fits a Structured Note to its slot', () => {
    const freeform = byId(canvasNodes(), note.id);
    const kanban = byId(canvasNodes(new Set(['kanban'])), note.id);

    expect(noteFoldOf(freeform)).toBe('folded');
    expect(freeform.height).toBeUndefined();
    expect(noteFoldOf(kanban)).toBe('slot');
    expect(kanban.height).toBe(KANBAN_NOTE_HEIGHT);
  });

  it('expands a Note and leaves every other card as it was', () => {
    const nodes = canvasNodes();
    const presented = presentCanvasNodes(nodes, new Set([note.id]), [note.id]);

    expect(noteFoldOf(byId(presented, note.id))).toBe('expanded');
    expect(byId(presented, note.id).selected).toBe(true);
    expect(byId(presented, task.id)).toBe(byId(nodes, task.id));
    expect(presentCanvasNodes(nodes, new Set(), [])).toEqual(nodes);
  });

  it('stacks the card touched most recently on top, whatever the selection and expansion', () => {
    const nodes = canvasNodes();
    const ids = [task.id, note.id, otherNote.id];
    const selections = [[], [task.id], [note.id], [otherNote.id], ids];
    const expansions = [[], [note.id], [note.id, otherNote.id], [otherNote.id, note.id]];

    for (const selected of selections) {
      for (const expansion of expansions) {
        const presented = presentCanvasNodes(nodes, new Set(selected), expansion);
        const zIndex = (id: string) => byId(presented, id).zIndex ?? 0;
        // The rule, bottom to top: plain cards, then selected ones, then each expanded Note from
        // the least to the most recently expanded or pressed.
        const resting = ids.filter((id) => !expansion.includes(id));
        const layers = [
          resting.filter((id) => !selected.includes(id)),
          resting.filter((id) => selected.includes(id)),
          ...expansion.map((id) => [id])
        ].filter((layer) => layer.length > 0);

        layers.forEach((layer, index) => {
          for (const below of layers.slice(0, index).flat()) {
            for (const above of layer) expect(zIndex(above)).toBeGreaterThan(zIndex(below));
          }
        });
      }
    }
  });

  it('never expands a Note held in a Structured slot', () => {
    const nodes = canvasNodes(new Set(['kanban']));

    expect(presentCanvasNodes(nodes, new Set(), [note.id])).toEqual(nodes);
  });

  it('gives Group regions the measured height of a Note as it folds and expands', () => {
    const measured = (height: number) =>
      canvasNodes().map((node) =>
        node.id === note.id ? { ...node, measured: { width: 286, height } } : node
      );

    expect(canvasCards(measured(296)).get(note.id)).toMatchObject({ y: 0, height: 296 });
    expect(canvasCards(measured(648)).get(note.id)).toMatchObject({ y: 0, height: 648 });
  });
});
