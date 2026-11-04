import { composeRegion, FOREIGN_MARGIN, padFor } from './compose.js';
import { grow, rectGap, rectsOverlap, type Card, type Point, type Rect } from './shapes.js';

/**
 * A Group region: the canvas presentation of Member of. One shaded area holds the Group card and
 * every card that is part of it, directly or through member Groups. Card positions stay
 * authoritative, so the region follows the layout and never moves a card:
 *
 *   1. Neighbouring cards that line up (overlap on one axis) with nothing foreign between them are
 *      joined by a filler, so a column or grid of members becomes one region.
 *   2. compose.ts pads joined cards and their fillers into one soft area with rounded inner
 *      corners, and sets the edges around every card, so a region always holds its own cards and
 *      their padding and never claims a foreign card or its margin, to within
 *      CONTAINMENT_TOLERANCE_PX. A card that joins nothing is just its padded rectangle.
 *   3. Pieces that still do not touch are joined by thin tethers along a minimum spanning tree.
 *
 * Membership is an overlapping DAG (ADR 0002), so regions may overlap. A Group that contains Groups
 * pads wider than its children and includes their fillers, so nesting reads as rings.
 */
export type GroupRegion = {
  groupId: string;
  /** Levels of Groups inside it: 0 when no member is a Group, else one more than its deepest. */
  level: number;
  /** Closed loops in flow coordinates; holes wind the other way. */
  outline: readonly (readonly Point[])[];
  /** Straight connectors between pieces of the region that do not touch. */
  tethers: readonly (readonly [Point, Point])[];
  /** Where the zoomed-out title sits: the region edge above the Group card's top-left corner. */
  titleAnchor: Point;
};

/** One Member of relationship, by its named endpoint roles. */
export type Membership = { memberId: string; groupId: string };

const MAX_FILL_GAP = 420;
const MAX_CORNER_GAP = 200;
const CORNER_BRIDGE = 48;
/** Fillers need this much shared span to count as lined up. */
const MIN_ALIGNMENT = 24;

/** A filler between two neighbouring cards, or null when they do not line up or sit too far apart. */
const fillerBetween = (a: Rect, b: Rect): Rect | null => {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right - left > MIN_ALIGNMENT) {
    const upper = a.y < b.y ? a : b;
    const lower = upper === a ? b : a;
    const gap = lower.y - (upper.y + upper.height);
    if (gap <= 0 || gap > MAX_FILL_GAP) return null;
    return { x: left, y: upper.y + upper.height, width: right - left, height: gap };
  }
  if (bottom - top > MIN_ALIGNMENT) {
    const first = a.x < b.x ? a : b;
    const second = first === a ? b : a;
    const gap = second.x - (first.x + first.width);
    if (gap <= 0 || gap > MAX_FILL_GAP) return null;
    return { x: first.x + first.width, y: top, width: gap, height: bottom - top };
  }
  // Diagonal neighbours (a Group card above and beside its members, say): bridge the facing
  // corners with the box between them, widened so the joint is not a pinch.
  const x0 = Math.min(a.x + a.width, b.x + b.width);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y + a.height, b.y + b.height);
  const y1 = Math.max(a.y, b.y);
  if (Math.hypot(Math.max(0, x1 - x0), Math.max(0, y1 - y0)) > MAX_CORNER_GAP) return null;
  const widen = (from: number, to: number): [number, number] => {
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    const middle = (low + high) / 2;
    return high - low >= CORNER_BRIDGE
      ? [low, high]
      : [middle - CORNER_BRIDGE / 2, middle + CORNER_BRIDGE / 2];
  };
  const [fromX, toX] = widen(x0, x1);
  const [fromY, toY] = widen(y0, y1);
  return { x: fromX, y: fromY, width: toX - fromX, height: toY - fromY };
};

