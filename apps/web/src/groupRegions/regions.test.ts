import { describe, expect, it, vi } from 'vitest';
import { ARC_TOLERANCE, FOREIGN_MARGIN, padFor } from './compose.js';
import {
  createGroupRegionCache,
  groupRegions,
  type GroupMembership,
  type GroupRegion,
  type GroupRegionCache,
  type Membership
} from './regions.js';
import {
  card,
  cardsOf,
  groupsOf,
  holds,
  inside,
  partOf,
  regionFor,
  seeded
} from './regionsTestHarness.js';
import {
  centerOf,
  CONTAINMENT_TOLERANCE_PX,
  grow,
  outlinePath,
  rectGap,
  type Card,
  type Point,
  type Rect
} from './shapes.js';

// Counts card-to-card measurements, so the scale test checks growth without timing anything.
vi.mock(import('./shapes.js'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, rectGap: vi.fn(actual.rectGap) };
});

const corners = ({ x, y, width, height }: Card): Point[] => [
  { x, y },
  { x: x + width, y },
  { x, y: y + height },
  { x: x + width, y: y + height }
];

describe('groupRegions', () => {
  it('holds the Group card and every part, as one piece when they line up', () => {
    const cards = cardsOf(card('G', 0, 0), card('m1', 0, 220), card('m2', 290, 220));
    const [region] = groupRegions(cards, groupsOf(partOf('m1', 'G'), partOf('m2', 'G')));

    expect(region?.groupId).toBe('G');
    expect(region?.level).toBe(0);
    expect(region?.tethers).toEqual([]);
    for (const member of cards.values()) {
      for (const point of [centerOf(member), ...corners(member)]) {
        expect(region && inside(region, point), `${member.id} ${point.x},${point.y}`).toBe(true);
      }
    }
  });

  it('never covers a card that is not part of the Group, and tethers the pieces it splits', () => {
    // A foreign card sits between two parts in a row, so the row cannot be joined through it.
    const foreign = card('f', 290, 220);
    const cards = cardsOf(card('G', 0, 0), card('m1', 0, 220), foreign, card('m2', 580, 220));
    const region = regionFor(
      groupRegions(cards, groupsOf(partOf('m1', 'G'), partOf('m2', 'G'))),
      'G'
    );

    for (const point of [centerOf(foreign), ...corners(foreign)]) {
      expect(inside(region, point), `${point.x},${point.y}`).toBe(false);
    }
    expect(inside(region, centerOf(card('m2', 580, 220)))).toBe(true);
    expect(region.tethers).toHaveLength(1);
  });

  it('keeps a hole around a foreign card but fills empty space between parts', () => {
    const ring = [0, 1, 2].flatMap((row) =>
      [0, 1, 2].map((column) => card(`c${row}${column}`, column * 290, 220 + row * 200))
    );
    const memberships = ring.filter(({ id }) => id !== 'c11').map(({ id }) => partOf(id, 'G'));
    const middle = centerOf(card('c11', 290, 420));

    const withForeign = groupRegions(cardsOf(card('G', 0, 0), ...ring), groupsOf(...memberships));
    const withoutForeign = groupRegions(
      cardsOf(card('G', 0, 0), ...ring.filter(({ id }) => id !== 'c11')),
      groupsOf(...memberships)
    );

    expect(inside(regionFor(withForeign, 'G'), middle)).toBe(false);
    expect(inside(regionFor(withoutForeign, 'G'), middle)).toBe(true);
  });

  it('nests: an outer Group pads wider, holds its inner Group, and paints first', () => {
    const cards = cardsOf(
      card('outer', 0, 0),
      card('inner', 0, 240),
      card('task', 0, 460),
      card('sibling', 290, 240)
    );
    const regions = groupRegions(
      cards,
      groupsOf(partOf('inner', 'outer'), partOf('sibling', 'outer'), partOf('task', 'inner'))
    );

    expect(regions.map(({ groupId, level }) => [groupId, level])).toEqual([
      ['outer', 1],
      ['inner', 0]
    ]);
    const outer = regionFor(regions, 'outer');
    // The inner region's padding stays inside the outer one.
    const task = cards.get('task');
    expect(task && inside(outer, { x: task.x - 20, y: task.y + task.height + 20 })).toBe(true);
    expect(inside(regionFor(regions, 'inner'), centerOf(card('sibling', 290, 240)))).toBe(false);
  });

  it('ignores memberships whose cards are not both on the canvas', () => {
    const cards = cardsOf(card('G', 0, 0), card('m1', 0, 220));
    const regions = groupRegions(
      cards,
      groupsOf(partOf('m1', 'G'), partOf('gone', 'G'), partOf('m1', 'hidden-group'))
    );

    expect(regions.map(({ groupId }) => groupId)).toEqual(['G']);
  });

  it('gives a Group with no part on the canvas a region around its own card', () => {
    const group = card('G', 0, 0);
    const regions = groupRegions(cardsOf(group), { groupIds: ['G'], memberships: [] });

    const region = regionFor(regions, 'G');
    expect(region.level).toBe(0);
    for (const point of [centerOf(group), ...corners(group)]) {
      expect(inside(region, point), `${point.x},${point.y}`).toBe(true);
    }
    // The overview title sits on the region edge above the card.
    expect(region.titleAnchor.y).toBeLessThan(group.y);
  });

  it('reuses a region while the cards that shape it keep their places', () => {
    const cache = createGroupRegionCache();
    const groups = groupsOf(partOf('m1', 'G'), partOf('n1', 'H'));
    const base = [card('G', 0, 0), card('m1', 0, 220), card('H', 2000, 0), card('n1', 2000, 220)];
    const [first] = groupRegions(cardsOf(...base), groups, { cache }).filter(
      ({ groupId }) => groupId === 'G'
    );

    // H's part moves far from G: G's region is the same object, H's is rebuilt.
    const movedFar = groupRegions(cardsOf(...base.slice(0, 3), card('n1', 2300, 220)), groups, {
      cache
    });
    expect(regionFor(movedFar, 'G')).toBe(first);

    // G's own part moves: its region is rebuilt.
    const movedNear = groupRegions(
      cardsOf(base[0]!, card('m1', 40, 260), ...base.slice(2)),
      groups,
      { cache }
    );
    expect(regionFor(movedNear, 'G')).not.toBe(first);

    // G leaves the canvas: its cached region goes too.
    groupRegions(cardsOf(...base.slice(1)), groups, { cache });
    expect([...cache.keys()]).toEqual(['H']);
  });

  it('while a card is dragged, only the regions holding it follow, and the rest catch up on drop', () => {
    const cache = createGroupRegionCache();
    const groups = groupsOf(partOf('m1', 'G'), partOf('n1', 'H'));
    const fixed = [card('G', 0, 0), card('H', 600, 0), card('n1', 600, 220)];
    const at = (x: number) => cardsOf(...fixed, card('m1', x, 220));
    const moving = new Set(['m1']);
    const settled = groupRegions(at(0), groups, { cache });

    // m1 is dragged beside n1, inside H's reach: G follows it, H ignores it until the drop.
    const first = groupRegions(at(360), groups, { cache, moving });
    const second = groupRegions(at(380), groups, { cache, moving });
    expect(regionFor(first, 'H')).toBe(regionFor(settled, 'H'));
    expect(regionFor(second, 'H')).toBe(regionFor(settled, 'H'));
    expect(regionFor(second, 'G')).not.toBe(regionFor(first, 'G'));
    expect(inside(regionFor(second, 'G'), centerOf(card('m1', 380, 220)))).toBe(true);
    // A point of m1 within H's padding: H does not carve around the card while it moves.
    const overlap = { x: 595, y: 300 };
    expect(inside(regionFor(second, 'H'), overlap)).toBe(true);

    // Dropped there: H carves around the foreign card again, and G, already drawn for that place,
    // is reused.
    const dropped = groupRegions(at(380), groups, { cache });
    expect(regionFor(dropped, 'H')).not.toBe(regionFor(settled, 'H'));
    expect(regionFor(dropped, 'G')).toBe(regionFor(second, 'G'));
    expect(inside(regionFor(dropped, 'H'), overlap)).toBe(false);
  });
});

