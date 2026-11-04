import type {
  ApplicationPreferenceInput,
  ApplicationPreferenceKey,
  ApplicationPreferences,
  ApplicationPreferenceValues,
  EffectiveProjectSettings,
  HandleOrientation,
  ProjectSettingInput,
  ProjectSettingKey,
  SettingsValues,
  Theme
} from '@n2/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import { queryView } from '../queryView.js';
import { useImmediateSettings } from '../settingsImmediate.js';
import {
  applicationPreferencesQueryOptions,
  projectSettingsQueryOptions,
  cancelApplicationReads,
  cancelProjectReads,
  storeApplicationPreferences,
  storeProjectSettings
} from '../settingsQueries.js';
import { RefreshWarning } from './RefreshWarning.js';
import { SettingsFeedback, SettingsFields } from './SettingsControls.js';
import { ThemeField } from './ThemeField.js';
import { themeLabel } from '../theme.js';
import { SettingsPreview } from './SettingsPreview.js';
import { useSuspendNotificationExpiry } from '../notificationContext.js';
import './SettingsModal.css';

type SettingsScope = 'application' | 'project';

type ResetIntent<Kind extends string, Key extends ApplicationPreferenceKey> = {
  [Setting in Key]: {
    kind: Kind;
    key: Setting;
    value: ApplicationPreferenceValues[Setting];
  };
}[Key];

type ApplicationIntent =
  ({ kind: 'set' } & ApplicationPreferenceInput) | ResetIntent<'restore', ApplicationPreferenceKey>;

type ProjectIntent =
  ({ kind: 'set' } & ProjectSettingInput) | ResetIntent<'clear', ProjectSettingKey>;

function ApplicationEditor({
  onPendingChange,
  pinnedProject,
  snapshot
}: {
  onPendingChange: (pending: boolean) => void;
  // The open Project when it pins a Theme, so a Theme change that leaves this window as it is
  // explains itself.
  pinnedProject: { name: string; theme: Theme } | undefined;
  snapshot: ApplicationPreferences;
}) {
  const queryClient = useQueryClient();
  const execute = useCallback(
    // Every intent already carries a typed { key, value }; only the operation differs.
    async ({ kind, ...input }: ApplicationIntent): Promise<ApplicationPreferenceValues> => {
      await cancelApplicationReads(queryClient);
      const next =
        kind === 'restore'
          ? await api.restoreApplicationPreference(input.key)
          : await api.updateApplicationPreference(input);
      await storeApplicationPreferences(queryClient, next);
      return next.values;
    },
    [queryClient]
  );
  const controller = useImmediateSettings({
    durableValues: snapshot.values,
    execute,
    onPendingChange
  });
  const orientationSelection =
    controller.pendingChange?.key === 'handleOrientation'
      ? controller.pendingChange.value
      : snapshot.values.handleOrientation;
  const minimapSelection =
    controller.pendingChange?.key === 'minimapVisible'
      ? controller.pendingChange.value
      : snapshot.values.minimapVisible;
  const themeSelection =
    controller.pendingChange?.key === 'theme'
      ? controller.pendingChange.value
      : snapshot.values.theme;

  const changeTheme = (value: Theme): void => {
    void controller.apply({ kind: 'set', key: 'theme', value });
  };
  const changeOrientation = (value: HandleOrientation): void => {
    void controller.apply({
      kind: 'set',
      key: 'handleOrientation',
      value
    });
  };
  const changeMinimap = (value: boolean): void => {
    void controller.apply({
      kind: 'set',
      key: 'minimapVisible',
      value
    });
  };

  return (
    <div className="settings-editor">
      <div>
        <span className="settings-modal__eyebrow">Application Preferences</span>
        <h2>How N² looks and works.</h2>
        <p className="settings-editor__intro">
          The Library always uses these. Every Project follows them unless it pins its own choice.
        </p>
        <SettingsFields
          leading={
            <ThemeField
              description={
                pinnedProject
                  ? `${pinnedProject.name} pins ${themeLabel(pinnedProject.theme)}, so this window stays ${themeLabel(pinnedProject.theme)}. The Library and other Projects use this Theme.`
                  : 'Applies to the Library and every Project that does not pin its own, on every device.'
              }
              disabled={controller.pendingChange !== null}
              feedback={<SettingsFeedback controller={controller} settingKey="theme" />}
              onChange={(value) => value !== 'default' && changeTheme(value)}
              restore={
                Object.hasOwn(snapshot.storedValues, 'theme')
                  ? () =>
                      void controller.apply({
                        kind: 'restore',
                        key: 'theme',
                        value: snapshot.productDefaults.theme
                      })
                  : undefined
              }
              selection={themeSelection}
            />
          }
          controller={controller}
          minimapSelection={minimapSelection}
          onMinimapChange={(value) => value !== 'default' && changeMinimap(value)}
          onOrientationChange={(value) => value !== 'default' && changeOrientation(value)}
          orientationSelection={orientationSelection}
          restoreOrientation={
            Object.hasOwn(snapshot.storedValues, 'handleOrientation')
              ? () =>
                  void controller.apply({
                    kind: 'restore',
                    key: 'handleOrientation',
                    value: snapshot.productDefaults.handleOrientation
                  })
              : undefined
          }
          restoreMinimap={
            Object.hasOwn(snapshot.storedValues, 'minimapVisible')
              ? () =>
                  void controller.apply({
                    kind: 'restore',
                    key: 'minimapVisible',
                    value: snapshot.productDefaults.minimapVisible
                  })
              : undefined
          }
          useApplicationDefault={false}
        />
      </div>
      <SettingsPreview values={controller.previewValues} />
    </div>
  );
}