const closestPoints = (a: Rect, b: Rect): [Point, Point] => {
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
  const ax = clamp(b.x + b.width / 2, a.x, a.x + a.width);
  const ay = clamp(b.y + b.height / 2, a.y, a.y + a.height);
  const bx = clamp(ax, b.x, b.x + b.width);
  const by = clamp(ay, b.y, b.y + b.height);
  return [
    { x: clamp(bx, a.x, a.x + a.width), y: clamp(by, a.y, a.y + a.height) },
    { x: bx, y: by }
  ];
};

/** Fillers that join lined-up cards, and the pieces (index lists) the cards fall into. */
const joinCards = (
  cards: readonly Card[],
  foreign: readonly Card[]
): { fillers: Rect[]; pieces: Card[][] } => {
  const parent = cards.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root] ?? root;
    parent[index] = root;
    return root;
  };
  const fillers: Rect[] = [];
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      const a = cards[i];
      const b = cards[j];
      if (!a || !b) continue;
      if (rectGap(a, b) === 0) {
        parent[find(i)] = find(j);
        continue;
      }
      const filler = fillerBetween(a, b);
      if (!filler) continue;
      if (cards.some((card, k) => k !== i && k !== j && rectsOverlap(card, filler))) continue;
      const guard = grow(filler, 4);
      if (foreign.some((card) => rectsOverlap(card, guard))) continue;
      fillers.push(filler);
      parent[find(i)] = find(j);
    }
  }
  const pieces = new Map<number, Card[]>();
  cards.forEach((card, index) => {
    const root = find(index);
    pieces.set(root, [...(pieces.get(root) ?? []), card]);
  });
  return { fillers, pieces: [...pieces.values()] };
};

type Link = { gap: number; from: Card; to: Card };

/**
 * Prim's minimum spanning tree over pieces, joined at their closest card edges. Each piece outside
 * the tree keeps its nearest link into it, and only the piece that just joined is measured against
 * the rest, so every pair of cards is measured once. Rescanning the whole tree on every join was
 * cubic and stalled drags of widely scattered Groups.
 */
const tethersBetween = (pieces: readonly (readonly Card[])[]): [Point, Point][] => {
  const tethers: [Point, Point][] = [];
  const nearest: (Link | undefined)[] = [];
  const joined = pieces.map((_, index) => index === 0);
  let latest = pieces[0] ?? [];
  for (let step = 1; step < pieces.length; step += 1) {
    let next = -1;
    for (let index = 1; index < pieces.length; index += 1) {
      const piece = pieces[index];
      if (!piece || joined[index]) continue;
      let link = nearest[index];
      for (const from of latest) {
        for (const to of piece) {
          const gap = rectGap(from, to);
          if (!link || gap < link.gap) link = { gap, from, to };
        }
      }
      nearest[index] = link;
      if (link && link.gap < (nearest[next]?.gap ?? Infinity)) next = index;
    }
    const link = nearest[next];
    if (!link) break;
    joined[next] = true;
    latest = pieces[next] ?? [];
    tethers.push(closestPoints(link.from, link.to));
  }
  return tethers;
};

const boundsOf = (rects: readonly Rect[]): Rect => {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const titleAnchorFor = (
  outline: readonly (readonly Point[])[],
  group: Rect,
  pad: number
): Point => {
  const above = outline
    .flat()
    .filter((p) => p.x >= group.x - pad && p.x <= group.x + group.width && p.y <= group.y);
  const top = above.length > 0 ? Math.max(...above.map((p) => p.y)) : group.y - pad;
  return { x: group.x - pad, y: Math.min(top, group.y - pad) };
};

/** The Group's cards, padded, as plain rectangles: its region when the full one cannot be drawn. */
const paddedCardsRegion = (
  groupId: string,
  level: number,
  groupCard: Card,
  regionCards: readonly Card[],
  pad: number
): GroupRegion => {
  const outline = regionCards.map((card) => {
    const { x, y, width, height } = grow(card, pad);
    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height }
    ];
  });
  return {
    groupId,
    level,
    outline,
    tethers: [],
    titleAnchor: titleAnchorFor(outline, groupCard, pad)
  };
};

const isFinitePoint = ({ x, y }: Point): boolean => Number.isFinite(x) && Number.isFinite(y);

let reported = false;