describe('groupRegions edges', () => {
  // The rules in compose.ts, checked against the SVG path the canvas draws, through the region
  // cache. Points within CONTAINMENT_TOLERANCE_PX of the edge that bounds their rule are skipped,
  // as the contract allows, and padded corners may round out a further ARC_TOLERANCE into a
  // margin.
  const TOLERANCE = CONTAINMENT_TOLERANCE_PX;
  const CORNER = ARC_TOLERANCE + CONTAINMENT_TOLERANCE_PX;
  type Rule = 'own card' | 'foreign card' | 'own padding' | 'foreign margin';
  type Layout = { cards: ReadonlyMap<string, Card>; groups: GroupMembership };
  type Options = Parameters<typeof groupRegions>[2];

  /** The region as the canvas draws it: its SVG path, read back into loops. */
  const drawn = (region: GroupRegion): Point[][] =>
    outlinePath(region.outline)
      .split('Z')
      .map((loop) => loop.trim())
      .filter((loop) => loop.length > 0)
      .map((loop) =>
        loop
          .slice(1)
          .split('L')
          .map((pair) => {
            const [x = NaN, y = NaN] = pair.trim().split(' ').map(Number);
            return { x, y };
          })
      );
  const drawnG = (cards: ReadonlyMap<string, Card>, groups: GroupMembership, options?: Options) =>
    drawn(regionFor(groupRegions(cards, groups, options), 'G'));

  /** Distance from a point to a rectangle, negative inside by the distance to its nearest side. */
  const signedDistance = (p: Point, r: Rect): number => {
    const dx = Math.max(r.x - p.x, p.x - (r.x + r.width));
    const dy = Math.max(r.y - p.y, p.y - (r.y + r.height));
    return dx <= 0 && dy <= 0 ? Math.max(dx, dy) : Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  };

  /** The rule that decides a point, earliest first, and whether it puts the point inside. */
  const ruleAt = (
    point: Point,
    own: readonly Card[],
    foreign: readonly Card[],
    pad: number
  ): [Rule, boolean] | undefined => {
    const toOwn = Math.min(...own.map((c) => signedDistance(point, c)));
    const toForeign = Math.min(Infinity, ...foreign.map((c) => signedDistance(point, c)));
    if (toOwn < -TOLERANCE) return ['own card', true];
    if (toForeign < -TOLERANCE && toOwn > TOLERANCE) return ['foreign card', false];
    if (toOwn < pad - TOLERANCE && toForeign > TOLERANCE) return ['own padding', true];
    if (toForeign < FOREIGN_MARGIN - TOLERANCE && toOwn > pad + CORNER) {
      return ['foreign margin', false];
    }
    return undefined;
  };

  /**
   * Twelve cards on a jittered grid with gaps from a small overlap to just past the padding plus
   * the margin. G holds the Group H, a Task may be part of both H and K, and some layouts send one
   * of H's parts 8000 px away so the Groups span far.
   */
  const layoutFrom = (random: () => number): Layout => {
    const cards: Card[] = [];
    let y = 0;
    for (let row = 0; row < 3; row += 1) {
      let x = 0;
      for (let column = 0; column < 4; column += 1) {
        const jitter = () => (random() - 0.5) * 12;
        cards.push(card(`c${row * 4 + column}`, x + jitter(), y + jitter()));
        x += 230 + random() * 70 - 6;
      }
      y += 140 + random() * 70 - 6;
    }
    if (random() < 0.4) cards.push(card('far', 8000 + random() * 50, 8000));
    const memberships = [partOf('c1', 'c0')];
    for (const { id } of cards.slice(3)) {
      const roll = random();
      if (id === 'far' || roll < 0.25) memberships.push(partOf(id, 'c1'));
      else if (roll < 0.45) memberships.push(partOf(id, 'c0'));
      else if (roll < 0.65) memberships.push(partOf(id, 'c2'));
      if (roll < 0.1) memberships.push(partOf(id, 'c2'));
    }
    return { cards: cardsOf(...cards), groups: { groupIds: ['c0', 'c1', 'c2'], memberships } };
  };

  /** `count` points within a pixel of `by` out from the sides of `rect`. */
  const nearEdges = (rect: Rect, by: number, count: number, random: () => number): Point[] =>
    Array.from({ length: count }, () => {
      const along = random();
      const out = by + random() * 2 - 1;
      const { x, y, width, height } = rect;
      const side = Math.floor(random() * 4);
      if (side === 0) return { x: x + along * width, y: y - out };
      if (side === 1) return { x: x + width + out, y: y + along * height };
      if (side === 2) return { x: x + along * width, y: y + height + out };
      return { x: x - out, y: y + along * height };
    });

  /** Every sample point whose rule the drawn regions break. */
  const brokenRules = (
    { cards, groups }: Layout,
    {
      cache,
      moving = new Set<string>()
    }: { cache: GroupRegionCache; moving?: ReadonlySet<string> },
    random: () => number,
    tally: Map<Rule, number>
  ): string[] => {
    const broken: string[] = [];
    for (const region of groupRegions(cards, groups, { cache, moving })) {
      const ownIds = new Set([region.groupId]);
      for (let size = 0; size !== ownIds.size;) {
        size = ownIds.size;
        for (const { memberId, groupId } of groups.memberships) {
          if (ownIds.has(groupId)) ownIds.add(memberId);
        }
      }
      const own = [...cards.values()].filter(({ id }) => ownIds.has(id));
      const foreign = [...cards.values()].filter(({ id }) => !ownIds.has(id) && !moving.has(id));
      const pad = padFor(region.level);
      const loops = drawn(region);
      // Points across each card and its padding or margin, and as many again within a pixel of the
      // edges that bound the rules, where rounding would show.
      const points = [
        ...[
          ...own.map((c) => grow(c, pad + 2)),
          ...foreign.map((c) => grow(c, FOREIGN_MARGIN + 2))
        ].flatMap((area) =>
          Array.from({ length: 24 }, () => ({
            x: area.x + random() * area.width,
            y: area.y + random() * area.height
          }))
        ),
        ...own.flatMap((c) => [0, pad].flatMap((by) => nearEdges(c, by, 12, random))),
        ...foreign.flatMap((c) => [0, FOREIGN_MARGIN].flatMap((by) => nearEdges(c, by, 12, random)))
      ];
      for (const point of points) {
        const decided = ruleAt(point, own, foreign, pad);
        if (!decided) continue;
        const [rule, held] = decided;
        tally.set(rule, (tally.get(rule) ?? 0) + 1);
        if (holds(loops, point) !== held) {
          const mode = moving.size > 0 ? 'mid-drag' : 'settled';
          broken.push(`${mode} ${region.groupId} ${rule} ${point.x},${point.y}`);
        }
      }
    }
    return broken;
  };

  /**
   * The layout settled, then nudged a few times by under a pixel each way with one cache, as the
   * canvas keeps it. A nudge is either dragged, checked mid-drag and again on drop, or placed
   * directly, as an undo or a sync would, which meets the regions cached for the card's old place.
   */
  const brokenAcrossNudges = (
    layout: Layout,
    random: () => number,
    tally: Map<Rule, number>
  ): string[] => {
    const cache = createGroupRegionCache();
    const broken = brokenRules(layout, { cache }, random, tally);
    let { cards } = layout;
    for (let step = 0; step < 4; step += 1) {
      const ids = [...cards.keys()];
      const nudged = cards.get(ids[Math.floor(random() * ids.length)] ?? '');
      if (!nudged) continue;
      cards = new Map(cards).set(nudged.id, {
        ...nudged,
        x: nudged.x + random() * 2 - 1,
        y: nudged.y + random() * 2 - 1
      });
      const steps =
        random() < 0.5 ? [new Set([nudged.id]), new Set<string>()] : [new Set<string>()];
      for (const moving of steps) {
        broken.push(...brokenRules({ ...layout, cards }, { cache, moving }, random, tally));
      }
    }
    return broken;
  };

  it('holds own cards and their padding, and no foreign card or its margin, as drawn', () => {
    const random = seeded(24);
    const tally = new Map<Rule, number>();
    const broken = Array.from({ length: 24 }, () => layoutFrom(random)).flatMap((layout) =>
      brokenAcrossNudges(layout, random, tally)
    );

    expect(broken.length, broken.slice(0, 5).join('\n')).toBe(0);
    // Every rule decided many points, so the layouts reach each of them.
    for (const rule of ['own card', 'foreign card', 'own padding', 'foreign margin'] as const) {
      expect(tally.get(rule) ?? 0, rule).toBeGreaterThan(100);
    }
  });

  it('keeps a foreign card out of the padding of a widely spread Group', () => {
    // When the soft area was rasterised, the part 8000 px away made its cells wider than the
    // padding and the margin, and the region covered the foreign card 5 px from G.
    const layout: Layout = {
      cards: cardsOf(
        card('G', 0, 0),
        card('m1', 0, 300),
        card('m2', 8000, 8000),
        card('f', 235, 0)
      ),
      groups: groupsOf(partOf('m1', 'G'), partOf('m2', 'G'))
    };

    for (const moving of [new Set<string>(), new Set(['m2'])]) {
      const cache = createGroupRegionCache();
      expect(brokenRules(layout, { cache, moving }, seeded(1), new Map())).toEqual([]);
      const area = drawnG(layout.cards, layout.groups, { cache, moving });
      expect(holds(area, { x: 239, y: 51 })).toBe(false);
    }
  });

  it('keeps all of the Group card when a foreign card sits beside it', () => {
    // When the soft area was rasterised, rounding the foreign card out to coarse cells carved
    // 20 px into G's own card.
    const layout: Layout = {
      cards: cardsOf(card('G', 0, 0), card('m', 8000, 8000), card('f', 250, 0)),
      groups: groupsOf(partOf('m', 'G'))
    };

    for (const moving of [new Set<string>(), new Set(['m'])]) {
      const cache = createGroupRegionCache();
      expect(brokenRules(layout, { cache, moving }, seeded(2), new Map())).toEqual([]);
      const area = drawnG(layout.cards, layout.groups, { cache, moving });
      expect(holds(area, { x: 220, y: 70 })).toBe(true);
    }
  });

  it('keeps out a foreign card within the tolerance of where it is drawn', () => {
    // The path is written to tenths, so f's edge at 238.06 is drawn at 238.1: a point 0.02 px
    // inside f may be covered, as the tolerance allows, but not one 0.2 px inside.
    const cards = cardsOf(card('G', 0, 0), card('m', 8000, 8000), card('f', 238.06, 0));

    expect(holds(drawnG(cards, groupsOf(partOf('m', 'G'))), { x: 238.26, y: 70 })).toBe(false);
  });

  it('redraws a region when a foreign card moves a fraction of a pixel', () => {
    // The cache once keyed on whole pixels, so moving f from 238.04 to 237.64 reused the region
    // cut around f's old edge and covered 0.4 px of it.
    const groups = groupsOf(partOf('m', 'G'));
    const cache = createGroupRegionCache();
    const withF = (x: number) => cardsOf(card('G', 0, 0), card('m', 8000, 8000), card('f', x, 0));
    drawnG(withF(238.04), groups, { cache });

    expect(holds(drawnG(withF(237.64), groups, { cache }), { x: 237.8, y: 70 })).toBe(false);
  });

  it('draws the full region again once a Group that fell back can be drawn', () => {
    // Adjacent doubles either side of where Clipper overflows, so a cache keyed on whole pixels
    // kept the fallback after the part moved back within reach.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const groups = groupsOf(partOf('m', 'G'));
    const cache = createGroupRegionCache();
    const withM = (x: number) => cardsOf(card('G', 0, 0), card('m', x, 0));
    // Inside G's padded rectangle, but outside its round corner.
    const corner = { x: -15, y: -15 };

    expect(holds(drawnG(withM(90071992547163.92), groups, { cache }), corner)).toBe(true);
    expect(holds(drawnG(withM(90071992547163.9), groups, { cache }), corner)).toBe(false);
    warn.mockRestore();
  });

  it('draws the full region for a Group saved far from the origin', () => {
    // Clipper scales coordinates to integers, and 1e14 px overflowed them until regions were
    // composed relative to their own cards.
    const group = card('G', 1e14, 1e14);
    const area = drawnG(cardsOf(group), { groupIds: ['G'], memberships: [] });

    expect(holds(area, centerOf(group))).toBe(true);
    // The padded corner is round, unlike the plain rectangles a region falls back to.
    expect(holds(area, { x: group.x - 15, y: group.y - 15 })).toBe(false);
  });
});

