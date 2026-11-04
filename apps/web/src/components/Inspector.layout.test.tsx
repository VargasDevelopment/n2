import type { ProjectedWorkNode } from '@n2/contracts';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Inspector } from './Inspector.js';

const node: ProjectedWorkNode = {
  id: 'node',
  reference: 'N2-1',
  title: 'Original',
  description: 'Context for later.',
  kind: 'task',
  requestedStatus: 'ready',
  effectiveStatus: 'ready',
  progress: 0,
  blockedBy: [],
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: '2026-08-21T12:00:00.000Z',
  updatedAt: '2026-08-21T12:00:00.000Z'
};

// jsdom has no layout: each measured part reports the size the test gives it, and the observers
// let a test announce a resize, as new content or a smaller window would.
const LINE_HEIGHT = 20;
const size = { prose: 0, face: 0, body: 0, panel: 0 };
const observers = new Set<() => void>();
const announceResize = () => act(() => observers.forEach((measure) => measure()));
const measuring = (element: Element, part: string): boolean => element.classList.contains(part);
const sheet = document.createElement('style');
sheet.textContent = `.inspector__prose { line-height: ${LINE_HEIGHT}px; }`;

beforeEach(() => {
  document.head.append(sheet);
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
    if (measuring(this, 'inspector__prose')) return size.prose;
    return measuring(this, 'inspector__scroll') ? size.body : 0;
  });
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return measuring(this, 'inspector') ? size.panel : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return measuring(this, 'inspector__face') ? size.face : 0;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly measure: () => void) {}
      observe() {
        observers.add(this.measure);
      }
      disconnect() {
        observers.delete(this.measure);
      }
    }
  );
});
afterEach(() => {
  cleanup();
  sheet.remove();
  observers.clear();
  Object.assign(size, { prose: 0, face: 0, body: 0, panel: 0 });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const renderInspector = () =>
  render(
    <Inspector
      node={node}
      placement="right"
      onClose={vi.fn()}
      onDelete={vi.fn()}
      onUpdate={vi.fn()}
    />
  );

describe('Inspector layout measurement', () => {
  it('clamps a description only once it runs past twelve lines, with Show all and Show less', async () => {
    const user = userEvent.setup();
    size.prose = 12 * LINE_HEIGHT;
    const { container } = renderInspector();
    const prose = () => container.querySelector('.inspector__prose');

    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
    expect(prose()?.classList.contains('is-clamped')).toBe(false);

    size.prose = 13 * LINE_HEIGHT;
    announceResize();
    expect(prose()?.classList.contains('is-clamped')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(prose()?.classList.contains('is-clamped')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Show less' }));
    expect(prose()?.classList.contains('is-clamped')).toBe(true);
  });

  it('scrolls the whole panel while the face leaves the body too little room', () => {
    Object.assign(size, { panel: 480, face: 200, body: 600 });
    renderInspector();
    const panel = screen.getByRole('complementary', { name: 'Details for Original' });
    expect(panel.classList.contains('is-crowded')).toBe(false);

    size.face = 400;
    announceResize();
    expect(panel.classList.contains('is-crowded')).toBe(true);

    size.face = 200;
    announceResize();
    expect(panel.classList.contains('is-crowded')).toBe(false);
  });
});