/**
 * The region `draw` makes, or null when it throws or has a point that is not finite. Positions are
 * only required to be finite, so cards saved absurdly far apart can overflow the geometry (Clipper
 * throws once a Group spans about 9e13 px); one such Group must not take the canvas down with it.
 * Reported once, in development only.
 */
const drawnSafely = (groupId: string, draw: () => GroupRegion): GroupRegion | null => {
  let problem: unknown;
  try {
    const region = draw();
    const drawable =
      region.outline.every((loop) => loop.every(isFinitePoint)) &&
      region.tethers.every((tether) => tether.every(isFinitePoint)) &&
      isFinitePoint(region.titleAnchor);
    if (drawable) return region;
    problem = 'a point that is not finite';
  } catch (error) {
    problem = error;
  }
  if (import.meta.env.DEV && !reported) {
    reported = true;
    console.warn(`Group region ${groupId} could not be drawn; it falls back.`, problem);
  }
  return null;
};

/**
 * Each rectangle once, first seen first. Fillers are kept this way: a region finds the fillers of
 * the Groups inside it again, between the same cards, and inherits them through every Group in
 * between, so kept as plain lists they doubled with each level of nesting. Numbers print exactly,
 * so only equal rectangles share a place.
 */
const eachOnce = (rects: readonly Rect[]): Rect[] => {
  const byPlace = new Map<string, Rect>();
  for (const rect of rects) {
    const place = `${rect.x} ${rect.y} ${rect.width} ${rect.height}`;
    if (!byPlace.has(place)) byPlace.set(place, rect);
  }
  return [...byPlace.values()];
};

/**
 * Everything a region is drawn from. drawRegion is a pure function of it, so its exact serialization
 * is the region's cache key: a new input can only reach the region through this type, and with it
 * the key.
 */
type RegionInput = {
  groupId: string;
  level: number;
  /** The Group card, then every card that is part of it. */
  own: readonly [Card, ...Card[]];
  foreign: readonly Card[];
  /**
   * Fillers of its member Groups, each once. Theirs hold the fillers of the Groups inside them, so
   * every inner Group keeps its parts joined in this region.
   */
  inherited: readonly Rect[];
};

/** `region` is null when not even the Group's padded cards can be drawn. */
type DrawnRegion = {
  /** This region's fillers and those it inherited, each once, for the Groups it is inside. */
  fillers: readonly Rect[];
  region: GroupRegion | null;
};

const drawRegion = ({ groupId, level, own, foreign, inherited }: RegionInput): DrawnRegion => {
  const [groupCard] = own;
  const pad = padFor(level);
  const { fillers, pieces } = joinCards(own, foreign);
  const allFillers = eachOnce([...fillers, ...inherited]);
  const joined = pieces.filter((piece) => piece.length > 1).flat();
  const region =
    drawnSafely(groupId, () => {
      const outline = composeRegion({ joined: [...joined, ...allFillers], own, foreign, pad });
      return {
        groupId,
        level,
        outline,
        tethers: pieces.length > 1 ? tethersBetween(pieces) : [],
        titleAnchor: titleAnchorFor(outline, groupCard, pad)
      };
    }) ?? drawnSafely(groupId, () => paddedCardsRegion(groupId, level, groupCard, own, pad));
  return { fillers: allFillers, region };
};

/**
 * Regions keyed by Group id, each with the key of the input it was drawn from. A drag moves one
 * card, so most regions are unchanged between frames and are reused.
 */
export type GroupRegionCache = Map<string, DrawnRegion & { key: string }>;
export const createGroupRegionCache = (): GroupRegionCache => new Map();

const NOTHING_MOVING: ReadonlySet<string> = new Set();

/** The Project's Groups and its Member of relationships; regions are drawn for these Groups. */
export type GroupMembership = {
  groupIds: Iterable<string>;
  memberships: readonly Membership[];
};

