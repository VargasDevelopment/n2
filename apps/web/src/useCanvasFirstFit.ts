import { getViewportForBounds, type ReactFlowInstance } from '@xyflow/react';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { OwnViewportWrite } from './viewportAuthorship.js';

// React Flow's own fitView padding, so the first framing looks as it always has.
const FIRST_FIT_PADDING = 0.1;

/** The slice of a React Flow instance that the first fit needs, so tests can supply a fake. */
export type FittableFlow = Pick<ReactFlowInstance, 'getNodes' | 'getNodesBounds' | 'setViewport'>;

/**
 * Frames the graph once, when its nodes are first all measured. It replaces React Flow's `fitView`
 * prop, which holds its fit until nodes appear and then writes the viewport itself: not through
 * N2's writer, so it read as the person's move and ended a navigation begun on an empty canvas.
 * The fit gives way, for good, to whoever framed the canvas first: a focus request active by
 * then, or the person, who may have zoomed or panned the empty canvas while it loaded.
 */
export const useCanvasFirstFit = ({
  flow,
  measured,
  canvasWrap,
  focusing,
  hasPersonMoved,
  minZoom,
  maxZoom,
  writeOwnViewport
}: {
  flow: FittableFlow;
  /** Whether every node has been measured, as React Flow's useNodesInitialized reports. */
  measured: boolean;
  canvasWrap: RefObject<HTMLElement | null>;
  focusing: boolean;
  hasPersonMoved: () => boolean;
  minZoom: number;
  maxZoom: number;
  writeOwnViewport: OwnViewportWrite;
}): void => {
  const framed = useRef(false);
  // A layout effect, so the fit lands before the first measured frame is painted.
  useLayoutEffect(() => {
    if (framed.current || !measured) return;
    framed.current = true;
    const pane = canvasWrap.current?.getBoundingClientRect();
    if (focusing || hasPersonMoved() || !pane) return;
    const bounds = flow.getNodesBounds(flow.getNodes().filter(({ hidden }) => !hidden));
    writeOwnViewport(
      flow,
      getViewportForBounds(bounds, pane.width, pane.height, minZoom, maxZoom, FIRST_FIT_PADDING)
    );
  }, [canvasWrap, flow, focusing, hasPersonMoved, maxZoom, minZoom, measured, writeOwnViewport]);
};