function ProjectEditor({
  onPendingChange,
  snapshot
}: {
  onPendingChange: (pending: boolean) => void;
  snapshot: EffectiveProjectSettings;
}) {
  const queryClient = useQueryClient();
  // A mutation, so a Project archived elsewhere is handled by the QueryClient (see queryClient.ts).
  // The immediate-settings controller still owns pending and failure state.
  const { mutateAsync: saveProjectSetting } = useMutation({
    mutationFn: ({ kind, ...input }: ProjectIntent) =>
      kind === 'clear'
        ? api.clearProjectSettingOverride(snapshot.projectId, input.key)
        : api.updateProjectSettingOverride(snapshot.projectId, input)
  });
  const execute = useCallback(
    async (intent: ProjectIntent): Promise<SettingsValues> => {
      await cancelProjectReads(queryClient, snapshot.projectId);
      const next = await saveProjectSetting(intent);
      await storeProjectSettings(queryClient, next);
      return next.effectiveValues;
    },
    [queryClient, saveProjectSetting, snapshot.projectId]
  );
  const controller = useImmediateSettings({
    durableValues: snapshot.effectiveValues,
    execute,
    onPendingChange
  });
  const orientationSelection =
    controller.pendingChange?.key === 'handleOrientation'
      ? controller.pendingChange.kind === 'clear'
        ? 'default'
        : controller.pendingChange.value
      : (snapshot.overrides.handleOrientation ?? 'default');
  const minimapSelection =
    controller.pendingChange?.key === 'minimapVisible'
      ? controller.pendingChange.kind === 'clear'
        ? 'default'
        : controller.pendingChange.value
      : (snapshot.overrides.minimapVisible ?? 'default');
  const themeSelection =
    controller.pendingChange?.key === 'theme'
      ? controller.pendingChange.kind === 'clear'
        ? 'default'
        : controller.pendingChange.value
      : (snapshot.overrides.theme ?? 'default');

  const changeOrientation = (selection: HandleOrientation | 'default'): void => {
    const value =
      selection === 'default' ? snapshot.applicationValues.handleOrientation : selection;
    void controller.apply({
      kind: selection === 'default' ? 'clear' : 'set',
      key: 'handleOrientation',
      value
    });
  };
  const changeMinimap = (selection: boolean | 'default'): void => {
    const value = selection === 'default' ? snapshot.applicationValues.minimapVisible : selection;
    void controller.apply({
      kind: selection === 'default' ? 'clear' : 'set',
      key: 'minimapVisible',
      value
    });
  };
  const changeTheme = (selection: Theme | 'default'): void => {
    const value = selection === 'default' ? snapshot.applicationValues.theme : selection;
    void controller.apply({ kind: selection === 'default' ? 'clear' : 'set', key: 'theme', value });
  };
  const applicationTheme = themeLabel(snapshot.applicationValues.theme);

  return (
    <div className="settings-editor">
      <div>
        <span className="settings-modal__eyebrow">Current Project</span>
        <h2>Shape this workspace.</h2>
        <p className="settings-editor__intro">
          Follow Application Preferences or pin an explicit choice for this Project.
        </p>
        <SettingsFields
          leading={
            <ThemeField
              description={
                themeSelection === 'default'
                  ? `Follows the application Theme, ${applicationTheme}.`
                  : `Pinned to ${themeLabel(themeSelection)} here. The Library and other Projects keep ${applicationTheme}.`
              }
              disabled={controller.pendingChange !== null}
              feedback={<SettingsFeedback controller={controller} settingKey="theme" />}
              inherited={snapshot.applicationValues.theme}
              onChange={changeTheme}
              selection={themeSelection}
            />
          }
          applicationValues={snapshot.applicationValues}
          controller={controller}
          minimapSelection={minimapSelection}
          onMinimapChange={changeMinimap}
          onOrientationChange={changeOrientation}
          orientationSelection={orientationSelection}
          useApplicationDefault
        />
      </div>
      <SettingsPreview values={controller.previewValues} />
    </div>
  );
}

