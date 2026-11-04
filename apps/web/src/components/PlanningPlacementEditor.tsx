import {
  isWorkNode,
  PlanningPlacementSchema,
  type NodePatch,
  type PlanningPlacement,
  type ProjectedNode,
  type ProjectedWorkNode
} from '@n2/contracts';
import { useId } from 'react';
import { useReconciledDraft } from '../useReconciledDraft.js';
import { useEditMode } from './inspectorEditing.js';
import './PlanningPlacementEditor.css';

type PlacementKind = PlanningPlacement['kind'] | 'unscheduled';

type PlanningPlacementDraft = {
  kind: PlacementKind;
  milestoneDate: string;
  startDate: string;
  endDate: string;
};

type PlanningPlacementUpdate = (
  node: ProjectedWorkNode,
  patch: Pick<NodePatch, 'planningPlacement'>
) => Promise<ProjectedNode | null>;

const localPlanningDate = (): string => {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const placementDraft = (placement: PlanningPlacement | undefined): PlanningPlacementDraft => {
  const today = localPlanningDate();
  if (!placement) {
    return { kind: 'unscheduled', milestoneDate: today, startDate: today, endDate: today };
  }
  return placement.kind === 'milestone'
    ? {
        kind: placement.kind,
        milestoneDate: placement.date,
        startDate: placement.date,
        endDate: placement.date
      }
    : {
        kind: placement.kind,
        milestoneDate: placement.startDate,
        startDate: placement.startDate,
        endDate: placement.endDate
      };
};

const sameDraft = (left: PlanningPlacementDraft, right: PlanningPlacementDraft): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'unscheduled') return true;
  if (left.kind === 'milestone') return left.milestoneDate === right.milestoneDate;
  return left.startDate === right.startDate && left.endDate === right.endDate;
};

const placementValue = (
  draft: PlanningPlacementDraft
): { error: string | null; value: PlanningPlacement | null } => {
  if (draft.kind === 'unscheduled') return { error: null, value: null };
  if (draft.kind === 'milestone' && !draft.milestoneDate) {
    return { error: 'Choose a Milestone date.', value: null };
  }
  if (draft.kind === 'window' && (!draft.startDate || !draft.endDate)) {
    return { error: 'Choose a planned start and end.', value: null };
  }
  const result = PlanningPlacementSchema.safeParse(
    draft.kind === 'milestone'
      ? { kind: draft.kind, date: draft.milestoneDate }
      : { kind: draft.kind, startDate: draft.startDate, endDate: draft.endDate }
  );
  return result.success
    ? { error: null, value: result.data }
    : {
        error: result.error.issues[0]?.message ?? 'Choose a valid Planning Placement.',
        value: null
      };
};

