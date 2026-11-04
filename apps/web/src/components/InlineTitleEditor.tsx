import { useRef, useState } from 'react';
import { useReconciledDraft } from '../useReconciledDraft.js';

export function InlineTitleEditor({
  title,
  onCommit
}: {
  title: string;
  onCommit: (title: string) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const titleDraft = useReconciledDraft(title);
  const cancelEdit = useRef(false);

  // Each edit is submitted once, and only if the person typed; the command queue sends it in order.
  const finishEditing = async (): Promise<void> => {
    const nextTitle = titleDraft.draft.trim();
    setEditing(false);
    const revision = cancelEdit.current || !nextTitle ? null : titleDraft.submit();
    cancelEdit.current = false;
    if (revision === null) {
      titleDraft.reconcile(titleDraft.beginSave(), title);
      return;
    }
    const acceptedTitle = await onCommit(nextTitle);
    titleDraft.reconcile(revision, acceptedTitle ?? title);
  };

  if (editing) {
    return (
      <input
        className="n2-node__title-input nodrag nopan"
        value={titleDraft.draft}
        maxLength={240}
        autoFocus
        aria-label="Node title"
        onFocus={(event) => event.currentTarget.select()}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => titleDraft.edit(event.currentTarget.value)}
        onBlur={() => void finishEditing()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelEdit.current = true;
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="n2-node__title nodrag nopan"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        titleDraft.reconcile(titleDraft.beginSave(), title);
        setEditing(true);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          titleDraft.reconcile(titleDraft.beginSave(), title);
          setEditing(true);
        }
      }}
      title="Double-click to edit"
    >
      {title}
    </button>
  );
}
