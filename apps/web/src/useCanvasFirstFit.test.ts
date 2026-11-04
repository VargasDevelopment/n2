import { act, renderHook } from '@testing-library/react';
import type { Viewport } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import { useCanvasFirstFit, type FittableFlow } from './useCanvasFirstFit.js';
import { useViewportAuthorship } from './viewportAuthorship.js';

type Props = { measured: boolean; focusing: boolean };

// The pane is four times the graph's size, so the fit is capped at maxZoom and centred.
const setup = (initial: Props) => {
  const onPersonMove = vi.fn();
  const writes: Viewport[] = [];
  const hook = renderHook(
    ({ measured, focusing }: Props) => {
      const { writeOwnViewport, onMoveStart, hasPersonMoved } = useViewportAuthorship(onPersonMove);
      const flow: FittableFlow = {
        getNodes: () => [],
        getNodesBounds: () => ({ x: 0, y: 0, width: 200, height: 100 }),
        // React Flow reports the move start synchronously inside an unanimated write.
        setViewport: (viewport) => {
          writes.push(viewport);
          onMoveStart();
          return Promise.resolve(true);
        }
      };
      useCanvasFirstFit({
        flow,
        measured,
        canvasWrap: {
          current: { getBoundingClientRect: () => ({ width: 800, height: 400 }) } as HTMLElement
        },
        focusing,
        hasPersonMoved,
        minZoom: 0.3,
        maxZoom: 1.8,
        writeOwnViewport
      });
      return { personMoves: onMoveStart };
    },
    { initialProps: initial }
  );
  return { ...hook, onPersonMove, writes };
};

describe('useCanvasFirstFit', () => {
  it('frames the graph once its nodes are measured, as N2’s own write', () => {
    const { onPersonMove, rerender, writes } = setup({ measured: false, focusing: false });
    expect(writes).toEqual([]);

    rerender({ measured: true, focusing: false });
    rerender({ measured: false, focusing: false });
    rerender({ measured: true, focusing: false });

    expect(writes).toEqual([{ x: 220, y: 110, zoom: 1.8 }]);
    expect(onPersonMove).not.toHaveBeenCalled();
  });

  it('gives way for good to a focus request already framing the canvas', () => {
    const { rerender, writes } = setup({ measured: false, focusing: true });

    rerender({ measured: true, focusing: true });
    rerender({ measured: true, focusing: false });

    expect(writes).toEqual([]);
  });

  it('gives way to the person, who moved the empty canvas while it loaded', () => {
    const { rerender, result, writes } = setup({ measured: false, focusing: false });

    act(() => result.current.personMoves());
    rerender({ measured: true, focusing: false });

    expect(writes).toEqual([]);
  });
});
