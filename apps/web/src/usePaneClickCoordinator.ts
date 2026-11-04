import { useEffect, useRef, type RefObject } from 'react';
import { createPaneClickCoordinator, type PaneClickCoordinator } from './graphInteraction.js';

export const usePaneClickCoordinator = (): RefObject<PaneClickCoordinator | null> => {
  const coordinatorRef = useRef<PaneClickCoordinator | null>(null);

  useEffect(() => {
    const coordinator = createPaneClickCoordinator();
    coordinatorRef.current = coordinator;

    return () => {
      coordinator.dispose();
      if (coordinatorRef.current === coordinator) coordinatorRef.current = null;
    };
  }, []);

  return coordinatorRef;
};
