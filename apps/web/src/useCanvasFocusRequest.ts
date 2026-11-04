import type { ReactFlowInstance, Viewport, XYPosition } from '@xyflow/react';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { OwnViewportWrite } from './viewportAuthorship.js';

/**
 * An explicit request to bring one canvas item into view. Each request is a new object so
 * repeating a request for the same item pans again after the person has moved the viewport.
 */
export type CanvasFocusRequest = { readonly nodeId: string };

export const FOCUS_PAN_DURATION_MS = 280;
/**
 * How long after the pan a request keeps following its item. It covers layout changes from a
 * command response still in flight, such as a Kanban card changing column, and then ends so a
 * later layout change never pulls the view back.
 */
export const FOCUS_SETTLE_MS = 1000;
/**
 * How long a request waits for its item to render. A request is made only once the loaded graph
 * holds the item (useCanvasNavigation), so this covers rendering, not a refresh: revealing an item,
 * for example by clearing the filters that hid it, reaches React Flow a render after the request.
 */
export const FOCUS_WAIT_MS = 1000;

/**
 * What focusing reads from a React Flow instance, so tests can supply a plain fake. It is read-only:
 * every write goes through the `writeViewport` it is handed alongside.
 */
export type FocusableFlow = Pick<ReactFlowInstance, 'getViewport'> & {
  getInternalNode: (id: string) =>
    | {
        measured: { width?: number; height?: number };
        width?: number;
        height?: number;
        internals: { positionAbsolute: XYPosition };
      }
    | undefined;
};

/** A rectangle within the canvas pane, in pane pixels. */
export type PaneArea = { x: number; y: number; width: number; height: number };

type FollowOptions = {
  /** Moves the viewport as N2 itself, so the pan is never taken for the person's move. */
  writeViewport: (viewport: Viewport) => void;
  /** The part of the canvas pane the item is centred in: the pane less what floats over it. */
  visibleArea: () => PaneArea;
  /** Whether the item is still the current selection. */
  isTargetSelected: () => boolean;
  /** Called once when the request ends by itself, for any reason; not when it is stopped. */
  onEnd?: () => void;
};

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The same cubic ease React Flow uses for its own animated viewport changes.
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Exact on purpose: the request compares the viewport with the value it read back after writing.
const sameViewport = (left: Viewport, right: Viewport): boolean =>
  left.x === right.x && left.y === right.y && left.zoom === right.zoom;

/**
 * Pans to a rendered canvas item and keeps it centred on its current position until the pan and
 * settle window end. Returns a function that ends the pan.
 *
 * Why every frame is written here instead of using an animated setCenter: a focus request is
 * valid only while its item is the selection, nobody else has moved the viewport since the
 * request's last write, and wall time is before its deadline. Because this loop is the only writer
 * and checks all three before each write, an invalid request makes no further writes and leaves no
 * animation running to interrupt. A pan cut short by the deadline stays where it is, so frames
 * resuming late (a background tab) never move the canvas.
 */
const panTo = (
  flow: FocusableFlow,
  nodeId: string,
  { writeViewport, visibleArea, isTargetSelected, onEnd }: FollowOptions
): (() => void) => {
  const { zoom } = flow.getViewport();
  const targetViewport = (): Viewport | undefined => {
    const node = flow.getInternalNode(nodeId);
    if (!node) return undefined;
    const area = visibleArea();
    const { x, y } = node.internals.positionAbsolute;
    const centreX = x + (node.measured.width ?? node.width ?? 0) / 2;
    const centreY = y + (node.measured.height ?? node.height ?? 0) / 2;
    return {
      x: area.x + area.width / 2 - centreX * zoom,
      y: area.y + area.height / 2 - centreY * zoom,
      zoom
    };
  };

  let owned = flow.getViewport();
  const write = (viewport: Viewport): void => {
    writeViewport(viewport);
    owned = flow.getViewport();
  };
  // Writing the current viewport claims it: React Flow interrupts any animation already running.
  write(owned);

  const duration = prefersReducedMotion() ? 0 : FOCUS_PAN_DURATION_MS;
  const deadline = performance.now() + duration + FOCUS_SETTLE_MS;
  let from = owned;
  let segmentStart = performance.now();
  let arrived = false;
  let frame = 0;
  const step = (): void => {
    const now = performance.now();
    if (now >= deadline || !isTargetSelected() || !sameViewport(flow.getViewport(), owned)) {
      onEnd?.();
      return;
    }
    let progress = duration === 0 ? 1 : Math.min(1, (now - segmentStart) / duration);
    const target = targetViewport();
    if (target) {
      if (arrived && duration > 0 && !sameViewport(target, owned)) {
        // The item moved after the pan arrived: pan again from here rather than jumping.
        from = owned;
        segmentStart = now;
        progress = 0;
      }
      const eased = easeInOutCubic(progress);
      const next = {
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
        zoom
      };
      if (!sameViewport(next, owned)) write(next);
      arrived = progress === 1;
    }
    frame = requestAnimationFrame(step);
  };
  step();
  return () => cancelAnimationFrame(frame);
};

