import type { HandleOrientation, SettingsValues } from '@n2/contracts';
import type { ReactNode } from 'react';
import type { AnySettings, ImmediateSettings, SettingValueIntent } from '../settingsImmediate.js';
import './SettingsControls.css';

type SettingsKey = keyof SettingsValues;

// Saved and failure feedback for one setting of an immediate-settings controller.
export function SettingsFeedback<
  Values extends AnySettings,
  Intent extends SettingValueIntent<Values>
>({
  controller,
  settingKey
}: {
  controller: ImmediateSettings<Values, Intent>;
  settingKey: keyof Values;
}) {
  const failure = controller.failures[settingKey];
  return (
    <div className="settings-field__feedback">
      {controller.saved?.key === settingKey ? (
        <span key={controller.saved.nonce} className="settings-field__saved" aria-label="Saved">
          ✓
        </span>
      ) : null}
      {failure ? (
        <span className="settings-field__error" role="alert">
          {failure.message}
          <button
            type="button"
            disabled={controller.pendingChange !== null}
            onClick={() => void controller.retry(settingKey)}
          >
            Retry
          </button>
        </span>
      ) : null}
    </div>
  );
}

function OrientationChoices({
  applicationValue,
  disabled,
  onChange,
  selection,
  useApplicationDefault
}: {
  applicationValue?: HandleOrientation | undefined;
  disabled: boolean;
  onChange: (value: HandleOrientation | 'default') => void;
  selection: HandleOrientation | 'default';
  useApplicationDefault: boolean;
}) {
  return (
    <div className="settings-choice-grid">
      {useApplicationDefault ? (
        <button
          type="button"
          className="settings-choice settings-choice--default"
          aria-pressed={selection === 'default'}
          disabled={disabled}
          onClick={() => onChange('default')}
        >
          <strong>Use application default</strong>
          <small>{applicationValue === 'vertical' ? 'Top → Bottom' : 'Left → Right'}</small>
        </button>
      ) : null}
      <button
        type="button"
        className="settings-choice"
        aria-pressed={selection === 'horizontal'}
        disabled={disabled}
        onClick={() => onChange('horizontal')}
      >
        <span className="settings-choice__diagram" data-orientation="horizontal" aria-hidden="true">
          <i />
          <b>→</b>
          <i />
        </span>
        <strong>Left → Right</strong>
        <small>Horizontal</small>
      </button>
      <button
        type="button"
        className="settings-choice"
        aria-pressed={selection === 'vertical'}
        disabled={disabled}
        onClick={() => onChange('vertical')}
      >
        <span className="settings-choice__diagram" data-orientation="vertical" aria-hidden="true">
          <i />
          <b>↓</b>
          <i />
        </span>
        <strong>Top → Bottom</strong>
        <small>Vertical</small>
      </button>
    </div>
  );
}

function MinimapChoices({
  applicationValue,
  disabled,
  onChange,
  selection,
  useApplicationDefault
}: {
  applicationValue?: boolean | undefined;
  disabled: boolean;
  onChange: (value: boolean | 'default') => void;
  selection: boolean | 'default';
  useApplicationDefault: boolean;
}) {
  return (
    <div className="settings-choice-grid settings-choice-grid--compact">
      {useApplicationDefault ? (
        <button
          type="button"
          className="settings-choice settings-choice--default"
          aria-pressed={selection === 'default'}
          disabled={disabled}
          onClick={() => onChange('default')}
        >
          <strong>Use application default</strong>
          <small>{applicationValue ? 'Visible' : 'Hidden'}</small>
        </button>
      ) : null}
      <button
        type="button"
        className="settings-choice"
        aria-pressed={selection === true}
        disabled={disabled}
        onClick={() => onChange(true)}
      >
        <strong>Visible</strong>
        <small>Show the minimap</small>
      </button>
      <button
        type="button"
        className="settings-choice"
        aria-pressed={selection === false}
        disabled={disabled}
        onClick={() => onChange(false)}
      >
        <strong>Hidden</strong>
        <small>Keep the canvas quiet</small>
      </button>
    </div>
  );
}

export function SettingsFields<
  Values extends SettingsValues,
  Intent extends SettingValueIntent<Values>
