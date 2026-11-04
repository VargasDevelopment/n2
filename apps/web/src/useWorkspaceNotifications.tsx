import { useCallback } from 'react';
import { AlsoCompletedGroups, CompletedGroupHeadline } from './components/CompletedGroups.js';
import type { ProjectedGroup } from './useProjectCommands.js';
import { useSessionNotify } from './notificationContext.js';

// One workspace error at a time: a newer failure replaces the older one instead of stacking.
const WORKSPACE_ERROR_KEY = 'workspace-error';

/**
 * The workspace's voice in the shared notification stack: its errors, celebrations and notices.
 * Bound to the workspace session, so a response that lands after the user leaves stays silent.
 */
export const useWorkspaceNotifications = () => {
  const { notify, dismiss } = useSessionNotify();
  // An empty message is the command layer's signal that a later write succeeded.
  const reportError = useCallback(
    (message: string): void => {
      if (message) notify({ key: WORKSPACE_ERROR_KEY, tone: 'danger', message });
      else dismiss(WORKSPACE_ERROR_KEY);
    },
    [dismiss, notify]
  );
  const celebrateGroups = useCallback(
    ([lead, ...others]: readonly ProjectedGroup[]): void => {
      if (!lead) return;
      notify({
        tone: 'celebrate',
        message: <CompletedGroupHeadline group={lead} />,
        ...(others.length > 0 ? { detail: <AlsoCompletedGroups groups={others} /> } : {})
      });
    },
    [notify]
  );
  // Tells the user the app changed something they set, such as clearing filters to show an item.
  const announce = useCallback(
    (message: string): void => void notify({ tone: 'info', message }),
    [notify]
  );

  return { reportError, celebrateGroups, announce };
};
