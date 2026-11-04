/** Flow-space geometry shared by Group regions and relationship bundles. */
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
/** A canvas item's rectangle in flow coordinates. */
export type Card = Rect & { id: string };

export const centerOf = (rect: Rect): Point => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2
});

/** The shortest distance between two rectangles; 0 when they touch or overlap. */
export const rectGap = (a: Rect, b: Rect): number => {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
};

/** True when the rectangles share interior area; touching edges do not count. */
export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export const grow = (rect: Rect, by: number): Rect => ({
  x: rect.x - by,
  y: rect.y - by,
  width: rect.width + by * 2,
  height: rect.height + by * 2
});

/** The point on a rectangle's border along the ray from its centre toward `toward`. */
export const borderPoint = (rect: Rect, toward: Point): Point => {
  const center = centerOf(rect);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const scale = Math.min(
    dx === 0 ? Infinity : rect.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : rect.height / 2 / Math.abs(dy)
  );
  return { x: center.x + dx * scale, y: center.y + dy * scale };
};

/**
 * How close to a card's edge a Group region may stray from the containment rules in compose.ts.
 * Paths are written to this precision, which keeps their rounding within it.
 */
export const CONTAINMENT_TOLERANCE_PX = 0.1;

const STEPS_PER_PX = 1 / CONTAINMENT_TOLERANCE_PX;
const rounded = (value: number): number => Math.round(value * STEPS_PER_PX) / STEPS_PER_PX;

export const formatPoint = ({ x, y }: Point): string => `${rounded(x)} ${rounded(y)}`;

/** One SVG path for a region outline; holes come out right with the default nonzero fill. */
export const outlinePath = (outline: readonly (readonly Point[])[]): string =>
  outline
    .map((loop) => `${loop.map((p, i) => `${i === 0 ? 'M' : 'L'}${formatPoint(p)}`).join(' ')} Z`)
    .join(' ');
