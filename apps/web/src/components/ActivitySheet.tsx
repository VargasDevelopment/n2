import type { ActivityRun } from '@n2/contracts';
import { useEffect, useRef, type ReactNode } from 'react';
import './ActivityPanel.css';

type ActivitySheetProps<Run extends ActivityRun> = {
  /** The sheet's accessible name, which its eyebrow repeats. */
  label: string;
  /** What the sheet has loaded, or a reading notice before it has. */
  summary: string;
  /** Undefined until the first response, so the empty state never flashes while reading. */
  runs: readonly Run[] | undefined;
  hasEarlier: boolean;
  emptyHint: string;
  renderRun: (run: Run) => ReactNode;
  onClose: () => void;
};

/**
 * The Activity sheet's chrome and sections, shared by a Project's feed and the Library's: new runs
 * under their divider, then earlier context. The server decides what is new; the sheet never
 * works it out again.
 */
export function ActivitySheet<Run extends ActivityRun>({
  label,
  summary,
  runs,
  hasEarlier,
  emptyHint,
  renderRun,
  onClose
}: ActivitySheetProps<Run>) {
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // Opening moves focus into the sheet, so the first Escape closes it rather than the selection
  // behind it; closing hands focus back to whatever opened it, unless focus has moved on.
  useEffect(() => {
    const opener = document.activeElement;
    const sheet = panel.current;
    heading.current?.focus();
    return () => {
      const focus = document.activeElement;
      const focusLeft = focus === null || focus === document.body || sheet?.contains(focus);
      if (focusLeft && opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  const newRuns = runs?.filter(({ unseen }) => unseen) ?? [];
  const earlierRuns = runs?.filter(({ unseen }) => !unseen) ?? [];
  return (
    <aside
      ref={panel}
      className="activity-panel"
      aria-label={label}
      onKeyDown={(event) => {
        // Escape inside the sheet closes the sheet, not the canvas selection behind it.
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="activity-panel__header">
        <div>
          <span className="activity-panel__eyebrow">{label}</span>
          <h2 ref={heading} tabIndex={-1}>
            What changed
          </h2>
          <p>{summary}</p>
        </div>
        <button
          className="activity-panel__close"
          type="button"
          aria-label="Close activity"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="activity-panel__body">
        {runs?.length === 0 ? (
          <div className="activity-panel__empty">
            <span className="activity-panel__empty-mark" aria-hidden="true" />
            <strong>Nothing has changed yet</strong>
            <span>{emptyHint}</span>
          </div>
        ) : null}
        {newRuns.length > 0 ? (
          <h3 className="activity-panel__divider activity-panel__divider--new">
            New since you last looked
          </h3>
        ) : null}
        {newRuns.map(renderRun)}
        {runs && runs.length > 0 && newRuns.length === 0 ? (
          <p className="activity-panel__caught-up">You’re caught up.</p>
        ) : null}
        {earlierRuns.length > 0 ? <h3 className="activity-panel__divider">Earlier</h3> : null}
        {earlierRuns.map(renderRun)}
        {hasEarlier ? (
          <p className="activity-panel__older">Older activity is kept but not listed here.</p>
        ) : null}
      </div>
      {newRuns.length > 0 ? (
        <footer className="activity-panel__footer">Closing this marks it as seen.</footer>
      ) : null}
    </aside>
  );
}
