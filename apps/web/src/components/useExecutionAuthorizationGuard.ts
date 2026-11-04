import { useCallback, useRef, useState } from 'react';

export type RunExecutionAuthorization = (action: () => Promise<unknown>) => void;

/** Runs one authorization command at a time, and says while one is in flight. */
export function useExecutionAuthorizationGuard(): {
  isExecutionAuthorizationPending: boolean;
  runExecutionAuthorization: RunExecutionAuthorization;
} {
  const inFlightRef = useRef(false);
  const [isExecutionAuthorizationPending, setIsExecutionAuthorizationPending] = useState(false);
  const runExecutionAuthorization = useCallback((action: () => Promise<unknown>): void => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsExecutionAuthorizationPending(true);
    void Promise.resolve()
      .then(action)
      .catch(() => undefined)
      .finally(() => {
        inFlightRef.current = false;
        setIsExecutionAuthorizationPending(false);
      });
  }, []);

  return { isExecutionAuthorizationPending, runExecutionAuthorization };
}
