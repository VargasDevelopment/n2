import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { ReactFlowInstance, Viewport } from '@xyflow/react';
import {
  canvasCompositionKey,
  isStructuredCanvasView,
  type CanvasView,
  type StructuredCanvasView
} from './canvasView.js';
import type { N2CanvasEdge } from './components/N2Edge.js';
import type { N2CanvasNode } from './canvasNodes.js';
import type { OwnViewportWrite } from './viewportAuthorship.js';

const VIEWPORT_GUTTER = 32;
const STRUCTURED_VIEW_Y = 52;
const FREEFORM_MIN_ZOOM = 0.3;
const ROADMAP_MIN_ZOOM = 0.05;

export const canvasMinZoom = (view: CanvasView): number =>
  view.layout === 'roadmap' ? ROADMAP_MIN_ZOOM : FREEFORM_MIN_ZOOM;

export const canvasViewportKey = (view: CanvasView): string => {
  if (!isStructuredCanvasView(view)) return canvasCompositionKey(view);
  const swimlaneLayout = view.swimlaneModel
    ? `:${view.swimlaneModel.scopeGroupId ?? 'unscoped'}:${view.board.height}`
    : '';
  return `${canvasCompositionKey(view)}:${structuredBoardWidth(view)}${swimlaneLayout}`;
};

const structuredBoardWidth = (view: StructuredCanvasView): number => {
  return view.board.width;
};

const structuredViewport = (boardWidth: number, width: number, minZoom: number) => {
  const effectiveBoardWidth = boardWidth || width;
  const zoom = Math.min(1, Math.max(minZoom, (width - VIEWPORT_GUTTER * 2) / effectiveBoardWidth));
  return {
    x: (width - effectiveBoardWidth * zoom) / 2,
    y: STRUCTURED_VIEW_Y,
    zoom
  };
};

export const useCanvasModeViewport = ({
  canvasWrap,
  flow,
  view,
  writeOwnViewport
}: {
  canvasWrap: RefObject<HTMLElement | null>;
  flow: RefObject<ReactFlowInstance<N2CanvasNode, N2CanvasEdge> | null>;
  view: CanvasView;
  writeOwnViewport: OwnViewportWrite;
}): void => {
  const viewKey = canvasViewportKey(view);
  const structured = isStructuredCanvasView(view);
  const boardWidth = structured ? structuredBoardWidth(view) : null;
  const minZoom = canvasMinZoom(view);
  const viewMode = view.layout === 'freeform' ? 'freeform' : 'structured';
  const previousView = useRef({ key: viewKey, mode: viewMode });
  const freeformViewport = useRef<Viewport | null>(null);

  useLayoutEffect(() => {
    if (previousView.current.key === viewKey) return;
    const previousMode = previousView.current.mode;
    previousView.current = { key: viewKey, mode: viewMode };
    const instance = flow.current;
    if (!instance) return;

    let target: Viewport | null = null;
    if (structured) {
      if (previousMode === 'freeform') freeformViewport.current = instance.getViewport();
      const canvasWidth = canvasWrap.current?.getBoundingClientRect().width ?? window.innerWidth;
      target = structuredViewport(boardWidth ?? 0, canvasWidth, minZoom);
    } else {
      target = freeformViewport.current;
    }
    if (!target) return;

    const timeoutId = window.setTimeout(() => {
      writeOwnViewport(instance, target);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [boardWidth, canvasWrap, flow, minZoom, structured, viewKey, viewMode, writeOwnViewport]);
};