export type SettingsModalProps = {
  initialScope: SettingsScope;
  onClose: () => void;
  project?: { id: string; name: string };
};

export function SettingsModal({ initialScope, onClose, project }: SettingsModalProps) {
  const [scope, setScope] = useState<SettingsScope>(
    initialScope === 'project' && project ? 'project' : 'application'
  );
  const [saveInFlight, setSaveInFlight] = useState(false);
  // The modal covers the toast lane, so toasts must not expire unseen behind it.
  useSuspendNotificationExpiry(true);
  const saveInFlightRef = useRef(false);
  const onPendingChange = useCallback((pending: boolean): void => {
    saveInFlightRef.current = pending;
    setSaveInFlight(pending);
  }, []);
  const closeIfIdle = useCallback((): void => {
    if (!saveInFlightRef.current) onClose();
  }, [onClose]);
  const setScopeIfIdle = useCallback((nextScope: SettingsScope): void => {
    if (!saveInFlightRef.current) setScope(nextScope);
  }, []);
  const applicationQuery = useQuery(applicationPreferencesQueryOptions);
  const projectQuery = useQuery(projectSettingsQueryOptions(project?.id));

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeIfIdle();
    };
    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, [closeIfIdle]);

  const activeQuery = scope === 'project' ? projectQuery : applicationQuery;
  const active = queryView<unknown>(activeQuery);

  return (
    <div
      className="settings-modal__backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && closeIfIdle()}
    >
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <aside className="settings-modal__nav">
          <div>
            <span className="brand-mark" aria-hidden="true">
              N<sup>2</sup>
            </span>
            <span className="settings-modal__eyebrow">Settings</span>
          </div>
          <nav aria-label="Settings sections">
            {project ? (
              <button
                type="button"
                aria-current={scope === 'project' ? 'page' : undefined}
                autoFocus={scope === 'project'}
                disabled={saveInFlight}
                onClick={() => setScopeIfIdle('project')}
              >
                <span>Current Project</span>
                <small>{project.name}</small>
              </button>
            ) : null}
            <button
              type="button"
              aria-current={scope === 'application' ? 'page' : undefined}
              autoFocus={scope === 'application'}
              disabled={saveInFlight}
              onClick={() => setScopeIfIdle('application')}
            >
              <span>Application Preferences</span>
              <small>Theme and Project defaults</small>
            </button>
          </nav>
          <p>Changes save immediately to this machine.</p>
        </aside>

        <div className="settings-modal__content">
          <button
            type="button"
            className="settings-modal__close"
            disabled={saveInFlight}
            onClick={closeIfIdle}
            aria-label="Close Settings"
          >
            ×
          </button>
          {active.status === 'loading' ? (
            <div className="settings-modal__state">Opening Settings…</div>
          ) : active.status === 'unavailable' ? (
            <div className="settings-modal__state settings-modal__state--error">
              <strong>N² could not load Settings.</strong>
              <span>{active.error.message}</span>
              <button type="button" onClick={() => void activeQuery.refetch()}>
                Retry
              </button>
            </div>
          ) : (
            <>
              {active.refreshError ? (
                <RefreshWarning
                  message="Could not refresh Settings. Showing the last saved values."
                  query={activeQuery}
                />
              ) : null}
              {scope === 'project' && projectQuery.data ? (
                <ProjectEditor
                  key="project"
                  onPendingChange={onPendingChange}
                  snapshot={projectQuery.data}
                />
              ) : applicationQuery.data ? (
                <ApplicationEditor
                  key="application"
                  onPendingChange={onPendingChange}
                  pinnedProject={
                    project && projectQuery.data?.overrides.theme
                      ? { name: project.name, theme: projectQuery.data.overrides.theme }
                      : undefined
                  }
                  snapshot={applicationQuery.data}
                />
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
