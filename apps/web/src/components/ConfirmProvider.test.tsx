import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConfirm } from '../confirmContext.js';
import { ConfirmProvider } from './ConfirmProvider.js';

afterEach(cleanup);

function Trigger() {
  const confirm = useConfirm();
  const [answer, setAnswer] = useState('none');
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void confirm({
            title: 'Delete task?',
            body: 'This can’t be undone.',
            confirmLabel: 'Delete task',
            tone: 'destructive'
          }).then((confirmed) => setAnswer(String(confirmed)))
        }
      >
        Delete
      </button>
      <output>{answer}</output>
    </>
  );
}

const renderTrigger = async () => {
  render(
    <ConfirmProvider>
      <Trigger />
    </ConfirmProvider>
  );
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name: 'Delete' });
  await user.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Delete task?' });
  return { dialog, trigger, user };
};

describe('ConfirmProvider', () => {
  it('starts on the confirming action so Enter confirms, then returns focus', async () => {
    const { dialog, trigger, user } = await renderTrigger();
    expect(dialog.className).toContain('confirm-dialog--destructive');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete task' }));

    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('true'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('cancels on Escape without the key reaching window shortcuts', async () => {
    const windowShortcut = vi.fn();
    window.addEventListener('keydown', windowShortcut);
    const { user } = await renderTrigger();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('false'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(windowShortcut).not.toHaveBeenCalled();
    window.removeEventListener('keydown', windowShortcut);
  });

  it('ends its session on unmount: open and later requests both resolve false', async () => {
    const { result, unmount } = renderHook(useConfirm, { wrapper: ConfirmProvider });
    const confirm = result.current;
    const request = { title: 'Delete task?', body: 'Gone.', confirmLabel: 'Delete task' };
    let open: Promise<boolean> = Promise.resolve(true);
    act(() => {
      open = confirm(request);
    });
    expect(screen.getByRole('dialog', { name: 'Delete task?' })).toBeTruthy();

    unmount();

    await expect(open).resolves.toBe(false);
    await expect(confirm(request)).resolves.toBe(false);
  });
});