>({
  controller,
  leading,
  minimapSelection,
  onMinimapChange,
  onOrientationChange,
  orientationSelection,
  restoreMinimap,
  restoreOrientation,
  useApplicationDefault,
  applicationValues
}: {
  applicationValues?: SettingsValues | undefined;
  controller: ImmediateSettings<Values, Intent>;
  // Fields shown first in the same stack, such as Theme with its scene-based choices.
  leading?: ReactNode;
  minimapSelection: boolean | 'default';
  onMinimapChange: (value: boolean | 'default') => void;
  onOrientationChange: (value: HandleOrientation | 'default') => void;
  orientationSelection: HandleOrientation | 'default';
  restoreMinimap?: (() => void) | undefined;
  restoreOrientation?: (() => void) | undefined;
  useApplicationDefault: boolean;
}) {
  const disabled = controller.pendingChange !== null;
  return (
    <SettingsChoiceFields
      applicationValues={applicationValues}
      disabled={disabled}
      feedback={(settingKey) => (
        <SettingsFeedback controller={controller} settingKey={settingKey} />
      )}
      leading={leading}
      minimapSelection={minimapSelection}
      onMinimapChange={onMinimapChange}
      onOrientationChange={onOrientationChange}
      orientationSelection={orientationSelection}
      restoreMinimap={restoreMinimap}
      restoreOrientation={restoreOrientation}
      useApplicationDefault={useApplicationDefault}
    />
  );
}

type SettingsChoiceFieldsProps = {
  applicationValues?: SettingsValues | undefined;
  disabled: boolean;
  feedback?: ((settingKey: SettingsKey) => ReactNode) | undefined;
  leading?: ReactNode;
  minimapSelection: boolean | 'default';
  onMinimapChange: (value: boolean | 'default') => void;
  onOrientationChange: (value: HandleOrientation | 'default') => void;
  orientationSelection: HandleOrientation | 'default';
  restoreMinimap?: (() => void) | undefined;
  restoreOrientation?: (() => void) | undefined;
  useApplicationDefault: boolean;
};

function SettingsChoiceFields({
  applicationValues,
  disabled,
  feedback,
  leading,
  minimapSelection,
  onMinimapChange,
  onOrientationChange,
  orientationSelection,
  restoreMinimap,
  restoreOrientation,
  useApplicationDefault
}: SettingsChoiceFieldsProps) {
  return (
    <div className="settings-fields">
      {leading}
      <section className="settings-field">
        <header>
          <div>
            <h3>Relationship handles</h3>
            <p>
              Choose how relationship subjects point toward their objects. Roadmap stays left →
              right.
            </p>
          </div>
          {restoreOrientation ? (
            <button
              type="button"
              className="settings-field__restore"
              disabled={disabled}
              onClick={restoreOrientation}
            >
              Restore product default
            </button>
          ) : null}
        </header>
        <OrientationChoices
          applicationValue={applicationValues?.handleOrientation}
          disabled={disabled}
          onChange={onOrientationChange}
          selection={orientationSelection}
          useApplicationDefault={useApplicationDefault}
        />
        {feedback?.('handleOrientation')}
      </section>

      <section className="settings-field">
        <header>
          <div>
            <h3>Minimap</h3>
            <p>Keep a small overview of the graph visible in every canvas view.</p>
          </div>
          {restoreMinimap ? (
            <button
              type="button"
              className="settings-field__restore"
              disabled={disabled}
              onClick={restoreMinimap}
            >
              Restore product default
            </button>
          ) : null}
        </header>
        <MinimapChoices
          applicationValue={applicationValues?.minimapVisible}
          disabled={disabled}
          onChange={onMinimapChange}
          selection={minimapSelection}
          useApplicationDefault={useApplicationDefault}
        />
        {feedback?.('minimapVisible')}
      </section>
    </div>
  );
}

export function DraftSettingsFields(
  props: Omit<
    SettingsChoiceFieldsProps,
    'feedback' | 'leading' | 'restoreMinimap' | 'restoreOrientation' | 'useApplicationDefault'
  >
) {
  return <SettingsChoiceFields {...props} useApplicationDefault />;
}
