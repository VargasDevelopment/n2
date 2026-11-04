import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How a Project was entered from the Library feed or digest: with its Activity sheet open, or
 * focused on one item as of a response's `sequence`. It belongs to that one navigation and is
 * consumed once read, so neither a workspace remount nor history traversal replays it.
 */
export type ProjectArrival =
  { kind: 'activity' } | { kind: 'item'; nodeId: string; sequence: number };

export type AppLocation =
  { kind: 'project_library' } | { kind: 'project'; projectId: string; arrival?: ProjectArrival };

export const projectPath = (projectId: string): string =>
  `/projects/${encodeURIComponent(projectId)}`;

export const parseAppLocation = (pathname: string): AppLocation => {
  const match = /^\/projects\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return { kind: 'project_library' };
  try {
    const projectId = decodeURIComponent(match[1]).trim();
    return projectId ? { kind: 'project', projectId } : { kind: 'project_library' };
  } catch {
    return { kind: 'project_library' };
  }
};

const HISTORY_INDEX_KEY = '__n2HistoryIndex';

const historyIndex = (state: unknown): number | null => {
  if (typeof state !== 'object' || state === null) return null;
  const index: unknown = Reflect.get(state, HISTORY_INDEX_KEY);
  return Number.isSafeInteger(index) ? (index as number) : null;
};

const indexedHistoryState = (index: number): Record<string, unknown> => {
  const currentState: unknown = window.history.state;
  return {
    ...(typeof currentState === 'object' && currentState !== null ? currentState : {}),
    [HISTORY_INDEX_KEY]: index
  };
};

export const useAppLocation = (blockHistoryTraversal = false) => {
  const currentHistoryIndex = useRef(historyIndex(window.history.state) ?? 0);
  const [navigation, setNavigation] = useState(() => ({
    location: parseAppLocation(window.location.pathname),
    revision: 0
  }));

  useEffect(() => {
    if (historyIndex(window.history.state) === null) {
      window.history.replaceState(
        indexedHistoryState(currentHistoryIndex.current),
        '',
        window.location.href
      );
    }

    const handlePopState = (event: PopStateEvent): void => {
      const nextHistoryIndex = historyIndex(event.state);
      if (
        blockHistoryTraversal &&
        nextHistoryIndex !== null &&
        nextHistoryIndex !== currentHistoryIndex.current
      ) {
        window.history.go(currentHistoryIndex.current - nextHistoryIndex);
        return;
      }
      if (nextHistoryIndex !== null) currentHistoryIndex.current = nextHistoryIndex;
      setNavigation((current) => ({
        location: parseAppLocation(window.location.pathname),
        revision: current.revision + 1
      }));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [blockHistoryTraversal]);

  const navigate = useCallback((pathname: string, arrival?: ProjectArrival): void => {
    if (pathname !== window.location.pathname) {
      currentHistoryIndex.current += 1;
      window.history.pushState(indexedHistoryState(currentHistoryIndex.current), '', pathname);
    }
    const location = parseAppLocation(pathname);
    setNavigation((current) => ({
      location: location.kind === 'project' && arrival ? { ...location, arrival } : location,
      revision: current.revision + 1
    }));
  }, []);

  // Not a navigation: the revision stays, so sessions tied to this entry, like Settings, stay open.
  const consumeArrival = useCallback((): void => {
    setNavigation((current) =>
      current.location.kind === 'project' && current.location.arrival
        ? { ...current, location: { kind: 'project', projectId: current.location.projectId } }
        : current
    );
  }, []);

  return {
    location: navigation.location,
    navigate,
    consumeArrival,
    navigationRevision: navigation.revision
  };
};
