import {
  ApplicationPreferenceKeySchema,
  resolveEffectiveProjectSettings,
  type ApplicationPreferences,
  type EffectiveProjectSettings
} from '@n2/contracts';
import { queryOptions, skipToken, type QueryClient } from '@tanstack/react-query';
import * as api from './api.js';

const SETTINGS_QUERY_ROOT = ['settings'] as const;
export const APPLICATION_PREFERENCES_QUERY_KEY = [...SETTINGS_QUERY_ROOT, 'application'] as const;
export const PROJECT_SETTINGS_QUERY_KEY = [...SETTINGS_QUERY_ROOT, 'project'] as const;

export const projectSettingsQueryKey = (projectId: string) =>
  [...PROJECT_SETTINGS_QUERY_KEY, projectId] as const;

export const applyApplicationPreferences = (
  project: EffectiveProjectSettings,
  application: ApplicationPreferences
): EffectiveProjectSettings =>
  resolveEffectiveProjectSettings({
    projectId: project.projectId,
    applicationValues: application.values,
    overrides: project.overrides
  });

/*
 * Each view shows its last confirmed settings snapshot (ADR 0019). Settings are never fresh for
 * long, so entering a scope, refocusing the window, or reconnecting refetches them; a failed refresh
 * keeps the last snapshot.
 */

export const applicationPreferencesQueryOptions = queryOptions({
  queryKey: APPLICATION_PREFERENCES_QUERY_KEY,
  queryFn: api.getApplicationPreferences,
  staleTime: 0
});

export const projectSettingsQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: projectSettingsQueryKey(projectId ?? 'unavailable'),
    queryFn: projectId === undefined ? skipToken : () => api.getProjectSettings(projectId),
    staleTime: 0
  });

/*
 * Saves run one at a time from the UI. A read that overlaps a save can answer with the state before
 * it, so overlapping reads are cancelled when the save starts and again when it is acknowledged.
 * The acknowledgment is then stored whole, and refetches, which start after it, reflect it.
 */

// Project settings carry the application values they inherit, so an application save touches all.
export const cancelApplicationReads = (queryClient: QueryClient): Promise<void> =>
  queryClient.cancelQueries({ queryKey: SETTINGS_QUERY_ROOT });

export const cancelProjectReads = (queryClient: QueryClient, projectId: string): Promise<void> =>
  queryClient.cancelQueries({ queryKey: projectSettingsQueryKey(projectId), exact: true });

export async function storeApplicationPreferences(
  queryClient: QueryClient,
  preferences: ApplicationPreferences
): Promise<void> {
  await cancelApplicationReads(queryClient);
  queryClient.setQueryData(APPLICATION_PREFERENCES_QUERY_KEY, preferences);
  queryClient.setQueriesData<EffectiveProjectSettings>(
    { queryKey: PROJECT_SETTINGS_QUERY_KEY },
    (project) => project && applyApplicationPreferences(project, preferences)
  );
  void queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_ROOT });
}

export async function storeProjectSettings(
  queryClient: QueryClient,
  settings: EffectiveProjectSettings
): Promise<void> {
  const queryKey = projectSettingsQueryKey(settings.projectId);
  await cancelProjectReads(queryClient, settings.projectId);
  queryClient.setQueryData(queryKey, settings);
  void queryClient.invalidateQueries({ queryKey, exact: true });
  // The acknowledgment shows the application values it inherited; if they moved on another device,
  // the cached application preferences are behind.
  const application = queryClient.getQueryData<ApplicationPreferences>(
    APPLICATION_PREFERENCES_QUERY_KEY
  );
  const behind = ApplicationPreferenceKeySchema.options.some(
    (key) => application?.values[key] !== settings.applicationValues[key]
  );
  if (application && behind) {
    void queryClient.invalidateQueries({
      queryKey: APPLICATION_PREFERENCES_QUERY_KEY,
      exact: true
    });
  }
}
