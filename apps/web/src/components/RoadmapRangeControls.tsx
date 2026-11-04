import { PlanningDateSchema, type PlanningDate } from '@n2/contracts';
import type { CanvasSession } from '../canvasSession.js';
import {
  changeRoadmapRangeEnd,
  changeRoadmapRangeStart,
  createRoadmapRange,
  shiftRoadmapRange,
  type RoadmapRange
} from '../roadmapRange.js';
import './RoadmapRangeControls.css';

const parsedPlanningDate = (value: string): PlanningDate | null => {
  const parsed = PlanningDateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export function RoadmapRangeControls({
  range,
  isAutomatic,
  onChange,
  onReset
}: {
  range: RoadmapRange;
  isAutomatic: boolean;
  onChange: (range: RoadmapRange) => void;
  onReset: () => void;
}) {
  return (
    <div className="roadmap-range-controls" aria-label="Roadmap range controls">
      <button
        type="button"
        className="roadmap-range-controls__scrub"
        aria-label="Show previous Roadmap range"
        onClick={() => onChange(shiftRoadmapRange(range, -1))}
      >
        ‹
      </button>
      <div className="roadmap-range-controls__dates">
        <span>{isAutomatic ? 'Auto range' : 'Roadmap range'}</span>
        <label>
          <span className="sr-only">Roadmap range start</span>
          <input
            type="date"
            value={range.startDate}
            max={range.endDate}
            onChange={(event) => {
              const startDate = parsedPlanningDate(event.target.value);
              if (startDate) onChange(changeRoadmapRangeStart(range, startDate));
            }}
          />
        </label>
        <span aria-hidden="true">→</span>
        <label>
          <span className="sr-only">Roadmap range end</span>
          <input
            type="date"
            value={range.endDate}
            min={range.startDate}
            onChange={(event) => {
              const endDate = parsedPlanningDate(event.target.value);
              if (endDate) onChange(changeRoadmapRangeEnd(range, endDate));
            }}
          />
        </label>
      </div>
      {!isAutomatic ? (
        <button type="button" className="roadmap-range-controls__auto" onClick={onReset}>
          Auto
        </button>
      ) : null}
      <button
        type="button"
        className="roadmap-range-controls__scrub"
        aria-label="Show next Roadmap range"
        onClick={() => onChange(shiftRoadmapRange(range, 1))}
      >
        ›
      </button>
    </div>
  );
}

export function RoadmapRangeControlBar({ canvasSession }: { canvasSession: CanvasSession }) {
  if (canvasSession.kind !== 'roadmap' || !canvasSession.view.board.axis) return null;
  return (
    <RoadmapRangeControls
      range={createRoadmapRange(
        canvasSession.view.board.axis.startDate,
        canvasSession.view.board.axis.endDate
      )}
      isAutomatic={canvasSession.isAutomaticRange}
      onChange={canvasSession.onSetRoadmapRange}
      onReset={canvasSession.onResetRoadmapRange}
    />
  );
}