describe('groupRegions scale', () => {
  it('measures each pair of cards about once while a widely scattered Group is dragged', () => {
    // 335 cards too far apart to join, so 335 pieces to tether. Rescanning the whole tree on each
    // join measured about n³/6 pairs (6 million); each pair once is about n²/2 here.
    const scattered = Array.from({ length: 335 }, (_, index) =>
      card(index === 0 ? 'G' : `m${index}`, (index % 20) * 850, Math.floor(index / 20) * 850)
    );
    const groups = groupsOf(...scattered.slice(1).map(({ id }) => partOf(id, 'G')));
    const cache = createGroupRegionCache();
    groupRegions(cardsOf(...scattered), groups, { cache });

    const dragged = scattered.map((c) => (c.id === 'm1' ? { ...c, x: c.x + 40 } : c));
    vi.mocked(rectGap).mockClear();
    const [region] = groupRegions(cardsOf(...dragged), groups, {
      cache,
      moving: new Set(['m1'])
    });

    expect(region?.tethers).toHaveLength(334);
    const n = scattered.length;
    expect(vi.mocked(rectGap).mock.calls.length).toBeLessThan(2 * n * n);
  });

  it('holds each filler once, however deep Groups nest', () => {
    // 14 Group cards in a column, each a member of the one above, so 13 fillers in all. Every
    // region finds those below it again and inherits them through each Group in between; kept as
    // plain lists, the outer region held 8,191.
    const chain = Array.from({ length: 14 }, (_, index) => card(`g${index}`, 0, index * 220));
    const memberships = chain.slice(1).map(({ id }, index) => partOf(id, `g${index}`));
    const cache = createGroupRegionCache();
    groupRegions(
      cardsOf(...chain),
      { groupIds: chain.map(({ id }) => id), memberships },
      { cache }
    );

    const fillers = Array.from({ length: 13 }, (_, index): Rect => ({
      x: 0,
      y: index * 220 + 140,
      width: 230,
      height: 80
    }));
    const outer = cache.get('g0');
    expect(outer?.fillers).toHaveLength(13);
    expect(outer?.fillers).toEqual(expect.arrayContaining(fillers));
    // The key is the input's exact JSON, so it shows what the outer region inherited.
    const input: unknown = JSON.parse(outer?.key ?? 'null');
    expect(input).toHaveProperty('inherited.length', 12);
    expect(input).toHaveProperty('inherited', expect.arrayContaining(fillers.slice(1)));
  });
});

