import type { ProjectedRelationship } from '@n2/contracts';
import { describe, expect, it } from 'vitest';
import type { Card } from './groupRegions/shapes.js';
import { bundlePath, relationshipBundles } from './relationshipBundles.js';

const now = '2026-08-21T12:00:00.000Z';
const partOf = (memberId: string, groupId: string): ProjectedRelationship => ({
  id: `${memberId}-in-${groupId}`,
  kind: 'member_of',
  memberId,
  groupId,
  createdAt: now,
  isBlocking: false
});
const dependsOn = (
  dependentId: string,
  dependencyId: string,
  isBlocking = false
): ProjectedRelationship => ({
  id: `${dependentId}-needs-${dependencyId}`,
  kind: 'depends_on',
  dependentId,
  dependencyId,
  createdAt: now,
  isBlocking
});
const ids = (...values: string[]): ReadonlySet<string> => new Set(values);

// Two Groups with two parts each, and a loose card.
const structure = [partOf('a1', 'A'), partOf('a2', 'A'), partOf('b1', 'B'), partOf('b2', 'B')];
const onCanvas = ids('A', 'a1', 'a2', 'B', 'b1', 'b2', 'loose');

describe('relationshipBundles', () => {
  it('bundles two or more Depends on relationships between the same direct Groups', () => {
    const bundles = relationshipBundles(
      [...structure, dependsOn('a1', 'b1'), dependsOn('a2', 'b1'), dependsOn('b2', 'a1')],
      onCanvas
    );

    expect(bundles).toEqual([
      {
        key: JSON.stringify(['A', 'B']),
        relationshipIds: ['a1-needs-b1', 'a2-needs-b1'],
        dependentIds: ['a1', 'a2'],
        dependencyIds: ['b1']
      }
    ]);
  });

  it('never bundles blocking relationships, links inside one Group, or cards off the canvas', () => {
    const bundles = relationshipBundles(
      [
        ...structure,
        dependsOn('a1', 'b1', true),
        dependsOn('a2', 'b2', true),
        dependsOn('a1', 'a2'),
        dependsOn('a2', 'a1'),
        dependsOn('a1', 'gone'),
        dependsOn('a2', 'gone')
      ],
      onCanvas
    );

    expect(bundles).toEqual([]);
  });

  it('treats a card outside every Group as its own cluster', () => {
    const bundles = relationshipBundles(
      [...structure, dependsOn('loose', 'b1'), dependsOn('loose', 'b2')],
      onCanvas
    );

    expect(bundles.map(({ key }) => key)).toEqual([JSON.stringify(['loose', 'B'])]);
  });

  it('uses the first Group on the canvas as a part’s direct Group', () => {
    const bundles = relationshipBundles(
      [
        partOf('shared', 'hidden-group'),
        partOf('shared', 'A'),
        partOf('b1', 'B'),
        dependsOn('shared', 'b1'),
        dependsOn('A', 'b1')
      ],
      ids('A', 'shared', 'B', 'b1')
    );

    expect(bundles.map(({ key }) => key)).toEqual([JSON.stringify(['A', 'B'])]);
  });
});

describe('bundlePath', () => {
  const card = (id: string, x: number, y: number): Card => ({ id, x, y, width: 200, height: 100 });
  const cards = new Map(
    [card('a1', 0, 0), card('a2', 0, 400), card('b1', 1000, 0)].map((c) => [c.id, c])
  );
  const bundle = {
    key: 'A-B',
    relationshipIds: ['r1', 'r2'],
    dependentIds: ['a1', 'a2'],
    dependencyIds: ['b1']
  };

  it('runs between the nearest cards that hold the relationships, edge to edge', () => {
    const path = bundlePath(bundle, cards);

    expect(path?.count).toBe(2);
    // Starts on a1's right edge (nearest b1) and ends on b1's left edge.
    expect(path?.path).toMatch(/^M 200 /u);
    expect(path?.path).toMatch(/ 1000 [\d.]+$/u);
    expect(path?.label.x).toBeGreaterThan(200);
    expect(path?.label.x).toBeLessThan(1000);
  });

  it('bows A to B and B to A to opposite sides, so they never overlap', () => {
    const forward = bundlePath(bundle, cards);
    const back = bundlePath(
      { ...bundle, dependentIds: ['b1'], dependencyIds: ['a1', 'a2'] },
      cards
    );

    // Both run between a1 and b1, whose centres sit on y = 50; each bows to its own right.
    expect(forward?.label.y).toBeGreaterThan(50);
    expect(back?.label.y).toBeLessThan(50);
  });

  it('is skipped when one side has no card on the canvas', () => {
    expect(bundlePath({ ...bundle, dependencyIds: ['gone'] }, cards)).toBeNull();
  });
});
