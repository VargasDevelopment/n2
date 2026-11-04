import type { SettingsValues } from '@n2/contracts';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useImmediateSettings } from './settingsImmediate.js';

type Intent = {
  kind: 'set';
  key: 'handleOrientation';
  value: SettingsValues['handleOrientation'];
};

function Harness({
  durableValues,
  execute
}: {
  durableValues: SettingsValues;
  execute: (intent: Intent) => Promise<SettingsValues>;
}) {
  const controller = useImmediateSettings({ durableValues, execute });
  return (
    <>
      <output data-testid="preview">
        {controller.previewValues.handleOrientation}:
        {String(controller.previewValues.minimapVisible)}
      </output>
      <button
        type="button"
        onClick={() =>
          void controller.apply({
            kind: 'set',
            key: 'handleOrientation',
            value: 'vertical'
          })
        }
      >
        Change orientation
      </button>
      <button type="button" onClick={() => void controller.retry('handleOrientation')}>
        Retry
      </button>
    </>
  );
}

afterEach(cleanup);

describe('immediate settings controller', () => {
  it('rolls back to the latest durable snapshot and rebases Retry onto it', async () => {
    let rejectFirst: ((cause: Error) => void) | undefined;
    const execute = vi
      .fn<(intent: Intent) => Promise<SettingsValues>>()
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        })
      )
      .mockReturnValueOnce(new Promise(() => undefined));
    const initial: SettingsValues = {
      handleOrientation: 'horizontal',
      minimapVisible: true,
      theme: 'midnight'
    };
    const latest: SettingsValues = {
      handleOrientation: 'horizontal',
      minimapVisible: false,
      theme: 'midnight'
    };
    const { rerender } = render(<Harness durableValues={initial} execute={execute} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Change orientation' }));
    expect(screen.getByTestId('preview').textContent).toBe('vertical:true');
    rerender(<Harness durableValues={latest} execute={execute} />);
    await act(async () => {
      rejectFirst?.(new Error('Old request failed.'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('preview').textContent).toBe('horizontal:false');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByTestId('preview').textContent).toBe('vertical:false');
  });
});
