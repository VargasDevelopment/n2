import type { ProjectedNote } from '@n2/contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTE_FOLD_CONTENT_HEIGHT, type NoteFold } from '../noteFold.js';
import type { N2NodeActions } from './NodeControls.js';
import { NoteCard } from './NoteCard.js';

const now = '2026-10-20T12:00:00.000Z';
const note: ProjectedNote = {
  id: 'note',
  reference: 'N2-2',
  title: 'Field notes',
  content: 'Long enough to fold.',
  kind: 'note',
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

// jsdom has no layout: the Note text reports whatever height the test gives it, and the observer
// lets a test announce that the text resized, as an edit in the Inspector would.
let textHeight = 0;
let announceResize = (): void => undefined;
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return this.classList.contains('n2-note__text') ? textHeight : 0;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        announceResize = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const renderNote = (noteFold: NoteFold, height: number, content = note.content) => {
  textHeight = height;
  const onCardClick = vi.fn();
  const card = (fold: NoteFold, edited: string) => (
    <div onClick={onCardClick}>
      <NoteCard
        actions={actions}
        networkHighlightRef={null}
        node={{ ...note, content: edited }}
        noteFold={fold}
        selected={false}
      />
    </div>
  );
  const { rerender } = render(card(noteFold, content));
  return {
    onCardClick,
    /** Renders the Note again, folded or expanded, and with its content edited if given. */
    rerenderAs: (fold: NoteFold, edited = content) => rerender(card(fold, edited)),
    content: () => screen.getByText(note.content).closest('.n2-note__content')
  };
};

describe('NoteCard folding', () => {
  it('folds a long Note to a bounded height with an Expand control', () => {
    const { content, onCardClick } = renderNote('folded', 600);

    expect(screen.getByRole('article').getAttribute('data-note-fold')).toBe('folded');
    expect(content()?.getAttribute('style')).toContain(`max-height: ${NOTE_FOLD_CONTENT_HEIGHT}px`);
    const expand = screen.getByRole('button', { name: 'Expand Field notes' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(expand);
    expect(actions.toggleNoteFold).toHaveBeenCalledWith(note.id);
    // Reading in place is not a selection, so the click never reaches the card.
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('touches the Note at every press on it, controls included', () => {
    renderNote('expanded', 600);

    fireEvent.pointerDown(screen.getByText(note.content));
    fireEvent.pointerDown(screen.getByRole('button', { name: note.title }));

    expect(actions.touchNote).toHaveBeenCalledTimes(2);
    expect(actions.touchNote).toHaveBeenCalledWith(note.id);
  });

  it('keeps one control element across folding and expanding, so it keeps focus', () => {
    const { rerenderAs } = renderNote('folded', 600);
    const expand = screen.getByRole('button', { name: 'Expand Field notes' });

    rerenderAs('expanded');

    expect(screen.getByRole('button', { name: 'Fold Field notes' })).toBe(expand);
  });

  it('shows an expanded Note whole, with a control to fold it again', () => {
    const { content } = renderNote('expanded', 600);

    expect(content()?.hasAttribute('style')).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Fold Field notes' }).getAttribute('aria-expanded')
    ).toBe('true');
  });

  it('shows a short Note whole, without a cue or control', () => {
    renderNote('folded', 80);

    expect(screen.getByRole('article').hasAttribute('data-note-fold')).toBe(false);
    expect(screen.queryByRole('button', { name: /Expand|Fold/ })).toBeNull();
  });

  it('leaves a Note in a Structured slot to its slot', () => {
    renderNote('slot', 600);

    expect(screen.getByRole('article').hasAttribute('data-note-fold')).toBe(false);
    expect(screen.queryByRole('button', { name: /Expand|Fold/ })).toBeNull();
  });

  it.each([
    ['short', 'Brief.'],
    ['empty', '']
  ])('keeps Fold on an expanded Note an edit makes %s, so it can fold again', (_, edited) => {
    const { rerenderAs } = renderNote('expanded', 600);

    textHeight = 80;
    rerenderAs('expanded', edited);
    act(() => announceResize());
    fireEvent.click(screen.getByRole('button', { name: 'Fold Field notes' }));
    expect(actions.toggleNoteFold).toHaveBeenCalledWith(note.id);

    // Folded again, it is short enough to show whole.
    rerenderAs('folded', edited);
    expect(screen.getByRole('article').hasAttribute('data-note-fold')).toBe(false);
    expect(screen.queryByRole('button', { name: /Expand|Fold/ })).toBeNull();
  });

  it('drops the control once an edit makes a folded Note short enough to fit', () => {
    renderNote('folded', 600);
    expect(screen.getByRole('button', { name: 'Expand Field notes' })).toBeTruthy();

    textHeight = 80;
    act(() => announceResize());

    expect(screen.queryByRole('button', { name: 'Expand Field notes' })).toBeNull();
  });
});
