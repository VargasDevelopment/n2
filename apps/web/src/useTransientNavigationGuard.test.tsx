import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useTransientNavigationGuard } from './useTransientNavigationGuard.js';

const originalNavigationDescriptor = Object.getOwnPropertyDescriptor(window, 'navigation');

afterEach(() => {
  cleanup();
  if (originalNavigationDescriptor) {
    Object.defineProperty(window, 'navigation', originalNavigationDescriptor);
  } else {
    Reflect.deleteProperty(window, 'navigation');
  }
});

describe('transient navigation guard', () => {
  it('does not carry an inactive bypass into a later guarded session', () => {
    const navigation = new EventTarget();
    Object.defineProperty(window, 'navigation', { configurable: true, value: navigation });
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useTransientNavigationGuard(active),
      { initialProps: { active: false } }
    );

    act(() => result.current());
    rerender({ active: true });
    const firstGuardedNavigation = new Event('navigate', { cancelable: true });
    act(() => {
      navigation.dispatchEvent(firstGuardedNavigation);
    });

    expect(firstGuardedNavigation.defaultPrevented).toBe(true);
  });

  it('blocks cancelable browser navigation and supports one explicit transition', () => {
    const navigation = new EventTarget();
    Object.defineProperty(window, 'navigation', { configurable: true, value: navigation });
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useTransientNavigationGuard(active),
      { initialProps: { active: true } }
    );

    const blocked = new Event('navigate', { cancelable: true });
    act(() => {
      navigation.dispatchEvent(blocked);
    });
    expect(blocked.defaultPrevented).toBe(true);

    act(() => result.current());
    const allowed = new Event('navigate', { cancelable: true });
    act(() => {
      navigation.dispatchEvent(allowed);
    });
    expect(allowed.defaultPrevented).toBe(false);

    const blockedAgain = new Event('navigate', { cancelable: true });
    act(() => {
      navigation.dispatchEvent(blockedAgain);
    });
    expect(blockedAgain.defaultPrevented).toBe(true);

    rerender({ active: false });
    const inactive = new Event('navigate', { cancelable: true });
    act(() => {
      navigation.dispatchEvent(inactive);
    });
    expect(inactive.defaultPrevented).toBe(false);
  });

  it('leaves a reload to the unload prompt instead of silently cancelling it', () => {
    const navigation = new EventTarget();
    Object.defineProperty(window, 'navigation', { configurable: true, value: navigation });
    renderHook(() => useTransientNavigationGuard(true));

    const reload = Object.assign(new Event('navigate', { cancelable: true }), {
      navigationType: 'reload'
    });
    const unload = new Event('beforeunload', { cancelable: true });
    act(() => {
      navigation.dispatchEvent(reload);
      window.dispatchEvent(unload);
    });
    expect(reload.defaultPrevented).toBe(false);
    expect(unload.defaultPrevented).toBe(true);
  });

  it('guards full-page unload even when the Navigation API is unavailable', () => {
    Reflect.deleteProperty(window, 'navigation');
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useTransientNavigationGuard(active),
      { initialProps: { active: true } }
    );

    const blocked = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);

    rerender({ active: false });
    const inactive = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(inactive);
    expect(inactive.defaultPrevented).toBe(false);
  });
});
