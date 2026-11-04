import type { Viewport } from '@xyflow/react';
import { useCallback, useRef } from 'react';

type ViewportWriter = { setViewport: (viewport: Viewport) => unknown };

/** Writes the viewport on N2's own behalf, such as a focus pan or a view mode's framing. */
export type OwnViewportWrite = (flow: ViewportWriter, viewport: Viewport) => void;

/**
 * Tells the person's viewport moves from N2's own. N2 moves the viewport only through
 * `writeOwnViewport`, which marks the write while it runs; React Flow reports the move start
 * synchronously inside an unanimated write. Every other move start is the person's: a drag, wheel
 * or pinch, the zoom and fit-view controls, the minimap, or any control added later, and calls
 * `onPersonMove`.
 *
 * That holds only while no automatic writer skips `writeOwnViewport`, so N2 does its own first fit
 * (useCanvasFirstFit) instead of passing React Flow `fitView`, and a lint rule rejects that prop
 * and React Flow's viewport methods everywhere else in the web app. React Flow's other automatic
 * pans each follow a gesture of the person's: keyboard focus on an off-screen node, and dragging a
 * node, a connection or a selection box against the edge.
 */
export const useViewportAuthorship = (onPersonMove: () => void) => {
  const writing = useRef(false);
  const personMoved = useRef(false);
  const writeOwnViewport = useCallback<OwnViewportWrite>((flow, viewport) => {
    writing.current = true;
    try {
      void flow.setViewport(viewport);
    } finally {
      writing.current = false;
    }
  }, []);
  const onMoveStart = useCallback((): void => {
    if (writing.current) return;
    personMoved.current = true;
    onPersonMove();
  }, [onPersonMove]);
  /** Whether the person has moved the viewport yet, so N2's automatic framing can give way. */
  const hasPersonMoved = useCallback((): boolean => personMoved.current, []);
  return { writeOwnViewport, onMoveStart, hasPersonMoved };
};
