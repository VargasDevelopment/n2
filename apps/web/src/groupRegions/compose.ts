import {
  differenceD,
  EndType,
  FillRule,
  inflatePathsD,
  isPositiveD,
  JoinType,
  pointInPolygonD,
  PointInPolygonResult,
  unionD,
  type PathD,
  type PathsD
} from 'clipper2-ts';
import { centerOf, rectGap, type Card, type Point, type Rect } from './shapes.js';

/**
 * The shape of a Group region. Cards that join others close into one soft area with them, padded
 * and with rounded inner corners; around the cards themselves four rules hold:
 *
 *   1. every own card is inside;
 *   2. every foreign card is outside;
 *   3. every own card's padding is inside;
 *   4. every foreign card's margin is outside.
 *
 * Where two rules disagree the earlier one wins, which only happens when cards sit closer than the
 * padding plus the margin. So a foreign card is never covered, even by padding, and an own card is
 * never cut, even when it overlaps a foreign one. The result is one set of loops that do not
 * overlap, so the region's translucent fill never doubles where its shapes meet.
 *
 * Tolerance: as drawn, each rule holds everywhere but within CONTAINMENT_TOLERANCE_PX of the edge
 * that bounds it, and padded corners may also round out up to ARC_TOLERANCE into a margin. Clipper
 * rounds to hundredths of a pixel and the SVG path to tenths, together within the tolerance, and
 * the region cache keys on its exact input, so a reused region never adds to it.
 */

const BASE_PAD = 16;
const PAD_PER_LEVEL = 18;
/** Each level of Groups inside a Group pads it wider, so nested regions read as rings. */
export const padFor = (level: number): number => BASE_PAD + PAD_PER_LEVEL * level;
export const FOREIGN_MARGIN = 10;

/** Grown this much past the padding and shrunk back, the soft area rounds its inner corners. */
const CLOSING = 26;

/** Clipper works in hundredths of a pixel. */
const PRECISION = 2;
/** Round corners are polygons within this distance of the true arc. */
export const ARC_TOLERANCE = 0.35;

const rectPath = ({ x, y, width, height }: Rect, by: number): PathD => [
  { x: x - by, y: y - by },
  { x: x + width + by, y: y - by },
  { x: x + width + by, y: y + height + by },
  { x: x - by, y: y + height + by }
];

/**
 * A card padded by `pad` with round corners, as a polygon whose every edge touches the rounded
 * rectangle from outside. So it holds the whole padding and strays out by at most ARC_TOLERANCE.
 * Vertices run in order of increasing angle, the same winding as rectPath.
 */
const paddedPath = ({ x, y, width, height }: Rect, pad: number): PathD => {
  const perCorner = Math.ceil(Math.PI / 4 / Math.acos(pad / (pad + ARC_TOLERANCE)));
  const step = Math.PI / 2 / perCorner;
  const radius = pad / Math.cos(step / 2);
  const centres = [
    [x + width, y + height],
    [x, y + height],
    [x, y],
    [x + width, y]
  ] as const;
  return centres.flatMap(([cx, cy], corner) =>
    Array.from({ length: perCorner }, (_, k) => {
      const angle = (corner + (k + 0.5) / perCorner) * (Math.PI / 2);
      return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    })
  );
};

/**
 * The soft area: `joined` padded, with inner corners rounded by a closing (grown past the padding,
 * then shrunk back). An empty hole is just space between members and reads as a window punched in
 * the region, so it is filled; a hole around a foreign card stays, because it says exactly that.
 */
const softArea = (joined: readonly Rect[], foreign: readonly Card[], pad: number): PathsD => {
  if (joined.length === 0) return [];
  const offset = (paths: PathsD, by: number, arcTolerance: number): PathsD =>
    inflatePathsD(paths, by, JoinType.Round, EndType.Polygon, 2, PRECISION, arcTolerance);
  // Joined cards and fillers abut, so their union has far fewer corners to round than they do.
  const union = unionD(
    joined.map((rect) => rectPath(rect, 0)),
    FillRule.NonZero
  );
  // Shrinking keeps a corner's vertices but scales its arc down to `pad`, so the grown corners can
  // be coarser by the same ratio and still end as smooth as the padded cards. Shrinking costs about
  // as much per vertex, so this is most of its speed.
  const grown = offset(union, pad + CLOSING, (ARC_TOLERANCE * (pad + CLOSING)) / pad);
  const closed = offset(grown, -CLOSING, ARC_TOLERANCE);
  // Clipper winds outlines like rectPath, and holes the other way.
  return closed.filter(
    (loop) =>
      isPositiveD(loop) ||
      foreign.some(
        (card) => pointInPolygonD(centerOf(card), loop, PRECISION) === PointInPolygonResult.IsInside
      )
  );
};

type RegionShapes = {
  /** Cards that join others, and the fillers between them; possibly empty. */
  joined: readonly Rect[];
  /** The Group card and every card that is part of it; never empty. */
  own: readonly Card[];
  foreign: readonly Card[];
  pad: number;
};

/**
 * The region's outline: the soft area and the padded cards, held to the four rules above. Holes
 * wind the other way from outlines.
 *
 * Clipper scales coordinates to integers and throws once they pass Number.MAX_SAFE_INTEGER, which a
 * card saved 1e14 px out reaches. Working relative to the own cards keeps that to Groups whose own
 * cards span that far; groupRegions contains those.
 */
export const composeRegion = ({ joined, own, foreign, pad }: RegionShapes): Point[][] => {
  const dx = Math.min(...own.map((card) => card.x));
  const dy = Math.min(...own.map((card) => card.y));
  const toLocal = <T extends Point>(shape: T): T => ({
    ...shape,
    x: shape.x - dx,
    y: shape.y - dy
  });
  const local = areaByRules({
    joined: joined.map(toLocal),
    own: own.map(toLocal),
    foreign: foreign.map(toLocal),
    pad
  });
  return local.map((loop) => loop.map(({ x, y }) => ({ x: x + dx, y: y + dy })));
};

const areaByRules = ({ joined, own, foreign, pad }: RegionShapes): PathsD => {
  // Rule 4 for the soft area, then rule 3: the padded cards go on top of what is left of it.
  const blob = softArea(joined, foreign, pad);
  const margins = foreign.map((card) => rectPath(card, FOREIGN_MARGIN));
  const soft =
    blob.length > 0 && margins.length > 0
      ? differenceD(blob, margins, FillRule.NonZero, PRECISION)
      : blob;
  const padded = own.map((card) => paddedPath(card, pad));
  const area = unionD(soft, padded, FillRule.NonZero, PRECISION);

  // Rules 2 and 1 matter only where a foreign card comes within an own card's padding: cut the
  // foreign card out, then put back the own cards beside it. A pixel past the padding covers the
  // corners' overshoot and rounding.
  const crowding: PathD[] = [];
  const beside = new Set<Card>();
  for (const other of foreign) {
    const near = own.filter((card) => rectGap(card, other) < pad + 1);
    if (near.length === 0) continue;
    crowding.push(rectPath(other, 0));
    for (const card of near) beside.add(card);
  }
  if (crowding.length === 0) return area;
  return unionD(
    differenceD(area, crowding, FillRule.NonZero, PRECISION),
    [...beside].map((card) => rectPath(card, 0)),
    FillRule.NonZero,
    PRECISION
  );
};
