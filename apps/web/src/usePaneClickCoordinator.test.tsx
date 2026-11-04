import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePaneClickCoordinator } from './usePaneClickCoordinator.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('usePaneClickCoordinator', () => {
  it('recreates a usable coordinator after Strict Mode effect replay', async () => {
    const dismiss = vi.fn();
    const user = userEvent.setup();

    function Harness() {
      const coordinator = usePaneClickCoordinator();
      return (
        <button
          type="button"
          onClick={() =>
            coordinator.current?.handle(2, {
              createNode: dismiss,
              dismissSelection: vi.fn(),
              restoreSelection: vi.fn()
            })
          }
        >
          Pane click
        </button>
      );
    }

    render(
      <StrictMode>
        <Harness />
      </StrictMode>
    );

    await user.click(screen.getByRole('button', { name: 'Pane click' }));
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
