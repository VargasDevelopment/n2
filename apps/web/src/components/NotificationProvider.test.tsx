import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useNotify,
  useSessionNotify,
  useSuspendNotificationExpiry,
  type Notifier,
  type NotificationTone
} from '../notificationContext.js';
import { NotificationProvider } from './NotificationProvider.js';
import notificationsCss from './Notifications.css?raw';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const unbound: Notifier = {
  notify: () => '',
  dismiss: () => undefined
};
let stack = unbound;
let session = unbound;

// Publishers hand their notifier out from an effect, as render must stay pure.
function GlobalPublisher() {
  const notifier = useNotify();
  useEffect(() => {
    stack = notifier;
  }, [notifier]);
  return null;
}

function SessionPublisher() {
  const notifier = useSessionNotify();
  useEffect(() => {
    session = notifier;
  }, [notifier]);
  return null;
}

const renderStack = () =>
  render(
    <NotificationProvider>
      <GlobalPublisher />
      <SessionPublisher />
    </NotificationProvider>
  );

const messages = (): string[] =>
  Array.from(
    screen.getByRole('region', { name: 'Notifications' }).querySelectorAll('.toast__message'),
    (message) => message.textContent
  );

describe('NotificationProvider lifecycle', () => {
  it('lets a passing remark expire but keeps an error until it is dismissed', () => {
    vi.useFakeTimers();
    renderStack();
    act(() => {
      stack.notify({ tone: 'info', message: 'Saved.' });
      stack.notify({ key: 'failure', tone: 'danger', message: 'Write failed.' });
    });

    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(messages()).toEqual(['Write failed.']);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(messages()).toEqual(['Write failed.']);
    act(() => {
      stack.dismiss('failure');
    });
    expect(messages()).toEqual([]);
  });

  it('replaces a still-shown notification that reuses its key', () => {
    renderStack();
    act(() => {
      stack.notify({ key: 'failure', tone: 'danger', message: 'First failure.' });
      stack.notify({ key: 'failure', tone: 'danger', message: 'Second failure.' });
    });

    expect(messages()).toEqual(['Second failure.']);
  });

  it.each([
    ['stack', () => stack],
    ['session', () => session]
  ])('dismisses with the key its %s notifier returned', (_, notifier) => {
    renderStack();
    act(() => {
      const generated = notifier().notify({ tone: 'danger', message: 'Generated.' });
      const given = notifier().notify({ key: 'given', tone: 'danger', message: 'Given.' });
      notifier().dismiss(generated);
      notifier().dismiss(given);
    });

    expect(messages()).toEqual([]);
  });

  it('takes a session’s notifications with it and silences its late publishes', () => {
    const { rerender } = renderStack();
    const ended = session;
    act(() => {
      ended.notify({ key: 'failure', tone: 'danger', message: 'Old workspace failed.' });
      stack.notify({ tone: 'info', message: 'Project archived.' });
    });

    rerender(
      <NotificationProvider>
        <GlobalPublisher />
      </NotificationProvider>
    );
    expect(messages()).toEqual(['Project archived.']);

    act(() => {
      ended.notify({ tone: 'celebrate', message: 'Late celebration.' });
    });
    expect(messages()).toEqual(['Project archived.']);
  });

  it('ignores a dismissal from a session that has ended', () => {
    const { rerender } = renderStack();
    const ended = session;
    rerender(
      <NotificationProvider>
        <GlobalPublisher />
      </NotificationProvider>
    );
    rerender(
      <NotificationProvider>
        <GlobalPublisher />
        <SessionPublisher />
      </NotificationProvider>
    );
    act(() => {
      session.notify({ key: 'failure', tone: 'danger', message: 'New workspace failed.' });
    });

    act(() => {
      ended.dismiss('failure');
    });

    expect(messages()).toEqual(['New workspace failed.']);
  });
});

function Suspender({ active }: { active: boolean }) {
  useSuspendNotificationExpiry(active);
  return null;
}

