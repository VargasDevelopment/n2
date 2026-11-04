import type { ReactNode } from 'react';
import { ConnectionHighlightContext } from '../connectionHighlightContext.js';
import type { ConnectionHighlightController } from '../connectionHighlightDom.js';

export function ConnectionHighlightProvider({
  children,
  controller
}: {
  children: ReactNode;
  controller: ConnectionHighlightController;
}) {
  return (
    <ConnectionHighlightContext.Provider value={controller}>
      {children}
    </ConnectionHighlightContext.Provider>
  );
}
