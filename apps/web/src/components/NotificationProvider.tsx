import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { flushSync } from 'react-dom';
import {
  NotificationContext,
  NotificationExpiryContext,
  type Notification,
  type NotificationAction,
  type NotificationExpiry,
  type Notifier,
  type ToastActionButtonProps
} from '../notificationContext.js';
import { fitToastLane } from '../toastLane.js';
import './Notifications.css';

type ShownNotification = Notification & { id: number; key: string };

// Older notifications are evicted explicitly past this cap. Within it, the lane shows the newest
// that fit and queues the rest, so a queued Undo is delayed, never lost under chrome.
const MAX_KEPT = 4;

// Errors and persistent notices stay until dismissed or superseded, as the canvas error banner
// always did; an action needs long enough to be reached; everything else is a passing remark.
const lifetimeMs = ({ tone, action, persistent }: Notification): number | null =>
  tone === 'danger' || persistent ? null : action ? 10_000 : 6_000;

/** Owns the one on-screen notification stack. Newest first, capped, keyed replacement, fitted. */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<readonly ShownNotification[]>([]);
  const [suspensions, setSuspensions] = useState(0);
  const [fitted, setFitted] = useState(MAX_KEPT);
  const nextId = useRef(0);
  const remove = useCallback(
    (id: number) => setShown((current) => current.filter((entry) => entry.id !== id)),
    []
  );
  const notifier = useMemo<Notifier>(
    () => ({
      notify: (notification) => {
        nextId.current += 1;
        const id = nextId.current;
        const key = notification.key ?? `notification-${id}`;
        setShown((current) =>
          [{ ...notification, id, key }, ...current.filter((entry) => entry.key !== key)].slice(
            0,
            MAX_KEPT
          )
        );
        return key;
      },
      dismiss: (key) => setShown((current) => current.filter((entry) => entry.key !== key))
    }),
    []
  );

  const expiry = useMemo<NotificationExpiry>(
    () => ({
      suspend: () => {
        setSuspensions((count) => count + 1);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          setSuspensions((count) => count - 1);
        };
      }
    }),
    []
  );

  // The lane spans the free region (see Notifications.css). Fitting measures every toast, queued
  // ones included, shows the newest that fit, and publishes their height so document screens can
  // reserve exactly that. It reruns whenever the lane or a toast resizes; flushSync applies the
  // result before the browser paints, so an overflowing stack is never drawn.
  const stack = useRef<HTMLElement>(null);
  const fitLane = useCallback(() => {
    const lane = stack.current;
    if (!lane) return;
    const heights = [...lane.children].map(
      (toast) => parseFloat(getComputedStyle(toast).height) || 0
    );
    const laneStyle = getComputedStyle(lane);
    const { shown, height } = fitToastLane(
      heights,
      parseFloat(laneStyle.height) || 0,
      parseFloat(laneStyle.rowGap) || 0
    );
    // Writing only a changed value keeps a refit from relaying out the page for nothing, which is
    // what can leave a ResizeObserver with undelivered notifications.
    const root = document.documentElement.style;
    const stackHeight = `${height}px`;
    if (root.getPropertyValue('--toast-stack-height') !== stackHeight) {
      root.setProperty('--toast-stack-height', stackHeight);
    }
    setFitted(shown);
  }, []);
  useLayoutEffect(() => {
    const lane = stack.current;
    if (!lane) return undefined;
    const observer = new ResizeObserver(() => flushSync(fitLane));
    observer.observe(lane);
    for (const toast of lane.children) observer.observe(toast);
    fitLane();
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--toast-stack-height');
    };
  }, [fitLane, shown]);

  return (
    <NotificationContext.Provider value={notifier}>
      <NotificationExpiryContext.Provider value={expiry}>
        {children}
        <section ref={stack} className="notifications" aria-label="Notifications">
          {shown.map((notification, index) => (
            <Toast
              key={notification.id}
              notification={notification}
              queued={index > 0 && index >= fitted}
              suspended={suspensions > 0}
              onRemove={remove}
            />
          ))}
        </section>
      </NotificationExpiryContext.Provider>
    </NotificationContext.Provider>
  );
}

