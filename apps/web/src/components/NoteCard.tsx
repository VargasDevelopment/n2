import type { ProjectedNote } from '@n2/contracts';
import { useLayoutEffect, useState, type Ref } from 'react';
import { NOTE_FOLD_CONTENT_HEIGHT, noteFolds, type NoteFold } from '../noteFold.js';
import { InlineTitleEditor } from './InlineTitleEditor.js';
import { DeleteButton, type N2NodeActions } from './NodeControls.js';
import { NoteMarkdown } from './NoteMarkdown.js';

/**
 * The laid-out height of an element, tracked as it changes. offsetHeight is in layout pixels, so
 * the canvas zoom (a transform) never changes it.
 */
const useLayoutHeight = (element: HTMLElement | null): number | null => {
  const [height, setHeight] = useState<number | null>(null);
  // A layout effect, so a long Note is folded before its first paint rather than flashing whole.
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => setHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return element ? height : null;
};

function FoldToggle({
  fold,
  note,
  onToggle
}: {
  fold: Exclude<NoteFold, 'slot'>;
  note: ProjectedNote;
  onToggle: () => void;
}) {
  const verb = fold === 'folded' ? 'Expand' : 'Fold';
  return (
    // nokey: Enter and Space press this button without also selecting the card around it.
    <button
      type="button"
      className="n2-note__fold nodrag nopan nokey"
      aria-expanded={fold === 'expanded'}
      aria-label={`${verb} ${note.title}`}
      onClick={(event) => {
        // Expanding is for reading in place; it neither selects the Note nor opens the Inspector.
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg className="n2-note__fold-chevron" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2 3.5 5 6.5 8 3.5" />
      </svg>
      {verb}
    </button>
  );
}

/**
 * A Note on the canvas. In Freeform a long Note folds to a bounded height with a fade and an Expand
 * control under the fade; expanded, it shows whole with Fold in its header, even once an edit makes
 * it short. Other short Notes show whole.
 * Structured views fit every Note to a fixed slot instead. The Inspector always shows the full
 * content.
 */
export function NoteCard({
  actions,
  networkHighlightRef,
  node,
  noteFold,
  selected
}: {
  actions: N2NodeActions;
  networkHighlightRef: Ref<HTMLElement>;
  node: ProjectedNote;
  noteFold: NoteFold;
  selected: boolean;
}) {
  const [text, setText] = useState<HTMLDivElement | null>(null);
  const textHeight = useLayoutHeight(text);
  // An expanded Note keeps Fold whatever its height: expanding raised it over other cards, and Fold
  // is its only way back down. Only a Note that overflows offers Expand.
  const overflows = textHeight !== null && noteFolds(textHeight);
  const fold = noteFold === 'expanded' || (noteFold === 'folded' && overflows) ? noteFold : null;
  return (
    <article
      ref={networkHighlightRef}
      className={`n2-note ${selected ? 'n2-note--selected' : ''}`}
      data-network-node-id={node.id}
      data-note-fold={fold ?? undefined}
      // Captured, so a press anywhere in the Note counts, even on a control that keeps its own.
      onPointerDownCapture={() => actions.touchNote(node.id)}
    >
      <div className="n2-note__eyebrow">
        <span aria-hidden="true">✦</span>
        Note <span className="n2-note__reference">· {node.reference}</span>
      </div>
      <InlineTitleEditor
        title={node.title}
        onCommit={async (title) => (await actions.rename(node, title))?.title ?? null}
      />
      {node.content ? (
        <div
          className="n2-note__content"
          style={fold === 'folded' ? { maxHeight: NOTE_FOLD_CONTENT_HEIGHT } : undefined}
        >
          <NoteMarkdown ref={setText} className="n2-note__text" content={node.content} />
        </div>
      ) : (
        <div className="n2-note__content n2-note__content--empty">
          Add a thought in the inspector…
        </div>
      )}
      {/* One element in both states, placed by the stylesheet, so it keeps focus as it moves. */}
      {fold ? (
        <FoldToggle fold={fold} note={node} onToggle={() => actions.toggleNoteFold(node.id)} />
      ) : null}
      <DeleteButton actions={actions} node={node} selected={selected} />
    </article>
  );
}
