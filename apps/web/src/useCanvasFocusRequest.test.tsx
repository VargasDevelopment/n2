import { renderHook } from '@testing-library/react';
import type { ReactFlowInstance, Viewport } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  followCanvasItem,
  FOCUS_PAN_DURATION_MS,
  FOCUS_SETTLE_MS,
  FOCUS_WAIT_MS,
  useCanvasFocusRequest,
  type CanvasFocusRequest,
  type FocusableFlow,
  type PaneArea
} from './useCanvasFocusRequest.js';
import type { OwnViewportWrite } from './viewportAuthorship.js';

type InternalNode = NonNullable<ReturnType<FocusableFlow['getInternalNode']>>;
/** A React Flow instance as focusing sees it, plus the setter the writer goes through. */
type FakeFlow = FocusableFlow & Pick<ReactFlowInstance, 'setViewport'>;

const nodeAt = (x: number, y: number): InternalNode => ({
  measured: { width: 230, height: 140 },
  internals: { positionAbsolute: { x, y } }
});

const pane = { width: 1000, height: 800 };
const whole: PaneArea = { x: 0, y: 0, ...pane };
const ZOOM = 0.5;
/** Viewports that centre `near` before and after a layout change moves it. */
const nearCentred = { x: 392.5, y: 345, zoom: ZOOM };
const movedCentred = { x: 123, y: 195, zoom: ZOOM };

/**
 * A fake that records every viewport write with its time, so tests can see whether a request kept
 * moving the camera. A focus request animates only through these writes, so "no write after
 * invalidation" also means no animation of its own is left running.
 */
const fakeFlow = () => {
  const internalNodes = new Map([
    ['near', nodeAt(100, 40)],
    ['far', nodeAt(3000, 2000)]
  ]);
  let viewport: Viewport = { x: 0, y: 0, zoom: ZOOM };
  const writes: { at: number; viewport: Viewport }[] = [];
  const flow: FakeFlow = {
    getInternalNode: (id) => internalNodes.get(id),
    getViewport: () => viewport,
    setViewport: (next) => {
      viewport = next;
      writes.push({ at: performance.now(), viewport: next });
      return Promise.resolve(true);
    }
  };
  return {
    flow,
    internalNodes,
    writes,
    viewport: () => viewport,
    /** Moves the viewport as a person's gesture would, without going through the request. */
    touch: (next: Viewport) => {
      viewport = next;
    }
  };
};

/** Follows an item with the fake as the writer, as the hook does with writeOwnViewport. */
const followOn = (
  flow: FakeFlow,
  nodeId: string,
  options: Omit<Parameters<typeof followCanvasItem>[2], 'writeViewport'>
) => followCanvasItem(flow, nodeId, { ...options, writeViewport: (v) => void flow.setViewport(v) });

const follow = (flow: FakeFlow, isTargetSelected = () => true) =>
  followOn(flow, 'near', { visibleArea: () => whole, isTargetSelected });

const writesAfter = (writes: { at: number }[], time: number) =>
  writes.filter(({ at }) => at > time);

