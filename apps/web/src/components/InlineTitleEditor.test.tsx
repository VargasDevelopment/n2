import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineTitleEditor } from './InlineTitleEditor.js';

afterEach(cleanup);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('InlineTitleEditor', () => {
  it('commits a trimmed title on Enter', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn().mockResolvedValue('Better title');
    render(<InlineTitleEditor title="Original" onCommit={onCommit} />);

    await user.dblClick(screen.getByRole('button', { name: 'Original' }));
    const input = screen.getByRole('textbox', { name: 'Node title' });
    await user.clear(input);
    await user.type(input, '  Better title  {Enter}');

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith('Better title');
  });

  it('restores the title without committing on Escape', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn().mockResolvedValue(null);
    render(<InlineTitleEditor title="Original" onCommit={onCommit} />);

    await user.dblClick(screen.getByRole('button', { name: 'Original' }));
    const input = screen.getByRole('textbox', { name: 'Node title' });
    await user.clear(input);
    await user.type(input, 'Discard me{Escape}');

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Original' })).toBeTruthy();
  });

  it('keeps direct title gestures from opening the node inspector', async () => {
    const user = userEvent.setup();
    const onNodeClick = vi.fn();
    render(
      <div onClick={onNodeClick}>
        <InlineTitleEditor title="Original" onCommit={vi.fn().mockResolvedValue(null)} />
      </div>
    );

    await user.dblClick(screen.getByRole('button', { name: 'Original' }));
    await user.click(screen.getByRole('textbox', { name: 'Node title' }));

    expect(onNodeClick).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Node title' })).toBeTruthy();
  });

  it('reconciles an untouched reopened draft when an in-flight rename completes', async () => {
    const user = userEvent.setup();
    const commit = deferred<string | null>();
    const onCommit = vi.fn().mockReturnValue(commit.promise);
    const view = render(<InlineTitleEditor title="Original" onCommit={onCommit} />);

    await user.dblClick(screen.getByRole('button', { name: 'Original' }));
    const firstInput = screen.getByRole('textbox', { name: 'Node title' });
    await user.clear(firstInput);
    await user.type(firstInput, 'Saved title{Enter}');
    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());

    await user.dblClick(screen.getByRole('button', { name: 'Original' }));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Node title' }).value).toBe(
      'Original'
    );

    await act(async () => {
      commit.resolve('Saved title');
      await commit.promise;
      view.rerender(<InlineTitleEditor title="Saved title" onCommit={onCommit} />);
    });

    const reopenedInput = screen.getByRole<HTMLInputElement>('textbox', { name: 'Node title' });
    expect(reopenedInput.value).toBe('Saved title');
    await user.tab();
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it('preserves newer inline typing when an earlier rename completes', async () => {
    const user = userEvent.setup();
    const commit = deferred<string | null>();
    const onCommit = vi.fn().mockReturnValue(commit.promise);
    const view = render(<InlineTitleEditor title="Original" onCommit={onCommit} />);

    await user.dblClick(screen.getByRole('button', { name: 'Original' }));
    const firstInput = screen.getByRole('textbox', { name: 'Node title' });
    await user.clear(firstInput);
    await user.type(firstInput, 'Saved title{Enter}');
    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());

    await user.dblClick(screen.getByRole('button', { name: 'Original' }));
    const reopenedInput = screen.getByRole<HTMLInputElement>('textbox', { name: 'Node title' });
    await user.clear(reopenedInput);
    await user.type(reopenedInput, 'Newer draft');

    await act(async () => {
      commit.resolve('Saved title');
      await commit.promise;
      view.rerender(<InlineTitleEditor title="Saved title" onCommit={onCommit} />);
    });

    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Node title' }).value).toBe(
      'Newer draft'
    );
  });
});
