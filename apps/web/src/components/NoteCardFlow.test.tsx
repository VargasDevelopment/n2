import type { ProjectedNode } from '@n2/contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReactFlow, type NodeChange } from '@xyflow/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { presentCanvasNodes, type N2CanvasNode } from '../canvasNodes.js';
import { createConnectionHighlightController } from '../connectionHighlightDom.js';
import { useNoteExpansion } from '../noteFold.js';
import { ConnectionHighlightProvider } from './ConnectionHighlightProvider.js';
import { N2Node } from './N2Node.js';
import type { N2NodeActions } from './NodeControls.js';

// One live canvas: the real React Flow (its drag on d3-drag and its click and key selection), the
// production card renderer, and the real expansion and stacking state.
const now = '2026-10-20T12:00:00.000Z';
const makeNote = (id: string, title: string, content = `${title}, long enough to fold.`) =>
  ({
    id,
    reference: `N2-${id}`,
    title,
    content,
    kind: 'note',
    position: { x: 0, y: 0 },
    version: 0,
    createdAt: now,
    updatedAt: now
  }) satisfies ProjectedNode;
const makeTask = (id: string, title: string) =>
  ({
    id,
    reference: `N2-${id}`,
    title,
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
  }) satisfies ProjectedNode;
const inertActions: Omit<N2NodeActions, 'toggleNoteFold' | 'touchNote'> = {
  cycleStatus: vi.fn(),
  deleteNode: vi.fn(),
  rename: vi.fn()
};

// jsdom has no layout: every element is as tall as the test says, at first tall enough that every
// Note folds. The observer lets a test announce that a Note's text resized, as an edit would.
let height = 600;
const noteTextResized = new Set<() => void>();
beforeEach(() => {
  height = 600;
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {}
      observe(element: Element) {
        if (element.classList.contains('n2-note__text')) noteTextResized.add(this.callback);
      }
      unobserve() {}
      disconnect() {
        noteTextResized.delete(this.callback);
      }
    }
  );
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // d3-drag swallows the click after a drag until a zero-delay timer; let it lapse between tests.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

function Canvas({
  cards,
  initiallySelected,
  onChanges
}: {
  cards: readonly ProjectedNode[];
  initiallySelected: readonly string[];
  onChanges: (changes: NodeChange<N2CanvasNode>[]) => void;
}) {
  const { expansion, toggleNoteFold, touchNote } = useNoteExpansion(cards);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(initiallySelected));
  const actions = { ...inertActions, toggleNoteFold, touchNote };
  const nodes = cards.map((node, index): N2CanvasNode => ({
    id: node.id,
    type: 'n2',
    position: { x: index * 120, y: 0 },
    // Sized up front: jsdom never measures, and React Flow hides an unmeasured node.
    width: 286,
    height: 400,
    data: { actions, handleOrientation: 'horizontal', node, noteFold: 'folded' }
  }));
  return (
    <ReactFlow
      nodes={presentCanvasNodes(nodes, selected, expansion)}
      nodeTypes={{ n2: N2Node }}
      elevateNodesOnSelect={false}
      onNodesChange={(changes) => {
        onChanges(changes);
        setSelected((current) => {
          const next = new Set(current);
          for (const change of changes) {
            if (change.type !== 'select') continue;
            if (change.selected) next.add(change.id);
            else next.delete(change.id);
          }
          return next;
        });
      }}
    />
  );
}

const renderCanvas = (cards: readonly ProjectedNode[], initiallySelected: string[] = []) => {
  const changes: NodeChange<N2CanvasNode>[] = [];
  const controller = createConnectionHighlightController();
  const canvas = (current: readonly ProjectedNode[]) => (
    <ConnectionHighlightProvider controller={controller}>
      <div style={{ width: 800, height: 600 }}>
        <Canvas
          cards={current}
          initiallySelected={initiallySelected}
          onChanges={(next) => changes.push(...next)}
        />
      </div>
    </ConnectionHighlightProvider>
  );
  const { rerender } = render(canvas(cards));
  const card = (id: string) => document.querySelector<HTMLElement>(`[data-id="${id}"]`);
  return {
    /** Shows the cards as edited, as a Project update would. */
    edit: (edited: readonly ProjectedNode[]) => rerender(canvas(edited)),
    /** What React Flow reported, sizes aside: selections and moves. */
    changes: () => changes.flatMap(({ type }) => (type === 'dimensions' ? [] : [type])),
    fold: (id: string) => card(id)?.querySelector('.n2-note')?.getAttribute('data-note-fold'),
    layer: (id: string) => Number(card(id)?.style.zIndex),
    selected: () =>
      [...document.querySelectorAll('.react-flow__node.selected')].map((node) =>
        node.getAttribute('data-id')
      )
  };
};