// Planning Dates are calendar days, so they are formatted without the local time zone.
const dayFormat = { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' } as const;
const planningDay = new Intl.DateTimeFormat(undefined, dayFormat);
const planningDayInYear = new Intl.DateTimeFormat(undefined, { ...dayFormat, year: 'numeric' });

// Commas dropped, so a date with its year reads like one without ("Fri 6 Nov 2026").
const formatDay = (format: Intl.DateTimeFormat, date: string): string =>
  format
    .formatToParts(new Date(`${date}T00:00:00Z`))
    .map(({ type, value }) => (type === 'literal' ? value.replace(',', '') : value))
    .join('');

/** The placement as a sentence: its kind, then its date or dates. */
const placementSummary = (
  placement: PlanningPlacement | undefined
): { kind: string; when: string | null } => {
  if (!placement) return { kind: 'Unscheduled', when: null };
  if (placement.kind === 'milestone') {
    return { kind: 'Milestone', when: formatDay(planningDayInYear, placement.date) };
  }
  const sameYear = placement.startDate.slice(0, 4) === placement.endDate.slice(0, 4);
  const start = formatDay(sameYear ? planningDay : planningDayInYear, placement.startDate);
  return {
    kind: 'Planning Window',
    when: `${start} – ${formatDay(planningDayInYear, placement.endDate)}`
  };
};

const kindLabels = {
  unscheduled: 'Unscheduled',
  window: 'Planning Window',
  milestone: 'Milestone'
} satisfies Record<PlacementKind, string>;

/**
 * Saves each valid change as it is made, so there is no Save step to forget and closing the panel
 * never drops a placement. The project command queue orders the saves, so the last change wins.
 */
function usePlacementSaving(node: ProjectedWorkNode, onUpdate: PlanningPlacementUpdate) {
  const draft = useReconciledDraft(placementDraft(node.planningPlacement), sameDraft);

  const save = async (value: PlanningPlacement | null): Promise<void> => {
    const revision = draft.submit();
    if (revision === null) return;
    const accepted = await onUpdate(node, { planningPlacement: value });
    const placement =
      accepted && isWorkNode(accepted) ? accepted.planningPlacement : node.planningPlacement;
    draft.reconcile(revision, placementDraft(placement));
  };

  return {
    draft: draft.draft,
    change: (next: PlanningPlacementDraft): void => {
      draft.edit(next);
      const parsed = placementValue(next);
      if (parsed.error === null) void save(parsed.value);
    }
  };
}

function DateField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="inspector__planning-date">
      <span>{label}</span>
      <input type="date" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

function PlacementFields({
  draft,
  onChange,
  onFinish
}: {
  draft: PlanningPlacementDraft;
  onChange: (next: PlanningPlacementDraft) => void;
  onFinish: () => void;
}) {
  const error = placementValue(draft).error;
  const helpId = useId();
  return (
    // Escape finishes here, like the text fields, so only a second Escape closes the panel.
    <div
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onFinish();
      }}
    >
      <div
        className="inspector__choices inspector__planning-kinds"
        role="group"
        aria-label="Placement"
        aria-describedby={helpId}
      >
        {(['unscheduled', 'window', 'milestone'] as const).map((kind) => (
          <button
            type="button"
            key={kind}
            className={draft.kind === kind ? 'is-active' : ''}
            aria-pressed={draft.kind === kind}
            onClick={() => onChange({ ...draft, kind })}
          >
            {kindLabels[kind]}
          </button>
        ))}
      </div>
      {draft.kind === 'window' ? (
        <div className="inspector__planning-dates">
          <DateField
            label="Planned start"
            value={draft.startDate}
            onChange={(startDate) => onChange({ ...draft, startDate })}
          />
          <DateField
            label="Planned end"
            value={draft.endDate}
            onChange={(endDate) => onChange({ ...draft, endDate })}
          />
        </div>
      ) : null}
      {draft.kind === 'milestone' ? (
        <div className="inspector__planning-dates">
          <DateField
            label="Milestone date"
            value={draft.milestoneDate}
            onChange={(milestoneDate) => onChange({ ...draft, milestoneDate })}
          />
        </div>
      ) : null}
      {error ? <p className="inspector__planning-error">{error}</p> : null}
      {/* Neither placement is a deadline, and the editor is where that misreading would start. */}
      <p id={helpId} className="inspector__planning-help">
        Planning Windows show when work is intended to happen. A Milestone is a checkpoint planned
        for one date. Neither sets a due date. Due dates are not tracked yet.
      </p>
    </div>
  );
}

/** Planning reads as a sentence; Change opens the choices, which save as you make them. */
export function PlanningPlacementEditor({
  node,
  onUpdate
}: {
  node: ProjectedWorkNode;
  onUpdate: PlanningPlacementUpdate;
}) {
  const placement = usePlacementSaving(node, onUpdate);
  const { editing, returnTo, start, stop } = useEditMode<HTMLButtonElement>();
  const summary = placementSummary(node.planningPlacement);

  return (
    <section className="inspector__section inspector__planning" aria-label="Planning">
      <div className="inspector__section-head">
        <h3 className="inspector__label">Planning</h3>
        <button
          ref={returnTo}
          type="button"
          className={`inspector__action${editing ? ' is-on' : ''}`}
          aria-expanded={editing}
          aria-label={editing ? 'Done changing planning' : 'Change planning'}
          onClick={() => (editing ? stop(true) : start())}
        >
          {editing ? 'Done' : 'Change'}
        </button>
      </div>
      {editing ? (
        <PlacementFields
          draft={placement.draft}
          onChange={placement.change}
          onFinish={() => stop(true)}
        />
      ) : (
        <p className="inspector__when">
          <span className="inspector__when-kind">{summary.kind}</span>
          {summary.when ? <span>{summary.when}</span> : null}
        </p>
      )}
    </section>
  );
}