// Two independent surfaces (say, Settings and a confirm dialog) that can each cover the lane.
const renderSuspendable = (first: boolean, second: boolean) => (
  <NotificationProvider>
    <GlobalPublisher />
    <Suspender active={first} />
    <Suspender active={second} />
  </NotificationProvider>
);

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('NotificationProvider expiry suspension', () => {
  it('pauses expiry while any covering surface is open and resumes with the time left', () => {
    vi.useFakeTimers();
    const view = render(renderSuspendable(false, false));
    act(() => {
      stack.notify({ tone: 'info', message: 'Saved.' });
    });
    advance(4_000);

    view.rerender(renderSuspendable(true, false));
    view.rerender(renderSuspendable(true, true));
    advance(30_000);
    expect(messages()).toEqual(['Saved.']);

    // Closing one surface is not enough: the other still covers the lane.
    view.rerender(renderSuspendable(false, true));
    advance(30_000);
    expect(messages()).toEqual(['Saved.']);

    view.rerender(renderSuspendable(false, false));
    advance(1_999);
    expect(messages()).toEqual(['Saved.']);
    advance(1);
    expect(messages()).toEqual([]);
  });

  it('starts the clock of a toast that arrives while suspended only on resume', () => {
    vi.useFakeTimers();
    const view = render(renderSuspendable(true, false));
    act(() => {
      stack.notify({
        tone: 'info',
        message: 'Archived.',
        action: { label: 'Undo', pendingLabel: 'Undoing…', run: () => Promise.resolve() }
      });
    });
    advance(60_000);
    expect(messages()).toEqual(['Archived.']);

    view.rerender(renderSuspendable(false, false));
    advance(9_999);
    expect(messages()).toEqual(['Archived.']);
    advance(1);
    expect(messages()).toEqual([]);
  });
});

// jsdom has no layout. Fitting sees every toast as 100px tall in a 150px lane, so only the newest
// fits. Returns the real getComputedStyle for reading styles the stylesheet resolves.
const fakeLaneLayout = () => {
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const style = document.createElement('div').style;
    style.height = element.classList.contains('notifications') ? '150px' : '100px';
    style.rowGap = '8px';
    return style;
  });
  return computed;
};

