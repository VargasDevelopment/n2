import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';

export type NotificationTone = 'info' | 'danger' | 'celebrate';

/** What the toast hands an action's button: its current label, whether it runs, and how to run it. */
export type ToastActionButtonProps = { label: string; pending: boolean; onRun: () => void };

/** Settles its notification: success dismisses it, failure is shown inside it for a retry. */
export type NotificationAction = {
  label: string;
  pendingLabel: string;
  run: () => Promise<unknown>;
  /**
   * Renders the button in place of the default, so a toast that outlives its publisher can still
   * render a component that applies the publisher's guard, e.g. disabling it while work is pending.
   */
  render?: (button: ToastActionButtonProps) => ReactNode;
};

export type Notification = {
  /** Notifying again with a key that is still shown replaces it instead of stacking a copy. */
  key?: string;
  tone: NotificationTone;
  message: ReactNode;
  detail?: ReactNode;
  action?: NotificationAction;
  /**
   * Never expires. For a notice about an ongoing state, which its publisher dismisses when the state
   * ends; a timed toast would vanish while the state still holds.
   */
  persistent?: boolean;
};

export type Notifier = {
  /** Returns the key the notification is shown under, generated when none was given. */
  notify: (notification: Notification) => string;
  dismiss: (key: string) => void;
};

export const NotificationContext = createContext<Notifier | null>(null);

/** Pauses every toast's expiry until the returned release runs; releases are idempotent. */
export type NotificationExpiry = { suspend: () => () => void };

export const NotificationExpiryContext = createContext<NotificationExpiry | null>(null);

/**
 * A transient surface that can cover the toast lane (a modal, a dialog, a popover) calls this
 * while it is open, so a toast cannot expire unseen beneath it. Expiry resumes with each toast's
 * remaining time once the last such surface closes. Long-lived panels such as the Inspector do
 * not suspend; the toast lane avoids them instead. Outside a NotificationProvider it does nothing,
 * as there are no toasts to protect.
 */
export const useSuspendNotificationExpiry = (active: boolean): void => {
  const expiry = useContext(NotificationExpiryContext);
  useEffect(() => (active && expiry ? expiry.suspend() : undefined), [active, expiry]);
};

export const useNotify = (): Notifier => {
  const notifier = useContext(NotificationContext);
  if (!notifier) throw new Error('Notifications require a NotificationProvider.');
  return notifier;
};

let sessionCount = 0;

/**
 * A notifier bound to the calling component's mounted lifetime. Work a session starts can settle
 * after the user has left it, so once the session ends its late publishes and dismissals do
 * nothing and what it already showed leaves with it. Keys are namespaced per session, so one
 * session can never replace or dismiss another's notifications. The namespace stays internal:
 * callers see only their own keys, so dismiss(notify(...)) round-trips exactly as with useNotify.
 */
export const useSessionNotify = (): Notifier => {
  const { notify, dismiss } = useNotify();
  const [prefix] = useState(() => `session-${(sessionCount += 1)}`);
  const live = useRef(true);
  const shown = useRef(new Set<string>());

  useEffect(() => {
    const published = shown.current;
    live.current = true;
    return () => {
      live.current = false;
      published.forEach(dismiss);
      published.clear();
    };
  }, [dismiss]);

  return useMemo<Notifier>(
    () => ({
      notify: (notification) => {
        const ownKey = notification.key ?? crypto.randomUUID();
        if (!live.current) return ownKey;
        const sessionKey = `${prefix}:${ownKey}`;
        shown.current.add(sessionKey);
        notify({ ...notification, key: sessionKey });
        return ownKey;
      },
      dismiss: (key) => {
        if (!live.current) return;
        const sessionKey = `${prefix}:${key}`;
        shown.current.delete(sessionKey);
        dismiss(sessionKey);
      }
    }),
    [dismiss, notify, prefix]
  );
};
