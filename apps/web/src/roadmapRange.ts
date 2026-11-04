import type { PlanningDate, PlanningPlacement } from '@n2/contracts';

const DAY_MILLISECONDS = 86_400_000;
const MIN_PLANNING_DATE_ORDINAL = Date.parse('0000-01-01T00:00:00.000Z');
const MAX_PLANNING_DATE_ORDINAL = Date.parse('9999-12-31T00:00:00.000Z');

declare const roadmapRangeBrand: unique symbol;

export type RoadmapRange = Readonly<{
  startDate: PlanningDate;
  endDate: PlanningDate;
  [roadmapRangeBrand]: true;
}>;

export const createRoadmapRange = (
  startDate: PlanningDate,
  endDate: PlanningDate
): RoadmapRange => {
  if (startDate > endDate) throw new Error('A Roadmap range must not end before it starts.');
  return { startDate, endDate } as RoadmapRange;
};

export const changeRoadmapRangeStart = (
  range: RoadmapRange,
  startDate: PlanningDate
): RoadmapRange =>
  createRoadmapRange(startDate, startDate > range.endDate ? startDate : range.endDate);

export const changeRoadmapRangeEnd = (range: RoadmapRange, endDate: PlanningDate): RoadmapRange =>
  createRoadmapRange(endDate < range.startDate ? endDate : range.startDate, endDate);

export const planningDateOrdinal = (date: PlanningDate): number =>
  Date.parse(`${date}T00:00:00.000Z`);

export const planningDateFromOrdinal = (ordinal: number): PlanningDate =>
  new Date(Math.min(MAX_PLANNING_DATE_ORDINAL, Math.max(MIN_PLANNING_DATE_ORDINAL, ordinal)))
    .toISOString()
    .slice(0, 10);

export const shiftPlanningDate = (date: PlanningDate, days: number): PlanningDate =>
  planningDateFromOrdinal(planningDateOrdinal(date) + days * DAY_MILLISECONDS);

export const daysBetween = (start: PlanningDate, end: PlanningDate): number =>
  Math.round((planningDateOrdinal(end) - planningDateOrdinal(start)) / DAY_MILLISECONDS);

export const placementStart = (placement: PlanningPlacement): PlanningDate =>
  placement.kind === 'milestone' ? placement.date : placement.startDate;

export const placementEnd = (placement: PlanningPlacement): PlanningDate =>
  placement.kind === 'milestone' ? placement.date : placement.endDate;

export const planningPlacementOverlapsRange = (
  placement: PlanningPlacement,
  range: RoadmapRange
): boolean =>
  placementStart(placement) <= range.endDate && placementEnd(placement) >= range.startDate;

export const intersectPlanningPlacement = (
  placement: PlanningPlacement,
  range: RoadmapRange
): {
  startDate: PlanningDate;
  endDate: PlanningDate;
  clippedAtStart: boolean;
  clippedAtEnd: boolean;
} => {
  const originalStart = placementStart(placement);
  const originalEnd = placementEnd(placement);
  return {
    startDate: originalStart < range.startDate ? range.startDate : originalStart,
    endDate: originalEnd > range.endDate ? range.endDate : originalEnd,
    clippedAtStart: originalStart < range.startDate,
    clippedAtEnd: originalEnd > range.endDate
  };
};

export const shiftRoadmapRange = (range: RoadmapRange, direction: -1 | 1): RoadmapRange => {
  const spanDays = daysBetween(range.startDate, range.endDate) + 1;
  const requestedStart =
    planningDateOrdinal(range.startDate) + direction * spanDays * DAY_MILLISECONDS;
  const requestedEnd = planningDateOrdinal(range.endDate) + direction * spanDays * DAY_MILLISECONDS;
  const boundaryCorrection =
    requestedStart < MIN_PLANNING_DATE_ORDINAL
      ? MIN_PLANNING_DATE_ORDINAL - requestedStart
      : requestedEnd > MAX_PLANNING_DATE_ORDINAL
        ? MAX_PLANNING_DATE_ORDINAL - requestedEnd
        : 0;
  return createRoadmapRange(
    planningDateFromOrdinal(requestedStart + boundaryCorrection),
    planningDateFromOrdinal(requestedEnd + boundaryCorrection)
  );
};
