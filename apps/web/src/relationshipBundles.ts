import type { ProjectedRelationship } from '@n2/contracts';
import {
  borderPoint,
  centerOf,
  formatPoint,
  type Card,
  type Point
} from './groupRegions/shapes.js';

/**
 * Zoomed out, Depends on relationships that run from one Group's work to another's are drawn as one
 * counted bundle; zoomed in, the relationships return. A card's cluster is the Group it is
 * directly part of (the first, when it has several), or the card itself when it is in no Group.
 * Blocking relationships are never bundled: they stay drawn on their own at every zoom.
 */
export type RelationshipBundle = {
  key: string;
  /** Depends on relationships the bundle stands for, by id. */
  relationshipIds: readonly string[];
  /** The cards holding those relationships on each side: dependents, then dependencies. */
  dependentIds: readonly string[];
  dependencyIds: readonly string[];
};

/** Bundles need at least this many relationships; a single one is clearer drawn as itself. */
export const MIN_BUNDLE_SIZE = 2;

export const relationshipBundles = (
  relationships: readonly ProjectedRelationship[],
  cardIds: ReadonlySet<string>
): RelationshipBundle[] => {
  const directGroup = new Map<string, string>();
  for (const relationship of relationships) {
    if (relationship.kind !== 'member_of' || directGroup.has(relationship.memberId)) continue;
    if (cardIds.has(relationship.groupId))
      directGroup.set(relationship.memberId, relationship.groupId);
  }
  const clusterOf = (cardId: string): string => directGroup.get(cardId) ?? cardId;

  const bundles = new Map<
    string,
    { relationshipIds: string[]; dependentIds: Set<string>; dependencyIds: Set<string> }
  >();
  for (const relationship of relationships) {
    if (relationship.kind !== 'depends_on' || relationship.isBlocking) continue;
    const { dependentId, dependencyId } = relationship;
    if (!cardIds.has(dependentId) || !cardIds.has(dependencyId)) continue;
    const from = clusterOf(dependentId);
    const to = clusterOf(dependencyId);
    if (from === to) continue;
    const key = JSON.stringify([from, to]);
    const bundle = bundles.get(key) ?? {
      relationshipIds: [],
      dependentIds: new Set<string>(),
      dependencyIds: new Set<string>()
    };
    bundle.relationshipIds.push(relationship.id);
    bundle.dependentIds.add(dependentId);
    bundle.dependencyIds.add(dependencyId);
    bundles.set(key, bundle);
  }
  return [...bundles]
    .filter(([, bundle]) => bundle.relationshipIds.length >= MIN_BUNDLE_SIZE)
    .map(([key, bundle]) => ({
      key,
      relationshipIds: bundle.relationshipIds,
      dependentIds: [...bundle.dependentIds],
      dependencyIds: [...bundle.dependencyIds]
    }));
};

export type BundlePath = { key: string; count: number; path: string; label: Point };

const centroid = (cards: readonly Card[]): Point => ({
  x: cards.reduce((sum, card) => sum + centerOf(card).x, 0) / Math.max(1, cards.length),
  y: cards.reduce((sum, card) => sum + centerOf(card).y, 0) / Math.max(1, cards.length)
});

const nearestTo = (cards: readonly Card[], point: Point): Card | undefined => {
  const distance = (card: Card) => {
    const center = centerOf(card);
    return Math.hypot(center.x - point.x, center.y - point.y);
  };
  return cards.reduce<Card | undefined>(
    (best, card) => (!best || distance(card) < distance(best) ? card : best),
    undefined
  );
};

/**
 * Where a bundle is drawn: between the cards that actually hold its relationships, each side
 * picking the card nearest the other side, so bundles sit where the work meets instead of all
 * converging on Group cards. Every bundle bows to its right, so A to B and B to A never overlap.
 */
export const bundlePath = (
  bundle: RelationshipBundle,
  cards: ReadonlyMap<string, Card>
): BundlePath | null => {
  const dependents = bundle.dependentIds.flatMap((id) => cards.get(id) ?? []);
  const dependencies = bundle.dependencyIds.flatMap((id) => cards.get(id) ?? []);
  const from = nearestTo(dependents, centroid(dependencies));
  const to = nearestTo(dependencies, centroid(dependents));
  if (!from || !to) return null;
  const start = centerOf(from);
  const end = centerOf(to);
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const bow = Math.min(160, length * 0.18);
  const control = {
    x: (start.x + end.x) / 2 - ((end.y - start.y) / length) * bow,
    y: (start.y + end.y) / 2 + ((end.x - start.x) / length) * bow
  };
  const a = borderPoint(from, control);
  const b = borderPoint(to, control);
  return {
    key: bundle.key,
    count: bundle.relationshipIds.length,
    path: `M ${formatPoint(a)} Q ${formatPoint(control)} ${formatPoint(b)}`,
    // The quadratic's midpoint, where the count sits.
    label: {
      x: 0.25 * a.x + 0.5 * control.x + 0.25 * b.x,
      y: 0.25 * a.y + 0.5 * control.y + 0.25 * b.y
    }
  };
};