describe('groupRegions time budget', () => {
  // About the N² workspace: 84 cards, 18 Groups in two levels. Generous bounds catch a regression
  // by an order of magnitude without failing on a busy machine.
  const workspace = (): { cards: ReadonlyMap<string, Card>; groups: GroupMembership } => {
    const cards: Card[] = [];
    const memberships: Membership[] = [];
    for (let epic = 0; epic < 6; epic += 1) {
      const x0 = epic * 1400;
      cards.push(card(`epic${epic}`, x0, 0));
      for (let feature = 0; feature < 2; feature += 1) {
        const fx = x0 + feature * 680;
        const featureId = `feature${epic}.${feature}`;
        cards.push(card(featureId, fx, 240));
        memberships.push(partOf(featureId, `epic${epic}`));
        for (let task = 0; task < 5; task += 1) {
          const taskId = `task${epic}.${feature}.${task}`;
          cards.push(card(taskId, fx + (task % 2) * 290, 460 + Math.floor(task / 2) * 200));
          memberships.push(partOf(taskId, featureId));
        }
      }
      cards.push(card(`loose${epic}`, x0 + 300, 0));
    }
    return { cards: cardsOf(...cards), groups: groupsOf(...memberships) };
  };

  it('draws every region cold within 1 s and reuses them all within 25 ms', () => {
    const { cards, groups } = workspace();
    expect(cards.size).toBe(84);
    const cache = createGroupRegionCache();

    const coldStart = performance.now();
    const regions = groupRegions(cards, groups, { cache });
    const cold = performance.now() - coldStart;
    const warmStart = performance.now();
    groupRegions(cards, groups, { cache });
    const warm = performance.now() - warmStart;

    expect(regions).toHaveLength(18);
    expect(cold).toBeLessThan(1000);
    expect(warm).toBeLessThan(25);
  });
});
