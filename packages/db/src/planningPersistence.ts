import { PlanningPlacementSchema, type PlanningPlacement } from '@n2/contracts';
import type { nodes } from './schema.js';

type PlanningColumns = Pick<
  typeof nodes.$inferInsert,
  'planningKind' | 'planningStartDate' | 'planningEndDate'
>;

export const planningColumns = (
  placement: PlanningPlacement | null | undefined
): PlanningColumns => {
  if (!placement) {
    return { planningKind: null, planningStartDate: null, planningEndDate: null };
  }
  return placement.kind === 'milestone'
    ? {
        planningKind: placement.kind,
        planningStartDate: placement.date,
        planningEndDate: null
      }
    : {
        planningKind: placement.kind,
        planningStartDate: placement.startDate,
        planningEndDate: placement.endDate
      };
};

export const toPlanningPlacement = (row: typeof nodes.$inferSelect): PlanningPlacement | null => {
  if (row.planningKind === null) {
    if (row.planningStartDate !== null || row.planningEndDate !== null) {
      throw new Error(`Node ${row.id} has dates without a Planning Placement kind.`);
    }
    return null;
  }
  return PlanningPlacementSchema.parse(
    row.planningKind === 'milestone'
      ? { kind: row.planningKind, date: row.planningStartDate }
      : {
          kind: row.planningKind,
          startDate: row.planningStartDate,
          endDate: row.planningEndDate
        }
  );
};
