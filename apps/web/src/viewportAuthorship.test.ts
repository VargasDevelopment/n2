import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useViewportAuthorship } from './viewportAuthorship.js';

describe('useViewportAuthorship', () => {
  it('reports every move start except those inside N2’s own writes', () => {
    const onPersonMove = vi.fn();
    const { result } = renderHook(() => useViewportAuthorship(onPersonMove));
    // React Flow reports the move start synchronously inside an unanimated write.
    const flow = { setViewport: () => result.current.onMoveStart() };

    result.current.writeOwnViewport(flow, { x: 10, y: 20, zoom: 1 });
    expect(onPersonMove).not.toHaveBeenCalled();

    expect(result.current.hasPersonMoved()).toBe(false);

    // A drag, wheel, Zoom or Fit View control, or the minimap: none goes through N2's writer.
    result.current.onMoveStart();
    expect(onPersonMove).toHaveBeenCalledTimes(1);
    expect(result.current.hasPersonMoved()).toBe(true);
  });

  it('stops counting a write as its own once it throws', () => {
    const onPersonMove = vi.fn();
    const { result } = renderHook(() => useViewportAuthorship(onPersonMove));
    const failing = {
      setViewport: () => {
        throw new Error('not mounted');
      }
    };

    expect(() => result.current.writeOwnViewport(failing, { x: 0, y: 0, zoom: 1 })).toThrow();
    result.current.onMoveStart();

    expect(onPersonMove).toHaveBeenCalledTimes(1);
  });
});