const finish = () => vi.advanceTimersByTime(FOCUS_PAN_DURATION_MS + FOCUS_SETTLE_MS + 500);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('followCanvasItem', () => {
  it('pans the item to the centre over the pan duration without changing zoom', () => {
    const { flow, viewport, writes } = fakeFlow();

    follow(flow);
    vi.advanceTimersByTime(FOCUS_PAN_DURATION_MS / 2);
    expect(viewport().x).toBeGreaterThan(0);
    expect(viewport().x).toBeLessThan(nearCentred.x);
    finish();

    expect(viewport()).toEqual(nearCentred);
    expect(new Set(writes.map(({ viewport: { zoom } }) => zoom))).toEqual(new Set([ZOOM]));
  });

  it('centres the item in the visible area rather than the whole pane', () => {
    const { flow, viewport } = fakeFlow();

    followOn(flow, 'near', {
      visibleArea: () => ({ x: 0, y: 0, width: 400, height: 300 }),
      isTargetSelected: () => true
    });
    finish();

    expect(viewport()).toEqual({ x: nearCentred.x - 300, y: nearCentred.y - 250, zoom: ZOOM });
  });

  it('gives up on an item the canvas never renders', () => {
    const { flow, writes } = fakeFlow();

    followOn(flow, 'missing', { visibleArea: () => whole, isTargetSelected: () => true });
    finish();

    expect(writes).toEqual([]);
  });

  it('waits for an item that renders after the request, as when a filter is cleared', () => {
    const { flow, internalNodes, viewport } = fakeFlow();
    internalNodes.delete('near');

    follow(flow);
    vi.advanceTimersByTime(FOCUS_WAIT_MS / 2);
    internalNodes.set('near', nodeAt(100, 40));
    finish();

    expect(viewport()).toEqual(nearCentred);
  });

  it('stops waiting once the wait ends or the item is no longer selected', () => {
    const late = fakeFlow();
    late.internalNodes.delete('near');
    follow(late.flow);
    vi.advanceTimersByTime(FOCUS_WAIT_MS + 50);
    late.internalNodes.set('near', nodeAt(100, 40));
    finish();

    const deselected = fakeFlow();
    deselected.internalNodes.delete('near');
    let selected = true;
    follow(deselected.flow, () => selected);
    selected = false;
    vi.advanceTimersByTime(50);
    deselected.internalNodes.set('near', nodeAt(100, 40));
    finish();

    expect([late.writes, deselected.writes]).toEqual([[], []]);
  });

  it('follows the item when a layout change moves it mid-pan, keeping the zoom', () => {
    const { flow, internalNodes, viewport } = fakeFlow();

    follow(flow);
    vi.advanceTimersByTime(FOCUS_PAN_DURATION_MS / 2);
    // A command response moves the card to another Kanban column while the pan is in flight.
    internalNodes.set('near', nodeAt(639, 340));
    finish();

    expect(viewport()).toEqual(movedCentred);
  });

  it('pans again when the item moves after the pan arrived but within the settle window', () => {
    const { flow, internalNodes, viewport } = fakeFlow();

    follow(flow);
    vi.advanceTimersByTime(FOCUS_PAN_DURATION_MS + 200);
    expect(viewport()).toEqual(nearCentred);
    internalNodes.set('near', nodeAt(639, 340));
    finish();

    expect(viewport()).toEqual(movedCentred);
  });

  it('makes no writes once the pan and settle window end', () => {
    const { flow, internalNodes, writes } = fakeFlow();

    follow(flow);
    finish();
    const ended = performance.now();
    internalNodes.set('near', nodeAt(639, 340));
    finish();

    expect(writesAfter(writes, ended)).toEqual([]);
  });

  it('makes no writes after the person moves the viewport mid-pan', () => {
    const { flow, internalNodes, touch, viewport, writes } = fakeFlow();

    follow(flow);
    vi.advanceTimersByTime(FOCUS_PAN_DURATION_MS / 2);
    const gesture = { x: -50, y: -60, zoom: 0.7 };
    touch(gesture);
    const touched = performance.now();
    internalNodes.set('near', nodeAt(639, 340));
    finish();

    expect(writesAfter(writes, touched)).toEqual([]);
    expect(viewport()).toEqual(gesture);
  });
});

