import {
  relationshipEndpointIds,
  type ProjectedRelationship,
  type RelationshipKind
} from '@n2/contracts';
import { Position } from '@xyflow/react';
import { N2_NODE_HEIGHT, N2_NODE_WIDTH } from './nodeGeometry.js';

const EDGE_LANE_GAP = 32;
const ENDPOINT_CLEARANCE = 20;
const HORIZONTAL_CORRIDOR_CLEARANCE = 24;
const VERTICAL_CORRIDOR_CLEARANCE = 72;
const CORNER_RADIUS = 18;

const relationshipKindOrder: Record<RelationshipKind, number> = {
  member_of: 0,
  depends_on: 1
};

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const endpointPairKey = (relationship: ProjectedRelationship): string => {
  const { objectId, subjectId } = relationshipEndpointIds(relationship);
  return JSON.stringify(subjectId < objectId ? [subjectId, objectId] : [objectId, subjectId]);
};

const compareRelationships = (
  left: ProjectedRelationship,
  right: ProjectedRelationship
): number => {
  const kindDifference = relationshipKindOrder[left.kind] - relationshipKindOrder[right.kind];
  if (kindDifference !== 0) return kindDifference;

  const leftEndpoints = relationshipEndpointIds(left);
  const rightEndpoints = relationshipEndpointIds(right);
  return (
    compareText(leftEndpoints.subjectId, rightEndpoints.subjectId) ||
    compareText(leftEndpoints.objectId, rightEndpoints.objectId) ||
    compareText(left.id, right.id)
  );
};

export const relationshipLanes = (
  relationships: readonly ProjectedRelationship[]
): ReadonlyMap<string, number> => {
  const relationshipsByPair = new Map<string, ProjectedRelationship[]>();
  for (const relationship of relationships) {
    const pairKey = endpointPairKey(relationship);
    const pair = relationshipsByPair.get(pairKey) ?? [];
    pair.push(relationship);
    relationshipsByPair.set(pairKey, pair);
  }

  const lanes = new Map<string, number>();
  for (const pair of relationshipsByPair.values()) {
    const orderedPair = pair.toSorted(compareRelationships);
    orderedPair.forEach((relationship, index) => {
      const lane =
        orderedPair.length === 1 ? 0 : index % 2 === 0 ? -(index / 2 + 1) : (index + 1) / 2;
      lanes.set(relationship.id, lane);
    });
  }
  return lanes;
};

export type EdgeRoutePoint = { x: number; y: number };
type Point = EdgeRoutePoint;
type Rectangle = { bottom: number; left: number; right: number; top: number };

const nodeBounds = (center: Point): Rectangle => ({
  bottom: center.y + N2_NODE_HEIGHT / 2,
  left: center.x - N2_NODE_WIDTH / 2,
  right: center.x + N2_NODE_WIDTH / 2,
  top: center.y - N2_NODE_HEIGHT / 2
});

const nodeCenterFromHandle = (handle: Point, position: Position): Point => {
  switch (position) {
    case Position.Left:
      return { x: handle.x + N2_NODE_WIDTH / 2, y: handle.y };
    case Position.Right:
      return { x: handle.x - N2_NODE_WIDTH / 2, y: handle.y };
    case Position.Top:
      return { x: handle.x, y: handle.y + N2_NODE_HEIGHT / 2 };
    case Position.Bottom:
      return { x: handle.x, y: handle.y - N2_NODE_HEIGHT / 2 };
  }
};

const outwardVector = (position: Position): Point => {
  switch (position) {
    case Position.Left:
      return { x: -1, y: 0 };
    case Position.Right:
      return { x: 1, y: 0 };
    case Position.Top:
      return { x: 0, y: -1 };
    case Position.Bottom:
      return { x: 0, y: 1 };
  }
};

const endpointAxis = (handle: Point, outward: Point, oppositeNode: Rectangle) => {
  const horizontal = outward.x !== 0;
  const direction = horizontal ? outward.x : outward.y;
  const along = horizontal ? handle.x : handle.y;
  const across = horizontal ? handle.y : handle.x;
  const near = horizontal ? oppositeNode.left : oppositeNode.top;
  const far = horizontal ? oppositeNode.right : oppositeNode.bottom;
  const acrossMin = horizontal ? oppositeNode.top : oppositeNode.left;
  const acrossMax = horizontal ? oppositeNode.bottom : oppositeNode.right;
  const overlapsAcross = across >= acrossMin && across <= acrossMax;
  return { horizontal, direction, along, across, near, far, overlapsAcross };
};

