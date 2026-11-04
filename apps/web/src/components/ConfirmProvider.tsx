import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmContext, type Confirm, type ConfirmRequest } from '../confirmContext.js';
import { useSuspendNotificationExpiry } from '../notificationContext.js';
import './ConfirmDialog.css';

type OpenRequest = ConfirmRequest & { id: number; resolve: (confirmed: boolean) => void };

/**
 * Owns one session's confirmation dialog. A newer request cancels one that is still open, and
 * unmounting ends the session: an open request resolves false and any later request does too, so
 * a confirmation can never act on a workspace the user has left or stall the writes queued behind it.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<OpenRequest | null>(null);
  // The ref settles each promise exactly once, whichever of click, Escape, or supersession wins.
  const openRequest = useRef<OpenRequest | null>(null);
  const nextId = useRef(0);
  const live = useRef(true);

  const settle = useCallback((confirmed: boolean): void => {
    const current = openRequest.current;
    if (!current) return;
    openRequest.current = null;
    setRequest(null);
    current.resolve(confirmed);
  }, []);

  const confirm = useCallback<Confirm>(
    (next) =>
      new Promise((resolve) => {
        if (!live.current) {
          resolve(false);
          return;
        }
        settle(false);
        nextId.current += 1;
        const opened = { ...next, id: nextId.current, resolve };
        openRequest.current = opened;
        setRequest(opened);
      }),
    [settle]
  );

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      settle(false);
    };
  }, [settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request ? <ConfirmDialog key={request.id} request={request} onSettle={settle} /> : null}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  request: { title, body, confirmLabel, tone = 'default' },
  onSettle
}: {
  request: ConfirmRequest;
  onSettle: (confirmed: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  // The modal dialog sits in the top layer over the toast lane.
  useSuspendNotificationExpiry(true);

  // showModal supplies the focus trap and inert page. Focus starts on the confirming action so
  // Enter confirms, and returns to whatever opened the dialog when it goes away.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return undefined;
    const returnFocus = document.activeElement;
    element.showModal();
    primary.current?.focus();
    return () => {
      if (element.open) element.close();
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={`confirm-dialog confirm-dialog--${tone}`}
      aria-labelledby="confirm-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onSettle(false);
      }}
      // Keys handled here never reach the canvas shortcuts listening on window.
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onSettle(false);
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onSettle(false);
      }}
    >
      <div className="confirm-dialog__panel">
        <h2 id="confirm-dialog-title">{title}</h2>
        <div className="confirm-dialog__body">{body}</div>
        <div className="confirm-dialog__actions">
          <button type="button" onClick={() => onSettle(false)}>
            Cancel
          </button>
          <button
            ref={primary}
            className="confirm-dialog__primary"
            type="button"
            onClick={() => onSettle(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