describe('NotificationProvider lane fitting', () => {
  it('queues a toast that no longer fits and resumes its clock once it shows again', () => {
    vi.useFakeTimers();
    fakeLaneLayout();
    renderStack();
    act(() => {
      stack.notify({ tone: 'info', message: 'Older.' });
    });
    advance(1_000);
    act(() => {
      stack.notify({ tone: 'info', message: 'Newer.' });
    });
    const older = screen.getByText('Older.').closest('.toast');
    expect(older?.classList.contains('toast--queued')).toBe(true);
    expect(older?.hasAttribute('inert')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--toast-stack-height')).toBe('100px');

    // Newer expires; Older waited in the queue with 5s of its 6s left.
    advance(6_000);
    expect(messages()).toEqual(['Older.']);
    expect(older?.classList.contains('toast--queued')).toBe(false);
    advance(4_999);
    expect(messages()).toEqual(['Older.']);
    advance(1);
    expect(messages()).toEqual([]);
  });
});

describe('NotificationProvider toast text', () => {
  it('discloses the full text of every clamped line, whatever markup it holds', async () => {
    renderStack();
    act(() => {
      stack.notify({
        tone: 'celebrate',
        message: (
          <>
            <strong>A very long Group title</strong> — complete
          </>
        ),
        detail: (
          <>
            Also complete: <span>Parent Group</span>
          </>
        ),
        action: {
          label: 'Undo',
          pendingLabel: 'Undoing…',
          run: () => Promise.reject(new Error('The local service returned 500.'))
        }
      });
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Undo' }).click();
      await Promise.resolve();
    });

    const lines = Array.from(document.querySelectorAll<HTMLElement>('.toast__text'), (line) => [
      line.textContent,
      line.title
    ]);
    expect(lines).toEqual([
      ['A very long Group title — complete', 'A very long Group title — complete'],
      ['Also complete: Parent Group', 'Also complete: Parent Group'],
      ['The local service returned 500.', 'The local service returned 500.']
    ]);
  });
});

// Every tone, so a new tone cannot skip the layout checks.
const toneMessages: Record<NotificationTone, string> = {
  info: 'Saved.',
  danger: 'Write failed.',
  celebrate: 'Group complete.'
};
const isTone = (value: string): value is NotificationTone => value in toneMessages;
const decoration = /^(color|background(-[a-z]+)*|border(-[a-z]+)*-color|box-shadow|text-shadow)$/;

type Snapshot = Map<string, Map<string, string>>;

type ToastState = 'shown' | 'queued';

const toastLayoutViolations = (
  toast: HTMLElement,
  label: string,
  state: ToastState,
  computed: typeof window.getComputedStyle
): string[] => {
  const violations: string[] = [];
  const box = computed(toast);
  const expected =
    state === 'shown'
      ? { position: 'relative', visibility: 'visible' }
      : { position: 'absolute', visibility: 'hidden', top: '0px', left: '0px', right: '0px' };
  for (const [property, value] of Object.entries(expected)) {
    const actual = box.getPropertyValue(property);
    if (actual !== value) violations.push(`${label}: ${property} is ${actual}, not ${value}`);
  }
  // Clamped text is disclosed in a title, wherever the clamp comes from.
  for (const element of toast.querySelectorAll<HTMLElement>('*')) {
    const clamp = computed(element).getPropertyValue('-webkit-line-clamp');
    if (clamp && clamp !== 'none' && element.title !== element.textContent) {
      violations.push(`${label}: clamped text without its full text in a title`);
    }
  }
  return violations;
};

const snapshotStyles = (toast: HTMLElement, computed: typeof window.getComputedStyle): Snapshot => {
  const snapshot: Snapshot = new Map();
  for (const element of [toast, ...toast.querySelectorAll('*')]) {
    const key = element === toast ? 'toast' : (element.getAttribute('class') ?? element.tagName);
    const style = computed(element);
    snapshot.set(key, new Map(Array.from(style, (name) => [name, style.getPropertyValue(name)])));
  }
  return snapshot;
};

const toneLayoutViolations = (snapshots: ReadonlyMap<string, Snapshot>): string[] => {
  const violations: string[] = [];
  // Tones may differ from the plain info toast in color and decoration only.
  for (const [label, snapshot] of snapshots) {
    const base = snapshots.get(`info ${label.split(' ')[1]}`);
    for (const [key, properties] of snapshot) {
      const baseProperties = base?.get(key);
      if (!baseProperties) continue;
      // jsdom drops the border longhands when a tone sets a color-mix() border-color, so a value
      // that vanishes is jsdom's gap, not a tone's change; a value a tone adds or alters is not.
      for (const [name, value] of properties) {
        if (value !== baseProperties.get(name) && !decoration.test(name)) {
          violations.push(`${label} ${key}: tone sets ${name} to ${value}`);
        }
      }
    }
  }
  return violations;
};

/**
 * Renders an older and a newer toast of each tone under the real stylesheet plus `extraCss`, so the
 * older one queues, and lists every broken layout invariant. jsdom 30 resolves author stylesheets
 * by specificity, source order and !important, so this holds however a rule spells its selector.
 * It does no layout, so geometry stays with the browser matrix.
 */
const layoutViolations = (extraCss = ''): string[] => {
  const sheet = document.createElement('style');
  sheet.textContent = `${notificationsCss}\n${extraCss}`;
  document.head.append(sheet);
  const computed = fakeLaneLayout();
  const violations: string[] = [];
  const snapshots = new Map<string, Snapshot>();
  for (const [tone, message] of Object.entries(toneMessages)) {
    if (!isTone(tone)) continue;
    renderStack();
    act(() => {
      stack.notify({ tone, message: `Older: ${message}`, detail: 'Detail.' });
      stack.notify({ tone, message: `Newer: ${message}`, detail: 'Detail.' });
    });
    const [newer, older] = document.querySelectorAll<HTMLElement>('.notifications > .toast');
    if (!newer || !older?.hasAttribute('inert'))
      violations.push(`${tone}: the older toast did not queue`);
    for (const [state, toast] of [
      ['shown', newer],
      ['queued', older]
    ] as const) {
      if (!toast) continue;
      const label = `${tone} ${state}`;
      violations.push(...toastLayoutViolations(toast, label, state, computed));
      snapshots.set(label, snapshotStyles(toast, computed));
    }
    cleanup();
  }
  violations.push(...toneLayoutViolations(snapshots));
  vi.restoreAllMocks();
  sheet.remove();
  return violations;
};

describe('NotificationProvider toast layout', () => {
  it('keeps queued toasts of every tone out of the flow and unpainted, and tones to color', () => {
    expect(layoutViolations()).toEqual([]);
  });

  it.each([
    [
      'a descendant selector',
      '.notifications > .toast--celebrate { position: relative; visibility: visible }'
    ],
    [
      'a reordered compound selector',
      '.toast--celebrate.toast { position: relative; visibility: visible }'
    ],
    ['an important tone rule', '.toast--danger { position: static !important }'],
    ['a tone that changes layout', '.toast--celebrate { margin-top: 4px }'],
    ['a clamp outside ToastText', '.toast--danger .toast__body { -webkit-line-clamp: 3 }']
  ])('catches %s', (_, evasion) => {
    expect(layoutViolations(evasion)).not.toEqual([]);
  });
});
