import { useCallback, useState } from 'react';

/**
 * How a Note card sizes its content. A Freeform Note sizes to its content, so a long one folds to
 * a bounded height until it is expanded; a Structured view gives every Note a fixed slot instead.
 */
export type NoteFold = 'folded' | 'expanded' | 'slot';

/**
 * A folded Note's content height in flow pixels: about eight lines, so the card stays near the
 * height of two Task cards.
 */
export const NOTE_FOLD_CONTENT_HEIGHT = 168;

/** Content this little past the fold shows whole: hiding a line or two saves nothing. */
const NOTE_FOLD_SLACK = 40;

/** Whether content of this natural height is long enough to fold. */
export const noteFolds = (contentHeight: number): boolean =>
  contentHeight > NOTE_FOLD_CONTENT_HEIGHT + NOTE_FOLD_SLACK;

/** The expanded Notes, least recently touched first, so the last draws on top of the rest. */
export type NoteExpansion = readonly string[];

export type NoteExpansionControls = {
  expansion: NoteExpansion;
  toggleNoteFold: (noteId: string) => void;
  /** A press on a Note: an expanded one rises over the other expanded Notes. */
  touchNote: (noteId: string) => void;
};

/**
 * The Notes expanded on this canvas. Expansion is Canvas view state: a reading choice that never
 * becomes a Project Command and lasts while the Project is open, so every Note opens folded.
 * Expanding a Note or pressing on it touches it, which raises it over the other expanded Notes.
 * Folded Notes and Notes deleted from the Project drop out. It follows the Project's own nodes,
 * never a filtered view, so a Note a search hides is still expanded once the search clears.
 */
export const useNoteExpansion = (
  /** Undefined while the Project loads: nothing is known to be deleted yet. */
  projectNodes: readonly { readonly id: string }[] | undefined
): NoteExpansionControls => {
  const [expansion, setExpansion] = useState<NoteExpansion>([]);
  // Forgets deleted Notes while rendering, as React advises for state derived from props, so a
  // deleted Note never lingers for a frame.
  const inProject = (id: string): boolean => projectNodes?.some((node) => node.id === id) ?? true;
  const current = expansion.every(inProject) ? expansion : expansion.filter(inProject);
  if (current !== expansion) setExpansion(current);

  const toggleNoteFold = useCallback((noteId: string): void => {
    setExpansion((ids) =>
      ids.includes(noteId) ? ids.filter((id) => id !== noteId) : [...ids, noteId]
    );
  }, []);
  const touchNote = useCallback((noteId: string): void => {
    // Kept as it is unless the Note moves, so pressing a folded or topmost Note renders nothing.
    setExpansion((ids) =>
      ids.includes(noteId) && ids.at(-1) !== noteId
        ? [...ids.filter((id) => id !== noteId), noteId]
        : ids
    );
  }, []);
  return { expansion: current, toggleNoteFold, touchNote };
};
