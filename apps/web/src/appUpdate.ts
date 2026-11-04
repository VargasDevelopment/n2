import { useSyncExternalStore } from 'react';

export type UpdateWatch = {
  /** Reads the build commit a server response named; null when it named none. */
  observe: (serverCommit: string | null) => void;
  subscribe: (listener: () => void) => () => void;
  available: () => boolean;
};

/**
 * Notices when the server runs a different build than this tab. A tab left open across a deploy
 * keeps its old bundle, whose strict response schemas can reject what the new server sends, and
 * only a reload fixes that. Every API response names the server's commit, so the check rides on
 * traffic the tab already makes and needs no polling. A build without a commit on either side (any
 * development build) never reports an update. Once seen, the update stays available: the only way
 * out is a reload.
 */
export const createUpdateWatch = (bundleCommit: string | undefined): UpdateWatch => {
  let available = false;
  const listeners = new Set<() => void>();
  return {
    observe: (serverCommit) => {
      if (available || !bundleCommit || !serverCommit || serverCommit === bundleCommit) return;
      available = true;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    available: () => available
  };
};

export const updateWatch = createUpdateWatch(import.meta.env.N2_BUILD_COMMIT);

export const useUpdateAvailable = (): boolean =>
  useSyncExternalStore(updateWatch.subscribe, updateWatch.available);

/** A plain browser reload, exactly like F5. UpdateBanner calls it only on request. */
export const reloadForUpdate = (): void => window.location.reload();
