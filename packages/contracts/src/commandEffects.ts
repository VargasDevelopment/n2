import { z } from 'zod';

/**
 * Command Effects: what applying this command changed beyond its outcome, judged against the exact
 * state it was applied to. Group Completions lead with Groups not inside another completed Group.
 * A replay applies nothing, so it reports none.
 */
export const ProjectCommandEffectsSchema = z
  .object({ completedGroupIds: z.array(z.string().min(1)) })
  .strict();
export type ProjectCommandEffects = z.infer<typeof ProjectCommandEffectsSchema>;
export const noCommandEffects = (): ProjectCommandEffects => ({ completedGroupIds: [] });
