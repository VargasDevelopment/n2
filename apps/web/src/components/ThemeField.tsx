import type { Theme } from '@n2/contracts';
import type { ReactNode } from 'react';
import { THEME_OPTIONS, themeLabel, type EffectiveTheme } from '../theme.js';
import './ThemeField.css';

// Each swatch is a small scene under its own data-theme, so it previews the real tokens of that
// Theme (surfaces, text, accent, Note, and the status glyphs) rather than a copied palette.
function ThemeScene({ theme }: { theme: EffectiveTheme }) {
  return (
    <span className="theme-choice__scene" data-theme={theme} aria-hidden="true">
      <span className="theme-choice__card">
        <span className="theme-choice__title">Aa</span>
        <span className="theme-choice__statuses">
          <i className="status-dot" />
          <i className="status-dot status-dot--in_progress" />
          <i className="status-dot status-dot--blocked" />
          <i className="status-dot status-dot--done" />
        </span>
        <span className="theme-choice__progress" />
      </span>
      <span className="theme-choice__note" />
    </span>
  );
}

function ThemePreview({ theme }: { theme: Theme }) {
  return theme === 'system' ? (
    <span className="theme-choice__split" aria-hidden="true">
      <ThemeScene theme="paper" />
      <ThemeScene theme="midnight" />
    </span>
  ) : (
    <ThemeScene theme={theme} />
  );
}

/**
 * The Theme choices. With `inherited`, the field edits a Project Setting Override: a leading
 * choice follows the application Theme, and any other choice pins that Theme to the Project.
 */
export function ThemeField({
  description,
  disabled,
  feedback,
  inherited,
  onChange,
  restore,
  selection
}: {
  description: ReactNode;
  disabled: boolean;
  feedback: ReactNode;
  inherited?: Theme | undefined;
  onChange: (selection: Theme | 'default') => void;
  restore?: (() => void) | undefined;
  selection: Theme | 'default';
}) {
  return (
    <section className="settings-field">
      <header>
        <div>
          <h3>Theme</h3>
          <p>{description}</p>
        </div>
        {restore ? (
          <button
            type="button"
            className="settings-field__restore"
            disabled={disabled}
            onClick={restore}
          >
            Restore product default
          </button>
        ) : null}
      </header>
      <div className="theme-choice-grid">
        {inherited ? (
          <button
            type="button"
            className="theme-choice theme-choice--default"
            aria-pressed={selection === 'default'}
            disabled={disabled}
            onClick={() => onChange('default')}
          >
            <ThemePreview theme={inherited} />
            <span className="theme-choice__default-copy">
              <strong>Use application default</strong>
              <small>{themeLabel(inherited)}, the same as the Library</small>
            </span>
          </button>
        ) : null}
        {THEME_OPTIONS.map(({ theme, label, description: choiceDescription }) => (
          <button
            key={theme}
            type="button"
            className="theme-choice"
            aria-pressed={selection === theme}
            disabled={disabled}
            onClick={() => onChange(theme)}
          >
            <ThemePreview theme={theme} />
            <strong>{label}</strong>
            <small>{choiceDescription}</small>
          </button>
        ))}
      </div>
      {feedback}
    </section>
  );
}
