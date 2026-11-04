// Shared by the Group region tests.
import type { GroupMembership, GroupRegion, Membership } from './regions.js';
import type { Card, Point } from './shapes.js';

export const card = (id: string, x: number, y: number): Card => ({
  id,
  x,
  y,
  width: 230,
  height: 140
});
export const cardsOf = (...cards: Card[]): ReadonlyMap<string, Card> =>
  new Map(cards.map((c) => [c.id, c]));
export const partOf = (memberId: string, groupId: string): Membership => ({ memberId, groupId });
/** The Groups of these memberships, as the canvas would pass them. */
export const groupsOf = (...memberships: Membership[]): GroupMembership => ({
  groupIds: memberships.map(({ groupId }) => groupId),
  memberships
});

/** Even-odd point-in-polygon test for one closed loop, independent of Clipper. */
const loopContains = (loop: readonly Point[], point: Point): boolean => {
  let crossings = 0;
  loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length] ?? a;
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) crossings += 1;
  });
  return crossings % 2 === 1;
};
// Holes wind inside outlines, so a point is in the region when an odd number of loops hold it.
export const holds = (loops: readonly (readonly Point[])[], point: Point): boolean =>
  loops.filter((loop) => loopContains(loop, point)).length % 2 === 1;
export const inside = (region: GroupRegion, point: Point): boolean => holds(region.outline, point);
export const regionFor = (regions: readonly GroupRegion[], groupId: string): GroupRegion => {
  const region = regions.find((candidate) => candidate.groupId === groupId);
  if (!region) throw new Error(`No region for ${groupId}`);
  return region;
};

/** Mulberry32, so a failing case replays exactly. */
export const seeded = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
