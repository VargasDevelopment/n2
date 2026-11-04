import { z } from 'zod';

export const PlanningDateSchema = z.iso.date();
export type PlanningDate = z.infer<typeof PlanningDateSchema>;

const PlanningWindowSchema = z
  .object({
    kind: z.literal('window'),
    startDate: PlanningDateSchema,
    endDate: PlanningDateSchema
  })
  .strict();

const MilestoneSchema = z
  .object({
    kind: z.literal('milestone'),
    date: PlanningDateSchema
  })
  .strict();

export const PlanningPlacementSchema = z
  .discriminatedUnion('kind', [PlanningWindowSchema, MilestoneSchema])
  .superRefine((placement, context) => {
    if (placement.kind === 'window' && placement.startDate > placement.endDate) {
      context.addIssue({
        code: 'custom',
        message: 'A Planning Window cannot end before it starts.',
        path: ['endDate']
      });
    }
  });
export type PlanningPlacement = z.infer<typeof PlanningPlacementSchema>;
