import type { ProjectedRelationship } from '@n2/contracts';
import { Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import {
  parallelRelationshipPath,
  parallelRelationshipRoute,
  relationshipLanes,
  type EdgeRoutePoint,
  type ParallelRelationshipRouteInput
} from './relationshipEdgeLayout.js';
import { N2_NODE_HEIGHT, N2_NODE_WIDTH } from './nodeGeometry.js';

type Rectangle = { bottom: number; left: number; right: number; top: number };

const HALF_NODE_HEIGHT = N2_NODE_HEIGHT / 2;
const HALF_NODE_WIDTH = N2_NODE_WIDTH / 2;
const HORIZONTAL_CORRIDOR_Y = -(HALF_NODE_HEIGHT + 24);
const VERTICAL_CORRIDOR_X = -(HALF_NODE_WIDTH + 72);
const leftHandle = (centerX: number): number => centerX - HALF_NODE_WIDTH;
const rightHandle = (centerX: number): number => centerX + HALF_NODE_WIDTH;
const topHandle = (centerY: number): number => centerY - HALF_NODE_HEIGHT;
const bottomHandle = (centerY: number): number => centerY + HALF_NODE_HEIGHT;

const bounds = (center: EdgeRoutePoint): Rectangle => ({
  bottom: center.y + HALF_NODE_HEIGHT,
  left: center.x - HALF_NODE_WIDTH,
  right: center.x + HALF_NODE_WIDTH,
  top: center.y - HALF_NODE_HEIGHT
});

const segmentCrossesInterior = (
  start: EdgeRoutePoint,
  end: EdgeRoutePoint,
  rectangle: Rectangle
): boolean => {
  if (start.x === end.x) {
    return (
      start.x > rectangle.left &&
      start.x < rectangle.right &&
      Math.max(Math.min(start.y, end.y), rectangle.top) <
        Math.min(Math.max(start.y, end.y), rectangle.bottom)
    );
  }
  if (start.y === end.y) {
    return (
      start.y > rectangle.top &&
      start.y < rectangle.bottom &&
      Math.max(Math.min(start.x, end.x), rectangle.left) <
        Math.min(Math.max(start.x, end.x), rectangle.right)
    );
  }
  throw new Error('Expected an orthogonal route segment');
};

const expectRouteAvoidsNodes = (
  input: ParallelRelationshipRouteInput,
  centers: readonly EdgeRoutePoint[]
): void => {
  const route = parallelRelationshipRoute(input);
  expect(route).not.toBeNull();
  const rectangles = centers.map(bounds);
  route?.points.slice(1).forEach((end, index) => {
    const start = route.points[index];
    expect(start).toBeDefined();
    if (!start) return;
    rectangles.forEach((rectangle) => {
      expect(segmentCrossesInterior(start, end, rectangle)).toBe(false);
    });
  });
};

const createdAt = '2026-08-21T12:00:00.000Z';
const membership = (memberId = 'a', groupId = 'b'): ProjectedRelationship => ({
  id: 'membership',
  kind: 'member_of',
  memberId,
  groupId,
  createdAt,
  isBlocking: false
});
const dependency = (dependentId = 'a', dependencyId = 'b'): ProjectedRelationship => ({
  id: 'dependency',
  kind: 'depends_on',
  dependentId,
  dependencyId,
  createdAt,
  isBlocking: false
});

describe('relationshipLanes', () => {
  it('leaves an unaccompanied relationship on the default path', () => {
    expect(relationshipLanes([membership()]).get('membership')).toBe(0);
  });

  it('separates parallel relationship kinds deterministically regardless of input order', () => {
    const forward = relationshipLanes([membership(), dependency('b', 'a')]);
    const reversed = relationshipLanes([dependency('b', 'a'), membership()]);

    expect([...forward]).toEqual([
      ['membership', -1],
      ['dependency', 1]
    ]);
    expect([...reversed]).toEqual([...forward]);
  });
});

const verticalPath = (lane: number, reversed = false) =>
  parallelRelationshipPath({
    lane,
    sourcePosition: Position.Left,
    sourceX: leftHandle(0),
    sourceY: reversed ? 200 : 0,
    targetPosition: Position.Right,
    targetX: rightHandle(0),
    targetY: reversed ? 0 : 200
  });

describe('parallelRelationshipPath', () => {
  it('preserves the default path for a relationship without a parallel neighbor', () => {
    expect(verticalPath(0)).toBeNull();
  });

  it('routes steep parallel relationships and their labels outside both node bounds', () => {
    const dependencyPath = verticalPath(-1);

    expect(dependencyPath?.[0]).toContain('Q');
    expect(dependencyPath?.[1]).toBe(0);
    expect(dependencyPath?.[2]).toBe(HORIZONTAL_CORRIDOR_Y);
  });

  it('uses the same physical frame when relationship direction reverses', () => {
    const forwardDependencyPath = verticalPath(-1);
    const reverseDependencyPath = verticalPath(-1, true);

    expect(forwardDependencyPath?.slice(1)).toEqual([0, HORIZONTAL_CORRIDOR_Y]);
    expect(reverseDependencyPath?.slice(1)).toEqual([0, HORIZONTAL_CORRIDOR_Y]);
    expectRouteAvoidsNodes(
      {
        lane: -1,
        sourcePosition: Position.Left,
        sourceX: leftHandle(0),
        sourceY: 0,
        targetPosition: Position.Right,
        targetX: rightHandle(0),
        targetY: 200
      },
      [
        { x: 0, y: 0 },
        { x: 0, y: 200 }
      ]
    );
    expectRouteAvoidsNodes(
      {
        lane: -1,
        sourcePosition: Position.Left,
        sourceX: leftHandle(0),
        sourceY: 200,
        targetPosition: Position.Right,
        targetX: rightHandle(0),
        targetY: 0
      },
      [
        { x: 0, y: 0 },
        { x: 0, y: 200 }
      ]
    );
  });

  it('uses the same corridor for the screenshot topology when the arrow reverses', () => {
    const forward = parallelRelationshipPath({
      lane: -1,
      sourcePosition: Position.Left,
      sourceX: leftHandle(0),
      sourceY: 0,
      targetPosition: Position.Right,
      targetX: rightHandle(300),
      targetY: 0
    });
    const reverse = parallelRelationshipPath({
      lane: -1,
      sourcePosition: Position.Left,
      sourceX: leftHandle(300),
      sourceY: 0,
      targetPosition: Position.Right,
      targetX: rightHandle(0),
      targetY: 0
    });

    expect(forward?.slice(1)).toEqual([150, HORIZONTAL_CORRIDOR_Y]);
    expect(reverse?.slice(1)).toEqual([150, HORIZONTAL_CORRIDOR_Y]);
    expectRouteAvoidsNodes(
      {
        lane: -1,
        sourcePosition: Position.Left,
        sourceX: leftHandle(0),
        sourceY: 0,
        targetPosition: Position.Right,
        targetX: rightHandle(300),
        targetY: 0
      },
      [
        { x: 0, y: 0 },
        { x: 300, y: 0 }
      ]
    );
    expectRouteAvoidsNodes(
      {
        lane: -1,
        sourcePosition: Position.Left,
        sourceX: leftHandle(300),
        sourceY: 0,
        targetPosition: Position.Right,
        targetX: rightHandle(0),
        targetY: 0
      },
      [
        { x: 0, y: 0 },
        { x: 300, y: 0 }
      ]
    );
  });

  it('routes outward-facing horizontal handles around the endpoint rectangles', () => {
    const path = parallelRelationshipPath({
      lane: -1,
      sourcePosition: Position.Left,
      sourceX: leftHandle(0),
      sourceY: 0,
      targetPosition: Position.Right,
      targetX: rightHandle(300),
      targetY: 0
    });

    expect(path?.[1]).toBe(150);
    expect(path?.[2]).toBe(HORIZONTAL_CORRIDOR_Y);
  });

  it('keeps inward-facing exits inside a narrow gap between endpoint rectangles', () => {
    const input = {
      lane: -1,
      sourcePosition: Position.Left,
      sourceX: leftHandle(240),
      sourceY: 0,
      targetPosition: Position.Right,
      targetX: rightHandle(0),
      targetY: 0
    };
    const route = parallelRelationshipRoute(input);

    expect(route?.points[1]).toEqual({ x: 120, y: 0 });
    expect(route?.label).toEqual({ x: 120, y: HORIZONTAL_CORRIDOR_Y });
    expectRouteAvoidsNodes(input, [
      { x: 0, y: 0 },
      { x: 240, y: 0 }
    ]);
  });

  it('routes a diagonal endpoint leg beyond the opposite rectangle before turning', () => {
    const input = {
      lane: -1,
      sourcePosition: Position.Left,
      sourceX: leftHandle(0),
      sourceY: 300,
      targetPosition: Position.Right,
      targetX: rightHandle(-100),
      targetY: 0
    };
    const route = parallelRelationshipRoute(input);

    expect(route?.points[1]).toEqual({ x: leftHandle(-100) - 20, y: 300 });
    expect(route?.label).toEqual({ x: -50, y: HORIZONTAL_CORRIDOR_Y });
    expectRouteAvoidsNodes(input, [
      { x: 0, y: 300 },
      { x: -100, y: 0 }
    ]);
  });

  it('routes vertical-handle diagonal legs beyond the opposite rectangle', () => {
    const input = {
      lane: -1,
      sourcePosition: Position.Top,
      sourceX: 300,
      sourceY: topHandle(0),
      targetPosition: Position.Bottom,
      targetX: 0,
      targetY: bottomHandle(-100)
    };
    const route = parallelRelationshipRoute(input);

    expect(route?.points[1]).toEqual({ x: 300, y: topHandle(-100) - 20 });
    expect(route?.label).toEqual({ x: VERTICAL_CORRIDOR_X, y: -50 });
    expectRouteAvoidsNodes(input, [
      { x: 300, y: 0 },
      { x: 0, y: -100 }
    ]);
  });

  it('reserves the full label width beside vertical-handle endpoint cards', () => {
    const route = parallelRelationshipRoute({
      lane: -1,
      sourcePosition: Position.Top,
      sourceX: 0,
      sourceY: topHandle(0),
      targetPosition: Position.Bottom,
      targetX: 300,
      targetY: bottomHandle(0)
    });

    expect(route?.label.x).toBe(VERTICAL_CORRIDOR_X);
    expect((route?.label.x ?? 0) + 60).toBeLessThanOrEqual(-HALF_NODE_WIDTH - 12);
  });

  it('defers mixed-axis handles to React Flow instead of applying an unsafe route', () => {
    expect(
      parallelRelationshipPath({
        lane: -1,
        sourcePosition: Position.Left,
        sourceX: leftHandle(0),
        sourceY: 0,
        targetPosition: Position.Bottom,
        targetX: 300,
        targetY: bottomHandle(0)
      })
    ).toBeNull();
  });
});
