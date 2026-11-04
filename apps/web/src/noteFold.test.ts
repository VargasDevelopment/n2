import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NOTE_FOLD_CONTENT_HEIGHT, noteFolds, useNoteExpansion } from './noteFold.js';

describe('noteFolds', () => {
  it('folds long content and shows content that fits, or nearly fits, whole', () => {
    expect(noteFolds(80)).toBe(false);
    expect(noteFolds(NOTE_FOLD_CONTENT_HEIGHT)).toBe(false);
    // A line or two past the fold is not worth hiding behind a control.
    expect(noteFolds(NOTE_FOLD_CONTENT_HEIGHT + 30)).toBe(false);
    expect(noteFolds(NOTE_FOLD_CONTENT_HEIGHT + 60)).toBe(true);
    expect(noteFolds(2_000)).toBe(true);
  });
});

describe('useNoteExpansion', () => {
  const canvas = (...ids: string[]) => ids.map((id) => ({ id }));
  const renderExpansion = () =>
    renderHook(({ nodes }: { nodes: { id: string }[] }) => useNoteExpansion(nodes), {
      initialProps: { nodes: canvas('a', 'b', 'c') }
    });

  it('starts with every Note folded and toggles one Note at a time', () => {
    const { result } = renderExpansion();
    expect(result.current.expansion).toEqual([]);

    act(() => result.current.toggleNoteFold('a'));
    act(() => result.current.toggleNoteFold('b'));
    expect(result.current.expansion).toEqual(['a', 'b']);

    act(() => result.current.toggleNoteFold('a'));
    expect(result.current.expansion).toEqual(['b']);
  });

  it('raises an expanded Note each time it is touched, and expands nothing', () => {
    const { result } = renderExpansion();
    act(() => result.current.toggleNoteFold('a'));
    act(() => result.current.toggleNoteFold('b'));

    act(() => result.current.touchNote('a'));
    expect(result.current.expansion).toEqual(['b', 'a']);
    act(() => result.current.touchNote('b'));
    act(() => result.current.touchNote('a'));
    expect(result.current.expansion).toEqual(['b', 'a']);

    // Touching a folded Note, or the topmost one, changes nothing.
    const before = result.current.expansion;
    act(() => result.current.touchNote('c'));
    act(() => result.current.touchNote('a'));
    expect(result.current.expansion).toBe(before);
  });

  it('forgets a Note once it is deleted', () => {
    const { result, rerender } = renderExpansion();
    act(() => result.current.toggleNoteFold('a'));
    act(() => result.current.toggleNoteFold('b'));

    rerender({ nodes: canvas('b', 'c') });
    expect(result.current.expansion).toEqual(['b']);
  });
});
