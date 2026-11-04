import type { ProjectedRelationship } from '@n2/contracts';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createConnectionHighlightController } from '../connectionHighlightDom.js';
import { STUB_MIN_LENGTH, STUB_PATH_LENGTH } from '../relationshipRest.js';
import { ConnectionHighlightProvider } from './ConnectionHighlightProvider.js';
import edgeCss from './N2Edge.css?raw';

// The real BaseEdge and path helpers; only the label portal needs React Flow's store.
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <>{children}</>
}));

import { N2Edge } from './N2Edge.js';

const now = '2026-08-21T12:00:00.000Z';
const dependsOn = (isBlocking = false): ProjectedRelationship => ({
  id: 'dependency',
  kind: 'depends_on',
  dependentId: 'a',
  dependencyId: 'b',
  createdAt: now,
  isBlocking
});
const partOf = (isBlocking = false): ProjectedRelationship => ({
  id: 'membership',
  kind: 'member_of',
  memberId: 'a',
  groupId: 'b',
  createdAt: now,
  isBlocking
});

type EdgeCase = {
  relationship: ProjectedRelationship;
  length?: number;
  focused?: boolean;
  bundled?: boolean;
  canvas?: Record<`data-${string}`, string>;
};

/**
 * Renders one edge on a canvas root under the real N2Edge.css and returns its parts. jsdom
 * resolves author stylesheets for getComputedStyle, so these check the rules as the browser
 * applies them; the browser matrix covers what jsdom cannot paint.
 */
const renderEdge = ({
  relationship,
  length = 300,
  focused = false,
  bundled = false,
  canvas = {}
}: EdgeCase) => {
  const controller = createConnectionHighlightController();
  const props = {
    id: relationship.id,
    data: { relationship, lane: 0, groupRegions: true, focused, bundled },
    interactionWidth: 24,
    selected: false,
    sourcePosition: 'right',
    sourceX: 0,
    sourceY: 0,
    targetPosition: 'left',
    targetX: length,
    targetY: 0
  } as ComponentProps<typeof N2Edge>;
  render(
    <section className="canvas-wrap" data-testid="canvas" {...canvas}>
      <ConnectionHighlightProvider controller={controller}>
        <svg>
          <N2Edge {...props} />
        </svg>
      </ConnectionHighlightProvider>
    </section>
  );
  const root = screen.getByTestId('canvas');
  controller.setRoot(root);
  const wrapper = root.querySelector(`g[data-network-relationship-id='${relationship.id}']`);
  const label = root.querySelector(`span[data-network-relationship-id='${relationship.id}']`);
  if (!(wrapper instanceof SVGGElement) || !(label instanceof Element)) {
    throw new Error('The edge did not render');
  }
  return {
    wrapper,
    label,
    paths: [...wrapper.querySelectorAll('path')],
    hover: () =>
      act(() =>
        controller.activate('a', {
          connectedNodeIds: new Set(['b']),
          relationshipIds: new Set([relationship.id])
        })
      )
  };
};

const visibility = (element: Element) => getComputedStyle(element).visibility;
const opacity = (element: Element) => getComputedStyle(element).opacity;

// jsdom ignores SVG presentation attributes; browsers rank them below every author rule, which this
// zero-specificity stand-in reproduces for the stub dashes.
const PRESENTATION_DASHES = ':where([stroke-dasharray]) { stroke-dasharray: 9 9; }';

let sheet: HTMLStyleElement;
beforeAll(() => {
  sheet = document.createElement('style');
  sheet.textContent = `${PRESENTATION_DASHES}\n${edgeCss}`;
  document.head.append(sheet);
});
afterAll(() => sheet.remove());
afterEach(cleanup);

describe('relationships at rest', () => {
  it('hides Part of where Group regions draw it, and hover or selection reveal it', () => {
    const resting = renderEdge({ relationship: partOf() });
    expect(visibility(resting.wrapper)).toBe('hidden');
    resting.hover();
    expect(visibility(resting.wrapper)).toBe('visible');
    cleanup();

    const focused = renderEdge({ relationship: partOf(), focused: true });
    expect(visibility(focused.wrapper)).toBe('visible');
    expect(opacity(focused.label)).not.toBe('0');
  });

  it('always draws a blocking relationship whole, with its label', () => {
    for (const relationship of [partOf(true), dependsOn(true)]) {
      const edge = renderEdge({
        relationship,
        length: STUB_MIN_LENGTH * 2,
        bundled: false,
        canvas: { 'data-zoom-tier': 'overview' }
      });
      expect(edge.wrapper.getAttribute('data-relationship-rest')).toBe('line');
      expect(visibility(edge.wrapper)).toBe('visible');
      expect(edge.paths.every((path) => !path.hasAttribute('stroke-dasharray'))).toBe(true);
      expect(opacity(edge.label)).not.toBe('0');
      cleanup();
    }
  });

  it('keeps Depends on labels quiet until hover or selection', () => {
    const resting = renderEdge({ relationship: dependsOn() });
    expect(opacity(resting.label)).toBe('0');
    resting.hover();
    expect(opacity(resting.label)).not.toBe('0');
    cleanup();

    expect(opacity(renderEdge({ relationship: dependsOn(), focused: true }).label)).not.toBe('0');
  });

  it('stubs a long Depends on line, hit area included, and draws it whole when revealed', () => {
    const edge = renderEdge({ relationship: dependsOn(), length: STUB_MIN_LENGTH });
    expect(edge.paths).toHaveLength(2);
    for (const path of edge.paths) {
      expect(path.getAttribute('pathLength')).toBe(String(STUB_PATH_LENGTH));
      expect(path.getAttribute('stroke-dasharray')).toMatch(/^[\d.]+( [\d.]+){10}$/u);
      expect(getComputedStyle(path).strokeDasharray).toBe('9 9');
    }
    edge.hover();
    for (const path of edge.paths) expect(getComputedStyle(path).strokeDasharray).toBe('none');
    cleanup();

    const short = renderEdge({ relationship: dependsOn(), length: STUB_MIN_LENGTH - 1 });
    expect(short.wrapper.getAttribute('data-relationship-rest')).toBe('line');
  });

  it('hands bundled relationships to their bundle only when zoomed out', () => {
    const detail = renderEdge({ relationship: dependsOn(), bundled: true });
    expect(visibility(detail.wrapper)).toBe('visible');
    cleanup();

    const overview = renderEdge({
      relationship: dependsOn(),
      bundled: true,
      canvas: { 'data-zoom-tier': 'overview' }
    });
    expect(visibility(overview.wrapper)).toBe('hidden');
    expect(visibility(overview.label)).toBe('hidden');
    overview.hover();
    expect(visibility(overview.wrapper)).toBe('visible');
  });

  it('steps everything but the selection back while a selection focus is active', () => {
    const edge = renderEdge({
      relationship: dependsOn(),
      canvas: { 'data-relationship-focus-active': '' }
    });
    const line = edge.wrapper.querySelector('.n2-edge');
    expect(line && opacity(line)).toBe('0.22');
    cleanup();

    const focused = renderEdge({
      relationship: dependsOn(),
      focused: true,
      canvas: { 'data-relationship-focus-active': '' }
    });
    const focusedLine = focused.wrapper.querySelector('.n2-edge');
    expect(focusedLine && opacity(focusedLine)).not.toBe('0.22');
  });
});
