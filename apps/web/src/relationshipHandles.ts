import type { HandleOrientation } from '@n2/contracts';
import { Position, type NodeHandle } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { N2_NODE_HEIGHT, N2_NODE_WIDTH } from './nodeGeometry.js';

export const RELATIONSHIP_SUBJECT_HANDLE_ID = 'relationship-subject';
export const RELATIONSHIP_OBJECT_HANDLE_ID = 'relationship-object';

const HANDLE_DEPTH = 11;
const HANDLE_LENGTH = 18;

export type RelationshipHandleGeometry = {
  depth: number;
  height: number;
  horizontalCenterY: number;
  length: number;
  width: number;
};

export const DEFAULT_RELATIONSHIP_HANDLE_GEOMETRY: RelationshipHandleGeometry = {
  depth: HANDLE_DEPTH,
  height: N2_NODE_HEIGHT,
  horizontalCenterY: N2_NODE_HEIGHT / 2,
  length: HANDLE_LENGTH,
  width: N2_NODE_WIDTH
};

export const relationshipHandleCssVariables = (
  geometry: Pick<RelationshipHandleGeometry, 'depth' | 'horizontalCenterY' | 'length'>
): CSSProperties =>
  ({
    '--relationship-handle-center-y': `${geometry.horizontalCenterY}px`,
    '--relationship-handle-depth': `${geometry.depth}px`,
    '--relationship-handle-length': `${geometry.length}px`
  }) as CSSProperties;

export const relationshipHandlePlacement = (orientation: HandleOrientation) =>
  orientation === 'horizontal'
    ? {
        subject: { position: Position.Left, side: 'left' as const },
        object: { position: Position.Right, side: 'right' as const }
      }
    : {
        subject: { position: Position.Top, side: 'top' as const },
        object: { position: Position.Bottom, side: 'bottom' as const }
      };

export const relationshipNodeHandles = (
  orientation: HandleOrientation,
  geometry: RelationshipHandleGeometry = DEFAULT_RELATIONSHIP_HANDLE_GEOMETRY
): NodeHandle[] => {
  const placement = relationshipHandlePlacement(orientation);
  const overlap = geometry.depth / 2;
  return orientation === 'horizontal'
    ? [
        {
          id: RELATIONSHIP_SUBJECT_HANDLE_ID,
          type: 'source',
          position: placement.subject.position,
          x: -overlap,
          y: geometry.horizontalCenterY - geometry.length / 2,
          width: geometry.depth,
          height: geometry.length
        },
        {
          id: RELATIONSHIP_OBJECT_HANDLE_ID,
          type: 'target',
          position: placement.object.position,
          x: geometry.width - overlap,
          y: geometry.horizontalCenterY - geometry.length / 2,
          width: geometry.depth,
          height: geometry.length
        }
      ]
    : [
        {
          id: RELATIONSHIP_SUBJECT_HANDLE_ID,
          type: 'source',
          position: placement.subject.position,
          x: (geometry.width - geometry.length) / 2,
          y: -overlap,
          width: geometry.length,
          height: geometry.depth
        },
        {
          id: RELATIONSHIP_OBJECT_HANDLE_ID,
          type: 'target',
          position: placement.object.position,
          x: (geometry.width - geometry.length) / 2,
          y: geometry.height - overlap,
          width: geometry.length,
          height: geometry.depth
        }
      ];
};