/**
 * One mouse press as a browser sends it, sliding right while held. jsdom has no PointerEvent, and
 * under Vitest refuses `view` (which d3-drag follows a press through) in the constructor, so it is
 * set afterwards.
 */
const press = (target: Element, slide = 0): void => {
  const send = (type: string, x: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: 100
    });
    Object.defineProperty(event, 'view', { value: window });
    fireEvent(target, event);
  };
  send('pointerdown', 100);
  send('mousedown', 100);
  // Two moves: the first passes the drag threshold, the second moves the Note.
  for (const step of slide === 0 ? [] : [slide / 2, slide]) send('mousemove', 100 + step);
  send('pointerup', 100 + slide);
  send('mouseup', 100 + slide);
  send('click', 100 + slide);
};
const control = (name: string) => screen.getByRole('button', { name });
const note = makeNote('note', 'Field notes');
const otherTask = makeTask('task', 'Other task');

describe('the fold control on the canvas', () => {
  it('folds and expands its Note without selecting or moving it, even pressed with a slide', () => {
    const canvas = renderCanvas([note, otherTask], [otherTask.id]);

    press(control('Expand Field notes'), 4);
    expect(canvas.fold(note.id)).toBe('expanded');
    press(control('Fold Field notes'), 4);
    expect(canvas.fold(note.id)).toBe('folded');

    expect(canvas.changes()).toEqual([]);
    expect(canvas.selected()).toEqual([otherTask.id]);
  });

  it('keeps Space to the control, which the browser then clicks, rather than selecting the card', () => {
    const canvas = renderCanvas([note, otherTask], [otherTask.id]);
    const expand = control('Expand Field notes');

    expand.focus();
    fireEvent.keyDown(expand, { key: ' ' });
    fireEvent.keyUp(expand, { key: ' ' });
    fireEvent.click(expand, { detail: 0 });

    expect(canvas.fold(note.id)).toBe('expanded');
    expect(canvas.changes()).toEqual([]);
    expect(canvas.selected()).toEqual([otherTask.id]);
  });
});

describe('a Note on the canvas', () => {
  it.each(['folded', 'expanded'])('selects and drags as any card does when %s', (fold) => {
    const canvas = renderCanvas([note, otherTask], [otherTask.id]);
    if (fold === 'expanded') press(control('Expand Field notes'));
    expect(canvas.fold(note.id)).toBe(fold);

    press(screen.getByText(note.content), 4);

    // Selects the Note, unselecting the other task, then moves it.
    expect(canvas.changes()).toEqual(['select', 'select', 'position', 'position']);
  });

  it.each([
    ['short', 'Brief.'],
    ['empty', '']
  ])('drops back under a selected card once folded after an edit makes it %s', (_, content) => {
    const canvas = renderCanvas([note, otherTask], [otherTask.id]);
    press(control('Expand Field notes'));
    expect(canvas.layer(note.id)).toBeGreaterThan(canvas.layer(otherTask.id));

    height = 80;
    canvas.edit([{ ...note, content }, otherTask]);
    act(() => noteTextResized.forEach((resized) => resized()));
    press(control('Fold Field notes'));

    expect(canvas.fold(note.id)).toBeNull();
    expect(canvas.layer(otherTask.id)).toBeGreaterThan(canvas.layer(note.id));
  });

  it('raises an expanded Note that is pressed while already selected', () => {
    const [a, b] = [makeNote('a', 'Upper A'), makeNote('b', 'Lower B')];
    const canvas = renderCanvas([a, b]);

    press(control('Expand Upper A'));
    press(screen.getByText(a.content));
    press(control('Expand Lower B'));
    expect(canvas.layer(b.id)).toBeGreaterThan(canvas.layer(a.id));

    press(screen.getByText(a.content));
    expect(canvas.selected()).toEqual([a.id]);
    expect(canvas.layer(a.id)).toBeGreaterThan(canvas.layer(b.id));
  });
});