/**
 * A Group region for every Group card on the canvas, outermost first so inner regions paint on
 * top. A Group with no part on the canvas still gets a region around its own card, so it keeps its
 * overview title. Memberships whose cards are not both on the canvas are ignored.
 *
 * `moving` holds cards being dragged. Regions holding one follow it; other regions ignore it rather
 * than carve around it on every frame, so they stay cached until drop.
 */
export const groupRegions = (
  cards: ReadonlyMap<string, Card>,
  { groupIds, memberships }: GroupMembership,
  {
    cache = createGroupRegionCache(),
    moving = NOTHING_MOVING
  }: { cache?: GroupRegionCache; moving?: ReadonlySet<string> } = {}
): GroupRegion[] => {
  const members = new Map<string, string[]>();
  for (const groupId of groupIds) if (cards.has(groupId)) members.set(groupId, []);
  for (const { memberId, groupId } of memberships) {
    const parts = members.get(groupId);
    if (parts && cards.has(memberId) && memberId !== groupId) parts.push(memberId);
  }
  const levels = new Map<string, number>();
  const levelOf = (groupId: string, trail: ReadonlySet<string>): number => {
    const known = levels.get(groupId);
    if (known !== undefined) return known;
    // Membership is acyclic by contract; the trail only keeps a bad projection from recursing.
    if (trail.has(groupId)) return 0;
    const nextTrail = new Set(trail).add(groupId);
    let level = 0;
    for (const memberId of members.get(groupId) ?? []) {
      if (members.has(memberId)) level = Math.max(level, levelOf(memberId, nextTrail) + 1);
    }
    levels.set(groupId, level);
    return level;
  };
  const descendants = (groupId: string): Set<string> => {
    const found = new Set<string>();
    const pending = [groupId];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) continue;
      for (const memberId of members.get(current) ?? []) {
        if (found.has(memberId) || memberId === groupId) continue;
        found.add(memberId);
        pending.push(memberId);
      }
    }
    return found;
  };

  // Inner Groups first: a region inherits its member Groups' fillers.
  const innerFirst = [...members.keys()].sort(
    (a, b) => levelOf(a, new Set()) - levelOf(b, new Set())
  );
  const fillersByGroup = new Map<string, readonly Rect[]>();
  const allCards = [...cards.values()];
  const regions: GroupRegion[] = [];

  for (const groupId of innerFirst) {
    const groupCard = cards.get(groupId);
    if (!groupCard) continue;
    const level = levelOf(groupId, new Set());
    const pad = padFor(level);
    const inside = descendants(groupId);
    const memberGroups = (members.get(groupId) ?? []).filter((id) => members.has(id));
    const regionCards: RegionInput['own'] = [
      groupCard,
      ...[...inside].flatMap((id) => cards.get(id) ?? [])
    ];
    // Foreign cards the region could reach: it draws no more than its padding past its cards and
    // fillers, and a corner bridge sticks out less than CORNER_BRIDGE past the cards.
    const bounds = grow(boundsOf(regionCards), pad + CORNER_BRIDGE + FOREIGN_MARGIN);
    const foreign = allCards.filter(
      (card) =>
        card.id !== groupId &&
        !inside.has(card.id) &&
        !moving.has(card.id) &&
        rectGap(card, bounds) === 0
    );

    const input: RegionInput = {
      groupId,
      level,
      own: regionCards,
      foreign,
      inherited: eachOnce(memberGroups.flatMap((id) => fillersByGroup.get(id) ?? []))
    };
    // Exact, not rounded: a region holds its cards only to CONTAINMENT_TOLERANCE_PX, so even a
    // fraction of a pixel must redraw it. JSON writes every finite number exactly, and it snapshots
    // the input, so a card changed in place later still misses.
    const key = JSON.stringify(input);
    let drawn = cache.get(groupId);
    if (drawn?.key !== key) {
      drawn = { key, ...drawRegion(input) };
      cache.set(groupId, drawn);
    }
    fillersByGroup.set(groupId, drawn.fillers);
    if (drawn.region) regions.push(drawn.region);
  }
  for (const groupId of cache.keys()) if (!members.has(groupId)) cache.delete(groupId);
  return regions.sort((a, b) => b.level - a.level);
};
