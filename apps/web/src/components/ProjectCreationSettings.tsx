import {
  resolveEffectiveProjectSettings,
  type HandleOrientation,
  type ProjectSettingOverrides
} from '@n2/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { queryView } from '../queryView.js';
import { applicationPreferencesQueryOptions } from '../settingsQueries.js';
import { RefreshWarning } from './RefreshWarning.js';
import { DraftSettingsFields } from './SettingsControls.js';
import { SettingsPreview } from './SettingsPreview.js';
import './ProjectCreationSettings.css';

export function ProjectCreationSettings({
  disabled,
  draftProjectId,
  onChange,
  overrides
}: {
  disabled: boolean;
  draftProjectId: string;
  onChange: (overrides: ProjectSettingOverrides) => void;
  overrides: ProjectSettingOverrides;
}) {
  const [expanded, setExpanded] = useState(false);
  const applicationQuery = useQuery({ ...applicationPreferencesQueryOptions, enabled: false });
  const application = queryView(applicationQuery);
  const hasOverrides = Object.keys(overrides).length > 0;

  const changeOrientation = (selection: HandleOrientation | 'default'): void => {
    const next = { ...overrides };
    if (selection === 'default') delete next.handleOrientation;
    else next.handleOrientation = selection;
    onChange(next);
  };
  const changeMinimap = (selection: boolean | 'default'): void => {
    const next = { ...overrides };
    if (selection === 'default') delete next.minimapVisible;
    else next.minimapVisible = selection;
    onChange(next);
  };

  return (
    <details
      className="project-creation-settings"
      open={expanded}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        setExpanded(open);
        if (open && !applicationQuery.isFetching) void applicationQuery.refetch();
      }}
    >
      <summary>
        <span className="project-creation-settings__disclosure" aria-hidden="true">
          ›
        </span>
        <span>
          <strong>Project settings</strong>
          <small>Choose application defaults or configure this Project.</small>
        </span>
        <span className="project-creation-settings__state">
          {hasOverrides ? 'Custom settings' : 'Application defaults'}
        </span>
      </summary>
      {expanded ? (
        <div className="project-creation-settings__body">
          {application.status === 'loading' ? (
            <div className="project-creation-settings__query-state">
              Loading application defaults…
            </div>
          ) : application.status === 'unavailable' ? (
            <div className="project-creation-settings__query-state project-creation-settings__query-state--error">
              <strong>Application defaults are unavailable.</strong>
              <span>{application.error.message}</span>
              <button
                type="button"
                disabled={applicationQuery.isFetching}
                onClick={() => void applicationQuery.refetch()}
              >
                {applicationQuery.isFetching ? 'Retrying…' : 'Try again'}
              </button>
            </div>
          ) : (
            <div className="project-creation-settings__editor">
              <div>
                {application.refreshError ? (
                  <RefreshWarning
                    message="Could not refresh application defaults. Using the last local values."
                    query={applicationQuery}
                  />
                ) : null}
                <p className="project-creation-settings__intro">
                  Application Preferences are read-only here. Explicit choices stay pinned even if
                  those defaults change later.
                </p>
                <DraftSettingsFields
                  applicationValues={application.data.values}
                  disabled={disabled}
                  minimapSelection={overrides.minimapVisible ?? 'default'}
                  onMinimapChange={changeMinimap}
                  onOrientationChange={changeOrientation}
                  orientationSelection={overrides.handleOrientation ?? 'default'}
                />
              </div>
              <SettingsPreview
                values={
                  resolveEffectiveProjectSettings({
                    projectId: draftProjectId,
                    applicationValues: application.data.values,
                    overrides
                  }).effectiveValues
                }
              />
            </div>
          )}
        </div>
      ) : null}
    </details>
  );
}
