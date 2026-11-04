import type { RefObject } from 'react';
import { useNodesInitialized, useReactFlow } from '@xyflow/react';
import { useCanvasFirstFit } from '../useCanvasFirstFit.js';
import { useCanvasFocusRequest, type CanvasFocusRequest } from '../useCanvasFocusRequest.js';
import type { OwnViewportWrite } from '../viewportAuthorship.js';

/**
 * N2's automatic framing, the first fit and the focus request, rendered inside <ReactFlow> so both
 * read the instance from React Flow's store as soon as it exists. `onInit` arrives a timer after
 * the first measurement, so a writer waiting for it could paint an unframed frame, miss the first
 * fit, or drop a request handed to a canvas mounted again after an error.
 */
export function CanvasFraming({
  focusRequest,
  onFocusSettled,
  selectedNodeId,
  canvasWrap,
  freeRegion,
  hasPersonMoved,
  minZoom,
  maxZoom,
  writeOwnViewport
}: {
  focusRequest: CanvasFocusRequest | null;
  onFocusSettled: (request: CanvasFocusRequest) => void;
  selectedNodeId: string | null;
  canvasWrap: RefObject<HTMLElement | null>;
  freeRegion: RefObject<HTMLElement | null>;
  hasPersonMoved: () => boolean;
  minZoom: number;
  maxZoom: number;
  writeOwnViewport: OwnViewportWrite;
}) {
  const flow = useReactFlow();
  useCanvasFirstFit({
    flow,
    measured: useNodesInitialized(),
    canvasWrap,
    // Only a request still to be carried out frames the canvas; a settled one is already gone.
    focusing: focusRequest !== null,
    hasPersonMoved,
    minZoom,
    maxZoom,
    writeOwnViewport
  });
  useCanvasFocusRequest({
    flow,
    request: focusRequest,
    selectedNodeId,
    canvasWrap,
    freeRegion,
    writeOwnViewport,
    onSettled: onFocusSettled
  });
  return null;
}
