import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAppLocation, projectPath, useAppLocation } from './appLocation.js';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('application location', () => {
  it('treats the root and unknown paths as the Project Library', () => {
    expect(parseAppLocation('/')).toEqual({ kind: 'project_library' });
    expect(parseAppLocation('/something-else')).toEqual({ kind: 'project_library' });
    expect(parseAppLocation('/projects/%E0%A4%A')).toEqual({ kind: 'project_library' });
  });

  it('round-trips a Project identity through its URL', () => {
    const projectId = '00000000-0000-4000-8000-000000000001';
    expect(parseAppLocation(projectPath(projectId))).toEqual({ kind: 'project', projectId });
    expect(parseAppLocation(`${projectPath(projectId)}/`)).toEqual({ kind: 'project', projectId });
  });

  it('keeps an arrival for its own navigation until read, so going back opens the Project plainly', () => {
    const { result } = renderHook(() => useAppLocation());
    act(() => result.current.navigate('/projects/one', { kind: 'activity' }));
    expect(result.current.location).toEqual({
      kind: 'project',
      projectId: 'one',
      arrival: { kind: 'activity' }
    });
    const revision = result.current.navigationRevision;
    // Consuming it is not a navigation, so sessions tied to this entry stay open.
    act(() => result.current.consumeArrival());
    expect(result.current.location).toEqual({ kind: 'project', projectId: 'one' });
    expect(result.current.navigationRevision).toBe(revision);
    const projectState: unknown = window.history.state;
    act(() => result.current.navigate('/'));

    act(() => {
      window.history.replaceState(projectState, '', '/projects/one');
      window.dispatchEvent(new PopStateEvent('popstate', { state: projectState }));
    });
    expect(result.current.location).toEqual({ kind: 'project', projectId: 'one' });
  });

  it('restores backward app-owned history traversals while navigation is blocked', () => {
    const { result, rerender } = renderHook(
      ({ blocked }: { blocked: boolean }) => useAppLocation(blocked),
      { initialProps: { blocked: false } }
    );
    act(() => result.current.navigate('/projects/one'));
    const projectState: unknown = window.history.state;
    act(() => result.current.navigate('/'));
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);

    rerender({ blocked: true });
    act(() => {
      window.history.replaceState(projectState, '', '/projects/one');
      window.dispatchEvent(new PopStateEvent('popstate', { state: projectState }));
    });

    expect(go).toHaveBeenCalledWith(1);
    expect(result.current.location).toEqual({ kind: 'project_library' });
  });

  it('restores forward app-owned history traversals while navigation is blocked', () => {
    const { result, rerender } = renderHook(
      ({ blocked }: { blocked: boolean }) => useAppLocation(blocked),
      { initialProps: { blocked: false } }
    );
    const libraryState: unknown = window.history.state;
    act(() => result.current.navigate('/projects/one'));
    const projectState: unknown = window.history.state;

    act(() => {
      window.history.replaceState(libraryState, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate', { state: libraryState }));
    });
    expect(result.current.location).toEqual({ kind: 'project_library' });

    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    rerender({ blocked: true });
    act(() => {
      window.history.replaceState(projectState, '', '/projects/one');
      window.dispatchEvent(new PopStateEvent('popstate', { state: projectState }));
    });

    expect(go).toHaveBeenCalledWith(-1);
    expect(result.current.location).toEqual({ kind: 'project_library' });
  });
});