describe('followCanvasItem deadline', () => {
  /** Animation frames that run only when resumed, as in a background tab. */
  const suspendableFrames = () => {
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      queued.push(callback)
    );
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    /** Runs frames at 60Hz for a while, as when the tab is visible. */
    return (ms: number): void => {
      for (let elapsed = 0; elapsed < ms; elapsed += 16) {
        vi.advanceTimersByTime(16);
        for (const callback of queued.splice(0)) callback(performance.now());
      }
    };
  };

  it.each([
    [
      'the item moves',
      (fake: ReturnType<typeof fakeFlow>) => fake.internalNodes.set('near', nodeAt(639, 340))
    ],
    [
      'the pane resizes',
      (_fake: ReturnType<typeof fakeFlow>, size: { width: number; height: number }) => {
        size.width = 1400;
      }
    ]
  ])('makes no writes when frames resume after the deadline and %s', (_name, change) => {
    const runFrames = suspendableFrames();
    const fake = fakeFlow();
    const size = { ...whole };
    followOn(fake.flow, 'near', { visibleArea: () => size, isTargetSelected: () => true });
    runFrames(FOCUS_PAN_DURATION_MS + 100);
    expect(fake.viewport()).toEqual(nearCentred);

    const suspended = performance.now();
    vi.advanceTimersByTime(FOCUS_SETTLE_MS);
    change(fake, size);
    runFrames(FOCUS_PAN_DURATION_MS * 2);

    expect(writesAfter(fake.writes, suspended)).toEqual([]);
  });

  it('never moves the canvas when the initial pan resumes after the deadline', () => {
    const runFrames = suspendableFrames();
    const { flow, writes } = fakeFlow();
    followOn(flow, 'near', { visibleArea: () => whole, isTargetSelected: () => true });
    const suspended = performance.now();

    vi.advanceTimersByTime(FOCUS_PAN_DURATION_MS + FOCUS_SETTLE_MS);
    runFrames(FOCUS_PAN_DURATION_MS * 2);

    expect(writesAfter(writes, suspended)).toEqual([]);
  });
});