/**
 * Brings a canvas item into view. An item that is not rendered yet is waited for, while it stays
 * selected, for up to FOCUS_WAIT_MS, so a request made together with the change that reveals the
 * item still lands. Returns a function that ends the request.
 */
export const followCanvasItem = (
  flow: FocusableFlow,
  nodeId: string,
  options: FollowOptions
): (() => void) => {
  const waitDeadline = performance.now() + FOCUS_WAIT_MS;
  let frame = 0;
  let stop = () => cancelAnimationFrame(frame);
  const begin = (): void => {
    if (!options.isTargetSelected() || performance.now() >= waitDeadline) {
      options.onEnd?.();
      return;
    }
    if (flow.getInternalNode(nodeId)) stop = panTo(flow, nodeId, options);
    else frame = requestAnimationFrame(begin);
  };
  begin();
  return () => stop();
};

/**
 * Follows the current focus request, centring its item in the free region: the
 * .canvas-free-region probe, which the toast lane's CSS also defines, so the two never disagree
 * about where panels leave room. Its writes go through `writeOwnViewport`, so they are never
 * mistaken for the person's. Withdrawing the request, as useCanvasNavigation does when the person
 * takes the viewport, ends it whether it is still waiting for its item or already panning. A
 * request that ends by itself is reported through `onSettled`, so its owner can let it go.
 *
 * A request given before React Flow's viewport is ready, as on a canvas mounted again after an
 * error, waits for it rather than being dropped.
 */
export const useCanvasFocusRequest = ({
  flow,
  request,
  selectedNodeId,
  canvasWrap,
  freeRegion,
  writeOwnViewport,
  onSettled
}: {
  flow: FocusableFlow & Pick<ReactFlowInstance, 'setViewport' | 'viewportInitialized'>;
  request: CanvasFocusRequest | null;
  selectedNodeId: string | null;
  canvasWrap: RefObject<HTMLElement | null>;
  freeRegion: RefObject<HTMLElement | null>;
  writeOwnViewport: OwnViewportWrite;
  onSettled: (request: CanvasFocusRequest) => void;
}): void => {
  const selection = useRef(selectedNodeId);
  useLayoutEffect(() => {
    selection.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    if (!request || !flow.viewportInitialized) return undefined;
    return followCanvasItem(flow, request.nodeId, {
      writeViewport: (viewport) => writeOwnViewport(flow, viewport),
      // Read every frame, so a panel that opens with the selection is cleared as soon as it shows.
      visibleArea: () => {
        const pane = canvasWrap.current?.getBoundingClientRect();
        if (!pane) return { x: 0, y: 0, width: 0, height: 0 };
        const free = freeRegion.current?.getBoundingClientRect() ?? pane;
        return {
          x: free.left - pane.left,
          y: free.top - pane.top,
          width: free.width,
          height: free.height
        };
      },
      isTargetSelected: () => selection.current === request.nodeId,
      onEnd: () => onSettled(request)
    });
  }, [canvasWrap, flow, freeRegion, onSettled, request, writeOwnViewport]);
};