const endpointExit = (handle: Point, outward: Point, oppositeNode: Rectangle): Point => {
  const { horizontal, direction, along, across, near, far, overlapsAcross } = endpointAxis(
    handle,
    outward,
    oppositeNode
  );
  const toPoint = (nextAlong: number): Point =>
    horizontal ? { x: nextAlong, y: across } : { x: across, y: nextAlong };

  if (direction > 0) {
    if (overlapsAcross && near >= along) {
      return toPoint(along + Math.min(ENDPOINT_CLEARANCE, (near - along) / 2));
    }
    if (overlapsAcross && far > along) return handle;
    if (!overlapsAcross && far >= along) return toPoint(far + ENDPOINT_CLEARANCE);
  } else {
    if (overlapsAcross && far <= along) {
      return toPoint(along - Math.min(ENDPOINT_CLEARANCE, (along - far) / 2));
    }
    if (overlapsAcross && near < along) return handle;
    if (!overlapsAcross && near <= along) return toPoint(near - ENDPOINT_CLEARANCE);
  }

  return toPoint(along + direction * ENDPOINT_CLEARANCE);
};

const moveToward = (from: Point, to: Point, distance: number): Point => {
  const delta = { x: to.x - from.x, y: to.y - from.y };
  const length = Math.hypot(delta.x, delta.y);
  if (length === 0) return from;
  const scale = Math.min(distance / length, 0.5);
  return { x: from.x + delta.x * scale, y: from.y + delta.y * scale };
};

const roundedPolylinePath = (points: readonly Point[]): string => {
  const [start, ...rest] = points;
  if (!start) return '';

  let path = `M ${start.x} ${start.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    if (!previous || !corner || !next) continue;
    const before = moveToward(corner, previous, CORNER_RADIUS);
    const after = moveToward(corner, next, CORNER_RADIUS);
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const end = rest.at(-1);
  return end ? `${path} L ${end.x} ${end.y}` : path;
};

export type ParallelRelationshipRouteInput = {
  lane: number;
  sourcePosition: Position;
  sourceX: number;
  sourceY: number;
  targetPosition: Position;
  targetX: number;
  targetY: number;
};

export type ParallelRelationshipRoute = {
  label: EdgeRoutePoint;
  points: readonly EdgeRoutePoint[];
};

export const parallelRelationshipRoute = ({
  lane,
  sourcePosition,
  sourceX,
  sourceY,
  targetPosition,
  targetX,
  targetY
}: ParallelRelationshipRouteInput): ParallelRelationshipRoute | null => {
  if (lane === 0) return null;

  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };
  const sourceCenter = nodeCenterFromHandle(source, sourcePosition);
  const targetCenter = nodeCenterFromHandle(target, targetPosition);
  const sourceOutward = outwardVector(sourcePosition);
  const targetOutward = outwardVector(targetPosition);
  const sourceExit = endpointExit(source, sourceOutward, nodeBounds(targetCenter));
  const targetExit = endpointExit(target, targetOutward, nodeBounds(sourceCenter));
  const horizontalHandles =
    (sourcePosition === Position.Left || sourcePosition === Position.Right) &&
    (targetPosition === Position.Left || targetPosition === Position.Right);
  const verticalHandles =
    (sourcePosition === Position.Top || sourcePosition === Position.Bottom) &&
    (targetPosition === Position.Top || targetPosition === Position.Bottom);
  if (!horizontalHandles && !verticalHandles) return null;

  let points: readonly Point[];
  let label: Point;
  if (horizontalHandles) {
    const laneDistance = HORIZONTAL_CORRIDOR_CLEARANCE + (Math.abs(lane) - 1) * EDGE_LANE_GAP;
    const corridor =
      lane < 0
        ? Math.min(sourceCenter.y, targetCenter.y) - N2_NODE_HEIGHT / 2 - laneDistance
        : Math.max(sourceCenter.y, targetCenter.y) + N2_NODE_HEIGHT / 2 + laneDistance;
    const sourceCorridor = { x: sourceExit.x, y: corridor };
    const targetCorridor = { x: targetExit.x, y: corridor };
    points = [source, sourceExit, sourceCorridor, targetCorridor, targetExit, target];
    label = { x: (sourceCorridor.x + targetCorridor.x) / 2, y: corridor };
  } else {
    const laneDistance = VERTICAL_CORRIDOR_CLEARANCE + (Math.abs(lane) - 1) * EDGE_LANE_GAP;
    const corridor =
      lane < 0
        ? Math.min(sourceCenter.x, targetCenter.x) - N2_NODE_WIDTH / 2 - laneDistance
        : Math.max(sourceCenter.x, targetCenter.x) + N2_NODE_WIDTH / 2 + laneDistance;
    const sourceCorridor = { x: corridor, y: sourceExit.y };
    const targetCorridor = { x: corridor, y: targetExit.y };
    points = [source, sourceExit, sourceCorridor, targetCorridor, targetExit, target];
    label = { x: corridor, y: (sourceCorridor.y + targetCorridor.y) / 2 };
  }

  return { label, points };
};

export const parallelRelationshipPath = (
  input: ParallelRelationshipRouteInput
): [path: string, labelX: number, labelY: number] | null => {
  const route = parallelRelationshipRoute(input);
  return route ? [roundedPolylinePath(route.points), route.label.x, route.label.y] : null;
};
