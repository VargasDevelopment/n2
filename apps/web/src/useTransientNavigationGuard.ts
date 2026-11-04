import { useCallback, useEffect, useRef } from 'react';

const navigationEventTarget = (): EventTarget | null => {
  const navigation: unknown = Reflect.get(window, 'navigation');
  return navigation instanceof EventTarget ? navigation : null;
};

export const useTransientNavigationGuard = (active: boolean): (() => void) => {
  const allowNextNavigation = useRef(false);

  useEffect(() => {
    allowNextNavigation.current = false;
    if (!active) return;

    const handleNavigate = (event: Event): void => {
      // A reload leaves the document, so beforeunload already asks the person, as it does for the
      // browser's own reload button. Cancelling it here would make an in-app Reload silently fail.
      if ('navigationType' in event && event.navigationType === 'reload') return;
      if (allowNextNavigation.current) {
        allowNextNavigation.current = false;
        return;
      }
      if (event.cancelable) event.preventDefault();
    };
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    const navigation = navigationEventTarget();
    navigation?.addEventListener('navigate', handleNavigate);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      navigation?.removeEventListener('navigate', handleNavigate);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [active]);

  return useCallback(() => {
    if (active) allowNextNavigation.current = true;
  }, [active]);
};