function Toast({
  notification,
  queued,
  suspended,
  onRemove
}: {
  notification: ShownNotification;
  /** Laid out but hidden and unreachable until the lane has room; its expiry waits too. */
  queued: boolean;
  suspended: boolean;
  onRemove: (id: number) => void;
}) {
  const { id, tone, message, detail, action } = notification;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const lifetime = lifetimeMs(notification);
  // Never vanish while someone is reading, acting on, or recovering from this notification.
  const held = hovered || focused || pending || failure !== null;
  // Time left before expiry. A hold earns a fresh full lifetime once released; a suspension or
  // a queue only pauses the clock, so the toast resumes with what it had left.
  const remaining = useRef(lifetime ?? 0);

  useEffect(() => {
    if (held && lifetime !== null) remaining.current = lifetime;
  }, [held, lifetime]);

  useEffect(() => {
    if (lifetime === null || held || suspended || queued) return undefined;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onRemove(id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [held, id, lifetime, onRemove, queued, suspended]);

  const runAction = async ({ run }: NotificationAction): Promise<void> => {
    setPending(true);
    setFailure(null);
    try {
      await run();
      onRemove(id);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'That did not work. Try again.');
      setPending(false);
    }
  };

  return (
    <div
      className={`toast toast--${tone}${queued ? ' toast--queued' : ''}`}
      inert={queued}
      role={tone === 'danger' ? 'alert' : 'status'}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {tone === 'celebrate' ? <CompletionMark /> : null}
      <div className="toast__body">
        <ToastText className="toast__message">{message}</ToastText>
        {detail ? <ToastText className="toast__detail">{detail}</ToastText> : null}
        {failure ? (
          <ToastText className="toast__failure" role="alert">
            {failure}
          </ToastText>
        ) : null}
      </div>
      <span className="toast__actions">
        {action ? <ToastAction action={action} pending={pending} onRun={runAction} /> : null}
        <button
          className="toast__dismiss"
          type="button"
          aria-label="Dismiss"
          onClick={() => onRemove(id)}
        >
          ×
        </button>
      </span>
    </div>
  );
}

/**
 * The only way toast text is rendered, and so the only text that clamps (see .toast__text). Its
 * full text is always in a title, whatever markup the caller passes, so clamping never hides it.
 */
function ToastText({
  className,
  role,
  children
}: {
  className: string;
  role?: 'alert';
  children: ReactNode;
}) {
  const text = useRef<HTMLSpanElement>(null);
  // No dependency list: nested content can change on any render, and reading textContent is cheap.
  useLayoutEffect(() => {
    const element = text.current;
    if (element && element.title !== element.textContent) element.title = element.textContent;
  });
  return (
    <span ref={text} className={`toast__text ${className}`} role={role}>
      {children}
    </span>
  );
}

function ToastAction({
  action,
  pending,
  onRun
}: {
  action: NotificationAction;
  pending: boolean;
  onRun: (action: NotificationAction) => Promise<void>;
}) {
  const button: ToastActionButtonProps = {
    label: pending ? action.pendingLabel : action.label,
    pending,
    onRun: () => void onRun(action)
  };
  return action.render ? action.render(button) : <ToastActionButton {...button} />;
}

/** The toast's action button; a custom action render can add its own reasons to disable it. */
export function ToastActionButton({
  label,
  pending,
  onRun,
  disabled = false
}: ToastActionButtonProps & { disabled?: boolean }) {
  return (
    <button className="toast__action" type="button" disabled={pending || disabled} onClick={onRun}>
      {label}
    </button>
  );
}

function CompletionMark() {
  return (
    <svg className="toast__mark" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="toast__mark-ring" cx="12" cy="12" r="10" />
      <path className="toast__mark-check" d="M7.5 12.4l3 3 6-6.6" />
    </svg>
  );
}
