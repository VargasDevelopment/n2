import { describe, expect, it } from 'vitest';
import { fitToastLane } from './toastLane.js';

describe('fitToastLane', () => {
  it('shows the newest toasts that fit and queues every older one', () => {
    expect(fitToastLane([60, 90, 60, 40], 220, 8)).toEqual({ shown: 2, height: 158 });
  });

  it('always shows the newest toast, even when it alone overflows the lane', () => {
    expect(fitToastLane([300, 40], 200, 8)).toEqual({ shown: 1, height: 300 });
  });

  it('uses no height when nothing shows', () => {
    expect(fitToastLane([], 400, 8)).toEqual({ shown: 0, height: 0 });
  });
});
