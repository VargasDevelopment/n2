import type { PlanningPlacement } from '@n2/contracts';
import { describe, expect, it } from 'vitest';
import {
  changeRoadmapRangeEnd,
  changeRoadmapRangeStart,
  createRoadmapRange,
  intersectPlanningPlacement,
  planningPlacementOverlapsRange,
  shiftRoadmapRange,
  type RoadmapRange
} from './roadmapRange.js';

const range: RoadmapRange = createRoadmapRange('2026-08-22', '2026-08-30');

describe('Roadmap ranges', () => {
  it('scrubs by the complete inclusive range span', () => {
    expect(shiftRoadmapRange(range, -1)).toEqual({
      startDate: '2026-08-13',
      endDate: '2026-08-21'
    });
    expect(shiftRoadmapRange(range, 1)).toEqual({
      startDate: '2026-08-31',
      endDate: '2026-09-08'
    });
  });

  it('preserves the span when scrubbing reaches Planning Date bounds', () => {
    expect(shiftRoadmapRange(createRoadmapRange('0000-01-01', '0000-01-09'), -1)).toEqual({
      startDate: '0000-01-01',
      endDate: '0000-01-09'
    });
    expect(shiftRoadmapRange(createRoadmapRange('9999-12-23', '9999-12-31'), 1)).toEqual({
      startDate: '9999-12-23',
      endDate: '9999-12-31'
    });
  });

  it('moves the opposite endpoint when an edit would invert the range', () => {
    expect(changeRoadmapRangeStart(range, '2026-09-02')).toEqual({
      startDate: '2026-09-02',
      endDate: '2026-09-02'
    });
    expect(changeRoadmapRangeEnd(range, '2026-08-10')).toEqual({
      startDate: '2026-08-10',
      endDate: '2026-08-10'
    });
  });

  it('rejects an inverted range at its canonical constructor', () => {
    expect(() => createRoadmapRange('2026-08-30', '2026-08-22')).toThrow(
      'A Roadmap range must not end before it starts.'
    );
  });

  it('recognizes boundary overlap and reports clipped Planning Window edges', () => {
    const placement: PlanningPlacement = {
      kind: 'window',
      startDate: '2026-08-20',
      endDate: '2026-09-02'
    };

    expect(planningPlacementOverlapsRange(placement, range)).toBe(true);
    expect(intersectPlanningPlacement(placement, range)).toEqual({
      startDate: range.startDate,
      endDate: range.endDate,
      clippedAtStart: true,
      clippedAtEnd: true
    });
    expect(planningPlacementOverlapsRange({ kind: 'milestone', date: '2026-08-31' }, range)).toBe(
      false
    );
  });
});