describe('useCanvasFocusRequest', () => {
  type Props = {
    request: CanvasFocusRequest | null;
    selectedNodeId: string | null;
    ready?: boolean;
  };

  const render = (initialProps: Props = { request: null, selectedNodeId: null }) => {
    const fake = fakeFlow();
    const canvasWrap = { current: document.createElement('section') };
    const freeRegion = { current: document.createElement('div') };
    const ownWrites: Viewport[] = [];
    const writeOwnViewport: OwnViewportWrite = (flow, viewport) => {
      ownWrites.push(viewport);
      void flow.setViewport(viewport);
    };
    const onSettled = vi.fn<(request: CanvasFocusRequest) => void>();
    // React Flow hands out a new instance when its viewport becomes ready, as useReactFlow does.
    const ready = { ...fake.flow, viewportInitialized: true };
    const unready = { ...fake.flow, viewportInitialized: false };
    const hook = renderHook(
      ({ request, selectedNodeId, ready: isReady = true }: Props) =>
        useCanvasFocusRequest({
          flow: isReady ? ready : unready,
          request,
          selectedNodeId,
          canvasWrap,
          freeRegion,
          writeOwnViewport,
          onSettled
        }),
      { initialProps }
    );
    return {
      ...fake,
      ownWrites,
      onSettled,
      canvasWrap: canvasWrap.current,
      freeRegion: freeRegion.current,
      rerender: hook.rerender
    };
  };

  it('centres the item in the free region, measured relative to the pane', () => {
    const { canvasWrap, freeRegion, rerender, viewport } = render();
    // The canvas sits below a 56px top bar; panels leave a 400x300 region at (16, 68).
    canvasWrap.getBoundingClientRect = () => new DOMRect(0, 56, 1000, 800);
    freeRegion.getBoundingClientRect = () => new DOMRect(16, 68, 400, 300);

    rerender({ request: { nodeId: 'near' }, selectedNodeId: 'near' });
    finish();

    // The item's centre (215, 110) lands on the region's centre (16 + 200, 12 + 150) in the pane.
    expect(viewport()).toEqual({ x: 216 - 215 * ZOOM, y: 162 - 110 * ZOOM, zoom: ZOOM });
  });

  it('writes only as N2 itself, so its pan is never taken for the person’s', () => {
    const { ownWrites, rerender, writes } = render();

    rerender({ request: { nodeId: 'near' }, selectedNodeId: 'near' });
    finish();

    expect(writes.length).toBeGreaterThan(0);
    expect(ownWrites).toEqual(writes.map(({ viewport }) => viewport));
  });

  it.each([
    ['still waiting for its item', true],
    ['already panning', false]
  ])('makes no writes once its request is withdrawn while it is %s', (_name, waiting) => {
    const { internalNodes, rerender, writes } = render();
    if (waiting) internalNodes.delete('near');

    rerender({ request: { nodeId: 'near' }, selectedNodeId: 'near' });
    vi.advanceTimersByTime(waiting ? 100 : FOCUS_PAN_DURATION_MS / 2);
    rerender({ request: null, selectedNodeId: 'near' });
    const cancelled = performance.now();
    internalNodes.set('near', nodeAt(639, 340));
    finish();

    expect(writesAfter(writes, cancelled)).toEqual([]);
  });

  it('stops moving the camera when the person selects another card mid-pan', () => {
    const { rerender, writes } = render();
    const request = { nodeId: 'near' };

    rerender({ request, selectedNodeId: 'near' });
    vi.advanceTimersByTime(FOCUS_PAN_DURATION_MS / 2);
    rerender({ request, selectedNodeId: 'far' });
    const reselected = performance.now();
    finish();

    expect(writes.length).toBeGreaterThan(0);
    expect(writesAfter(writes, reselected)).toEqual([]);
  });

  it('never pans toward an item after its details are dismissed, even when it moves later', () => {
    const { internalNodes, rerender, writes } = render();
    const request = { nodeId: 'near' };

    rerender({ request, selectedNodeId: 'near' });
    vi.advanceTimersByTime(FOCUS_PAN_DURATION_MS + 100);
    rerender({ request, selectedNodeId: null });
    const dismissed = performance.now();
    // The delayed command response lands and moves the dismissed card.
    internalNodes.set('near', nodeAt(639, 340));
    finish();
    // Selecting it again by other means is not a new request and must not resume the pan.
    rerender({ request, selectedNodeId: 'near' });
    finish();

    expect(writesAfter(writes, dismissed)).toEqual([]);
  });

  it('drops a request still waiting for its item once a new request replaces it', () => {
    const { internalNodes, rerender, viewport } = render();
    internalNodes.delete('near');

    rerender({ request: { nodeId: 'near' }, selectedNodeId: 'near' });
    vi.advanceTimersByTime(100);
    rerender({ request: { nodeId: 'far' }, selectedNodeId: 'far' });
    internalNodes.set('near', nodeAt(100, 40));
    finish();

    // Centred on `far`; jsdom gives the pane no size.
    expect(viewport()).toEqual({ x: -(3000 + 115) * ZOOM, y: -(2000 + 70) * ZOOM, zoom: ZOOM });
  });

  it('pans again when the same item is requested a second time', () => {
    const { rerender, touch, viewport } = render();

    rerender({ request: { nodeId: 'near' }, selectedNodeId: 'near' });
    finish();
    const arrived = viewport();
    touch({ x: 0, y: 0, zoom: ZOOM });
    rerender({ request: { nodeId: 'near' }, selectedNodeId: 'near' });
    finish();

    expect(viewport()).toEqual(arrived);
  });

  it('holds a request given before the viewport is ready and carries it out once it is', () => {
    // A canvas mounted again after an error receives the still-active request on its first render.
    const request = { nodeId: 'near' };
    const { rerender, viewport, writes } = render({
      request,
      selectedNodeId: 'near',
      ready: false
    });
    finish();
    expect(writes).toEqual([]);

    rerender({ request, selectedNodeId: 'near', ready: true });
    finish();

    // Centred on `near`; jsdom gives the pane no size.
    expect(viewport()).toEqual({ x: -(100 + 115) * ZOOM, y: -(40 + 70) * ZOOM, zoom: ZOOM });
  });

  it('reports the request settled once its pan ends, and not when it is withdrawn', () => {
    const settled = render();
    const request = { nodeId: 'near' };
    settled.rerender({ request, selectedNodeId: 'near' });
    vi.advanceTimersByTime(FOCUS_PAN_DURATION_MS);
    expect(settled.onSettled).not.toHaveBeenCalled();
    finish();

    const withdrawn = render();
    withdrawn.rerender({ request: { nodeId: 'near' }, selectedNodeId: 'near' });
    vi.advanceTimersByTime(FOCUS_PAN_DURATION_MS / 2);
    withdrawn.rerender({ request: null, selectedNodeId: 'near' });
    finish();

    expect(settled.onSettled.mock.calls).toEqual([[request]]);
    expect(withdrawn.onSettled).not.toHaveBeenCalled();
  });
});
