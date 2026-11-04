import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReconciledDraft } from '../useReconciledDraft.js';

/**
 * A text draft that saves itself. Each edit is submitted once, to the project command queue that
 * orders saves; unmounting submits an edit not yet submitted, so closing the Inspector or selecting
 * another item never drops one. `persist` resolves to the accepted text, or null when refused.
 */
export function useSavedText(value: string, persist: (draft: string) => Promise<string | null>) {
  const text = useReconciledDraft(value);
  const latest = useRef({ text, persist });

  useEffect(() => {
    latest.current = { text, persist };
  });

  useEffect(
    () => () => {
      const { text: unsaved, persist: send } = latest.current;
      if (unsaved.submit() !== null) void send(unsaved.draft);
    },
    []
  );

  const save = async (): Promise<void> => {
    const revision = text.submit();
    if (revision === null) return;
    const accepted = await persist(text.draft);
    text.reconcile(revision, accepted ?? value);
  };

  return {
    draft: text.draft,
    edit: (next: string) => text.edit(next),
    save,
    /** Drops the draft and shows the saved text again. */
    cancel: () => text.reconcile(text.beginSave(), value)
  };
}

/**
 * Read-first editing: text shows as text until `start`. `stop(true)` hands focus back to the
 * control in `returnTo`, so the next Escape reaches the canvas and closes the panel.
 */
export function useEditMode<Target extends HTMLElement>() {
  const [editing, setEditing] = useState(false);
  const returnTo = useRef<Target>(null);
  const shouldReturnFocus = useRef(false);

  useEffect(() => {
    if (editing || !shouldReturnFocus.current) return;
    shouldReturnFocus.current = false;
    returnTo.current?.focus();
  }, [editing]);

  return {
    editing,
    returnTo,
    start: () => setEditing(true),
    stop: (returnFocus: boolean) => {
      shouldReturnFocus.current = returnFocus;
      setEditing(false);
    }
  };
}

/** Focuses a field once, when it mounts, with the caret after its text. */
export const useFocusAtEnd = () =>
  useCallback((field: HTMLTextAreaElement | null) => {
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

/** Whether an element's content runs past `lines` of its own line height, tracked as it changes. */
export const useRunsPastLines = (
  element: HTMLElement | null,
  lines: number,
  content: string
): boolean => {
  const [runsPast, setRunsPast] = useState(false);
  // A layout effect, so long text is clamped before its first paint rather than flashing whole.
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      setRunsPast(Number.isFinite(lineHeight) && element.scrollHeight > lineHeight * lines);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, lines, content]);
  return runsPast;
};
