import { useState, type MouseEvent } from 'react';
import { useEditMode, useFocusAtEnd, useRunsPastLines, useSavedText } from './inspectorEditing.js';
import { NoteMarkdown } from './NoteMarkdown.js';
import './InspectorText.css';

type TextVariant = 'description' | 'note';

const variants = {
  description: {
    label: 'Description',
    noun: 'description',
    placeholder: "Add the context you'll need when you come back… Markdown is welcome.",
    empty: 'Add a description…'
  },
  note: {
    label: 'Markdown',
    noun: 'note',
    placeholder: 'Capture a thought… Markdown is welcome.',
    empty: 'Capture a thought…'
  }
} satisfies Record<
  TextVariant,
  { label: string; noun: string; placeholder: string; empty: string }
>;

/** Longer descriptions fold to a few lines behind "Show all"; anything shorter shows whole. */
const CLAMP_ABOVE_LINES = 12;

// A click on prose edits it, unless it followed a link or finished selecting text to copy.
const isEditClick = (event: MouseEvent<HTMLElement>): boolean =>
  !(event.target instanceof Element && event.target.closest('a')) &&
  !window.getSelection()?.toString();

function ReadText({
  variant,
  text,
  onEdit
}: {
  variant: TextVariant;
  text: string;
  onEdit: () => void;
}) {
  const [prose, setProse] = useState<HTMLDivElement | null>(null);
  const [showAll, setShowAll] = useState(false);
  const runsLong = useRunsPastLines(prose, CLAMP_ABOVE_LINES, text);
  const clamp = variant === 'description' && runsLong;

  if (!text) {
    return (
      <button type="button" className="inspector__empty" onClick={onEdit}>
        {variants[variant].empty}
      </button>
    );
  }
  return (
    <>
      <div className="inspector__read" onClick={(event) => isEditClick(event) && onEdit()}>
        <NoteMarkdown
          ref={setProse}
          className={`inspector__prose inspector__prose--${variant}${clamp && !showAll ? ' is-clamped' : ''}`}
          content={text}
        />
      </div>
      {clamp ? (
        <button type="button" className="inspector__more" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show less' : 'Show all'}
        </button>
      ) : null}
    </>
  );
}

/**
 * A description or a Note's text: rendered Markdown to read, the source to edit, never both.
 * Click-away saves and keeps editing; Done or Escape saves and goes back to reading.
 */
export function InspectorText({
  variant,
  value,
  persist
}: {
  variant: TextVariant;
  value: string;
  persist: (draft: string) => Promise<string | null>;
}) {
  const text = useSavedText(value, persist);
  const { editing, returnTo, start, stop } = useEditMode<HTMLButtonElement>();
  const focusAtEnd = useFocusAtEnd();
  const { label, noun, placeholder } = variants[variant];
  const finish = (): void => {
    void text.save();
    stop(true);
  };

  const action = editing ? (
    <button
      ref={returnTo}
      type="button"
      className="inspector__action is-on"
      aria-label={`Finish editing ${noun}`}
      onClick={finish}
    >
      Done
    </button>
  ) : (
    <button
      ref={returnTo}
      type="button"
      className="inspector__action"
      aria-label={`Edit ${noun}`}
      onClick={start}
    >
      Edit
    </button>
  );

  return (
    <section className={`inspector__section inspector__text inspector__text--${variant}`}>
      {/* A Note's text needs no heading while read: the paper is the Note. */}
      {variant === 'note' && !editing ? (
        <div className="inspector__float">{action}</div>
      ) : (
        <div className="inspector__section-head">
          <h3 className="inspector__label">{label}</h3>
          {action}
        </div>
      )}
      {editing ? (
        <>
          <textarea
            ref={focusAtEnd}
            className={`inspector__editor inspector__editor--${variant}`}
            aria-label={label}
            value={text.draft}
            maxLength={20_000}
            placeholder={placeholder}
            onChange={(event) => text.edit(event.currentTarget.value)}
            onBlur={() => void text.save()}
            onKeyDown={(event) => {
              // Escape during IME composition cancels the composition, not the edit.
              if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
              event.preventDefault();
              finish();
            }}
          />
          <p className="inspector__hint">
            Saves when you click away. <kbd>Esc</kbd> finishes editing.
          </p>
        </>
      ) : (
        <ReadText variant={variant} text={text.draft} onEdit={start} />
      )}
    </section>
  );
}
