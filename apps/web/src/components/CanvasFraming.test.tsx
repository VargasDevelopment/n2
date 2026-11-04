import { act, cleanup, render } from '@testing-library/react';
import type * as XYFlow from '@xyflow/react';
import type { Viewport } from '@xyflow/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FittableFlow } from '../useCanvasFirstFit.js';
import {
  FOCUS_PAN_DURATION_MS,
  FOCUS_SETTLE_MS,
  type CanvasFocusRequest,
  type FocusableFlow
} from '../useCanvasFocusRequest.js';
import { useViewportAuthorship } from '../viewportAuthorship.js';
import { CanvasFraming } from './CanvasFraming.js';

/** What React Flow's store would report: the instance, and whether every node is measured. */
const reactFlow = vi.hoisted((): { flow: unknown; measured: boolean } => ({
  flow: undefined,
  measured: false
}));

vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof XYFlow>()),
  useReactFlow: () => reactFlow.flow,
  useNodesInitialized: () => reactFlow.measured
}));

const ZOOM = 0.5;
const writes: Viewport[] = [];

/** One card at (100, 40), 230x140, on a 1000x800 pane with no panels over it. */
const setCanvas = (viewportInitialized: boolean) => {
  let viewport: Viewport = { x: 0, y: 0, zoom: ZOOM };
  const flow: FittableFlow & FocusableFlow & { viewportInitialized: boolean } = {
    viewportInitialized,
    getNodes: () => [],
    getNodesBounds: () => ({ x: 100, y: 40, width: 230, height: 140 }),
    getInternalNode: () => ({
      measured: { width: 230, height: 140 },
      internals: { positionAbsolute: { x: 100, y: 40 } }
    }),
    getViewport: () => viewport,
    setViewport: (next) => {
      viewport = next;
      writes.push(next);
      return Promise.resolve(true);
    }
  };
  reactFlow.flow = flow;
};

const centred = { x: 392.5, y: 345, zoom: ZOOM };
// Capped at the canvas's maxZoom and centred on the pane.
const fitted = { x: 500 - 215 * 1.8, y: 400 - 110 * 1.8, zoom: 1.8 };

/**
 * The workspace around the canvas: it owns the request, as useCanvasNavigation does, and outlives
 * the canvas, which an error unmounts and "Try again" mounts afresh.
 */
function Workspace({ initial, mounted }: { initial: CanvasFocusRequest | null; mounted: boolean }) {
  const [request, setRequest] = useState(initial);
  const { writeOwnViewport, hasPersonMoved } = useViewportAuthorship(() => undefined);
  const pane = useRef<HTMLElement>({
    getBoundingClientRect: () => new DOMRect(0, 0, 1000, 800)
  } as HTMLElement);
  return mounted ? (
    <CanvasFraming
      focusRequest={request}
      onFocusSettled={(settled) => setRequest((current) => (current === settled ? null : current))}
      selectedNodeId="near"
      canvasWrap={pane}
      freeRegion={pane}
      hasPersonMoved={hasPersonMoved}
      minZoom={0.3}
      maxZoom={1.8}
      writeOwnViewport={writeOwnViewport}
    />
  ) : null;
}

const finish = () =>
  act(() => {
    vi.advanceTimersByTime(FOCUS_PAN_DURATION_MS + FOCUS_SETTLE_MS + 500);
  });

beforeEach(() => {
  vi.useFakeTimers();
  writes.length = 0;
  reactFlow.measured = true;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CanvasFraming on a canvas mounted again after an error', () => {
  it('fits the graph when the request was already carried out', () => {
    setCanvas(true);
    const workspace = render(<Workspace initial={{ nodeId: 'near' }} mounted />);
    finish();
    expect(writes.at(-1)).toEqual(centred);

    workspace.rerender(<Workspace initial={null} mounted={false} />);
    writes.length = 0;
    workspace.rerender(<Workspace initial={null} mounted />);

    expect(writes).toEqual([fitted]);
  });

  it('carries out a request still active once the canvas is ready, instead of fitting', () => {
    const request = { nodeId: 'near' };
    setCanvas(false);
    const workspace = render(<Workspace initial={request} mounted />);
    finish();
    expect(writes).toEqual([]);

    // React Flow's onInit timer fires: useReactFlow hands out the ready instance.
    setCanvas(true);
    workspace.rerender(<Workspace initial={request} mounted />);
    finish();

    expect(writes.at(-1)).toEqual(centred);
    expect(writes).not.toContainEqual(fitted);
  });
});
