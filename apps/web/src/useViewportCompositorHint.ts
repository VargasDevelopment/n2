import { useCallback, useEffect, useRef, useState } from 'react';

export const VIEWPORT_TRANSFORM_SETTLE_MS = 150;

export const useViewportCompositorHint = () => {
  const [isViewportTransforming, setIsViewportTransforming] = useState(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelRelease = useCallback((): void => {
    if (releaseTimer.current === null) return;
    clearTimeout(releaseTimer.current);
    releaseTimer.current = null;
  }, []);

  const beginViewportTransform = useCallback((): void => {
    cancelRelease();
    setIsViewportTransforming(true);
  }, [cancelRelease]);

  const settleViewportTransform = useCallback((): void => {
    cancelRelease();
    releaseTimer.current = setTimeout(() => {
      releaseTimer.current = null;
      setIsViewportTransforming(false);
    }, VIEWPORT_TRANSFORM_SETTLE_MS);
  }, [cancelRelease]);

  useEffect(() => cancelRelease, [cancelRelease]);

  return {
    beginViewportTransform,
    isViewportTransforming,
    settleViewportTransform
  };
};
