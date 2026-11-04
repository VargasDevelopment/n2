import type { GroupEnablePreview, TaskExecution } from '@n2/contracts';
import { useState } from 'react';
import type { RunExecutionAuthorization } from './useExecutionAuthorizationGuard.js';

// One sentence per eligibility: where the Task stands with agents and what the next step is.
const eligibilityCopy = {
  off: "Off. Agents can't pick up this Task.",
  enabled: 'Enabled. Agents may pick up this Task as its instructions read now.',
  instructions_changed:
    "Enabled, but its instructions changed since. Agents can't pick it up until you re-enable it."
} satisfies Record<TaskExecution['eligibility'], string>;

const attemptLabel = (attempt: TaskExecution['latestAttempt']): string | null => {
  if (!attempt) return null;
  if (attempt.state === 'stop_requested') return 'Stop requested — agent still running';
  if (attempt.state === 'stopped') return 'Stopped (confirmed)';
  if (attempt.state === 'active') return `Agent running · ${attempt.workerId}`;
  return `Last attempt: ${attempt.state}`;
};

export function TaskAgentControls({
  execution,
  isPending,
  onDisable,
  onEnable,
  runExecutionAuthorization
}: {
  execution: TaskExecution | null;
  isPending: boolean;
  onDisable?: (() => Promise<void>) | undefined;
  onEnable?: (() => Promise<void>) | undefined;
  runExecutionAuthorization: RunExecutionAuthorization;
}) {
  if (!execution) return null;
  const attempt = attemptLabel(execution.latestAttempt);
  const run = (action: (() => Promise<void>) | undefined) => () => {
    if (action) runExecutionAuthorization(action);
  };
  return (
    <section className="inspector__section inspector__agents" aria-label="Agents">
      <h3 className="inspector__label">Agents</h3>
      <p className={execution.eligibility === 'instructions_changed' ? 'is-warning' : undefined}>
        {eligibilityCopy[execution.eligibility]}
      </p>
      {attempt ? <p className="inspector__attempt-state">{attempt}</p> : null}
      <div className="inspector__buttons">
        {execution.eligibility === 'enabled' ? (
          <button
            type="button"
            className="inspector__button"
            disabled={isPending}
            onClick={run(onDisable)}
          >
            Disable for agents
          </button>
        ) : (
          <button
            type="button"
            className="inspector__button inspector__button--primary"
            disabled={isPending}
            onClick={run(onEnable)}
          >
            {execution.eligibility === 'off' ? 'Enable for agents' : 'Re-enable for agents'}
          </button>
        )}
        {execution.eligibility === 'instructions_changed' ? (
          <button
            type="button"
            className="inspector__button inspector__button--quiet"
            disabled={isPending}
            onClick={run(onDisable)}
          >
            Disable for agents
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function GroupAgentControls({
  isPending,
  onConfirm,
  onPreview,
  runExecutionAuthorization
}: {
  isPending: boolean;
  onConfirm?: ((preview: GroupEnablePreview) => Promise<boolean>) | undefined;
  onPreview?: (() => Promise<GroupEnablePreview | null>) | undefined;
  runExecutionAuthorization: RunExecutionAuthorization;
}) {
  const [preview, setPreview] = useState<GroupEnablePreview | null>(null);
  return (
    <section className="inspector__section inspector__agents" aria-label="Agents">
      <h3 className="inspector__label">Agents</h3>
      <p>Enable the Tasks already in this Group. Tasks added later are not enabled.</p>
      <div className="inspector__buttons">
        <button
          type="button"
          className="inspector__button"
          disabled={isPending}
          onClick={() => {
            if (!onPreview) return;
            runExecutionAuthorization(async () => {
              setPreview(await onPreview());
            });
          }}
        >
          Enable existing work for agents
        </button>
      </div>
      {preview ? (
        <div className="inspector__agent-preview">
          <p>
            {preview.tasks.length} existing {preview.tasks.length === 1 ? 'Task' : 'Tasks'} will be
            enabled:
          </p>
          <ul>
            {preview.tasks.map((task) => (
              <li key={task.taskId}>
                {task.reference} · {task.title}
              </li>
            ))}
          </ul>
          <div className="inspector__buttons">
            <button
              type="button"
              className="inspector__button inspector__button--primary"
              disabled={isPending}
              onClick={() => {
                if (!onConfirm) return;
                runExecutionAuthorization(async () => {
                  const confirmed = await onConfirm(preview);
                  if (confirmed) setPreview(null);
                });
              }}
            >
              Confirm enablement
            </button>
            <button
              type="button"
              className="inspector__button inspector__button--quiet"
              disabled={isPending}
              onClick={() => setPreview(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
