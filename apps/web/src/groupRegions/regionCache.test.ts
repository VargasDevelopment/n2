import { describe, expect, it } from 'vitest';
import { createGroupRegionCache, groupRegions, type Membership } from './regions.js';
import {
  card,
  cardsOf,
  groupsOf,
  inside,
  partOf,
  regionFor,
  seeded
} from './regionsTestHarness.js';
import type { Card } from './shapes.js';

describe('groupRegions cache', () => {
  // The cache must never show: whatever the canvas does, a cached pass draws exactly what a fresh
  // one would. Each sequence starts with P holding H, and parts may be in either, so a dragged
  // part is often in an outer Group and foreign to an inner one.
  const GROUPS: readonly string[] = ['P', 'H', 'K'];
  const IDS = [...GROUPS, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  type Scene = {
    cards: ReadonlyMap<string, Card>;
    memberships: readonly Membership[];
    moving: ReadonlySet<string>;
  };
  type Operation = (scene: Scene, random: () => number) => Scene;

  const pick = <T>(items: readonly T[], random: () => number): T | undefined =>
    items[Math.floor(random() * items.length)];
  const placed = (id: string, random: () => number): Card =>
    card(id, random() * 1100, random() * 800);
  // Half the moves are under a pixel, where a key that rounds would miss them.
  const offset = (random: () => number): number => (random() - 0.5) * (random() < 0.5 ? 1 : 300);
  const moved = (cards: ReadonlyMap<string, Card>, id: string, random: () => number) => {
    const target = cards.get(id);
    if (!target) return cards;
    const { x, y } = target;
    return new Map(cards).set(id, { ...target, x: x + offset(random), y: y + offset(random) });
  };
  const isPart = ({ memberships }: Scene, memberId: string, groupId: string): boolean =>
    memberships.some((m) => m.memberId === memberId && m.groupId === groupId);
  /** A Group joins only Groups listed before it, so membership stays acyclic. */
  const mayJoin = (memberId: string, groupId: string): boolean =>
    memberId !== groupId &&
    GROUPS.includes(groupId) &&
    (!GROUPS.includes(memberId) || GROUPS.indexOf(memberId) > GROUPS.indexOf(groupId));
  const unmoving = (scene: Scene): string[] =>
    [...scene.cards.keys()].filter((id) => !scene.moving.has(id));

  const operations = {
    // Starts a drag, half the time of a part of P that is foreign to H, or moves the dragged card.
    drag: (scene, random) => {
      const outerOnly = [...scene.cards.keys()].filter(
        (id) => isPart(scene, id, 'P') && !isPart(scene, id, 'H')
      );
      const candidates = random() < 0.5 ? outerOnly : [...scene.cards.keys()];
      const id = [...scene.moving][0] ?? pick(candidates, random);
      return id
        ? { ...scene, cards: moved(scene.cards, id, random), moving: new Set([id]) }
        : scene;
    },
    drop: (scene) => ({ ...scene, moving: new Set() }),
    // Moved without a drag, as an undo or a sync does.
    place: (scene, random) => {
      const id = pick(unmoving(scene), random);
      return id ? { ...scene, cards: moved(scene.cards, id, random) } : scene;
    },
    join: (scene, random) => {
      const memberId = pick(IDS, random) ?? '';
      const groupId = pick(GROUPS, random) ?? '';
      return mayJoin(memberId, groupId) && !isPart(scene, memberId, groupId)
        ? { ...scene, memberships: [...scene.memberships, partOf(memberId, groupId)] }
        : scene;
    },
    leave: (scene, random) => {
      const gone = pick(scene.memberships, random);
      return { ...scene, memberships: scene.memberships.filter((m) => m !== gone) };
    },
    add: (scene, random) => {
      const id = pick(
        IDS.filter((key) => !scene.cards.has(key)),
        random
      );
      return id ? { ...scene, cards: new Map(scene.cards).set(id, placed(id, random)) } : scene;
    },
    remove: (scene, random) => {
      const id = pick(unmoving(scene), random);
      if (!id) return scene;
      const cards = new Map(scene.cards);
      cards.delete(id);
      return { ...scene, cards };
    }
  } satisfies Record<string, Operation>;
  type OperationName = keyof typeof operations;
  const deck: readonly OperationName[] = [
    'drag',
    'drag',
    'drag',
    'drop',
    'drop',
    'drop',
    'place',
    'place',
    'join',
    'leave',
    'add',
    'remove'
  ];

  const sceneFrom = (random: () => number): Scene => {
    const odds: Record<string, number> = { P: 0.7, H: 0.5, K: 0.3 };
    const memberships = [partOf('H', 'P')];
    if (random() < 0.5) memberships.push(partOf('K', random() < 0.5 ? 'P' : 'H'));
    for (const id of IDS.slice(GROUPS.length)) {
      for (const groupId of GROUPS) {
        if (random() < (odds[groupId] ?? 0)) memberships.push(partOf(id, groupId));
      }
    }
    return {
      cards: cardsOf(...IDS.map((id) => placed(id, random))),
      memberships,
      moving: new Set()
    };
  };

  // About 2,000 passes: a few seconds on a busy machine, past the default timeout.
  it('draws exactly what a fresh pass would, through drags, drops, edits and nesting', () => {
    const stale: string[] = [];
    for (let seed = 1; seed <= 32; seed += 1) {
      const random = seeded(seed);
      const cache = createGroupRegionCache();
      let scene = sceneFrom(random);
      for (let step = 0; step < 30; step += 1) {
        const name = pick(deck, random) ?? 'drop';
        scene = operations[name](scene, random);
        const groups = { groupIds: GROUPS, memberships: scene.memberships };
        const { cards, moving } = scene;
        const cached = groupRegions(cards, groups, { cache, moving });
        const fresh = groupRegions(cards, groups, { moving });
        // JSON writes every number exactly, so this compares every point.
        if (JSON.stringify(cached) !== JSON.stringify(fresh)) {
          stale.push(`seed ${seed}, step ${step}, after ${name}`);
          break;
        }
      }
    }

    expect(stale).toEqual([]);
  }, 20_000);

  it('drops an inner Group filler from the outer region when a dragged part closes it off', () => {
    // x is part of P and foreign to H. Dragged, x is ignored, so H's filler joins H to a past it;
    // dropped, x blocks that filler, and P, whose cards stayed put, must lose it too.
    const groups = groupsOf(partOf('H', 'P'), partOf('x', 'P'), partOf('a', 'H'));
    const cards = cardsOf(
      card('P', -400, -200),
      card('H', 0, 0),
      card('a', 0, 350),
      card('x', -200, 200)
    );
    const cache = createGroupRegionCache();
    groupRegions(cards, groups, { cache, moving: new Set(['x']) });
    const dropped = groupRegions(cards, groups, { cache });

    expect(inside(regionFor(dropped, 'P'), { x: 200, y: 250 })).toBe(false);
    expect(dropped).toEqual(groupRegions(cards, groups));
  });
});
