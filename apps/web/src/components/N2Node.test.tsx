import type { ProjectedNode } from '@n2/contracts';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConnectionHighlightController } from '../connectionHighlightDom.js';

const updateNodeInternals = vi.hoisted(() => vi.fn());

vi.mock('@xyflow/react', () => ({
  Handle: ({ className, id, position, type }: Record<string, string>) => (
    <span
      className={className}
      data-handle-id={id}
      data-position={position}
      data-testid={`handle-${id}`}
      data-type={type}
    />
  ),
  Position: { Bottom: 'bottom', Left: 'left', Right: 'right', Top: 'top' },
  useUpdateNodeInternals: () => updateNodeInternals
}));

import { N2Node, type N2NodeActions, type N2NodeData } from './N2Node.js';
import { RoadmapNode, type RoadmapNodeData } from './RoadmapNode.js';
import { ConnectionHighlightProvider } from './ConnectionHighlightProvider.js';

const node: ProjectedNode = {
  id: 'node',
  reference: 'N2-1',
  title: 'Node',
  description: '',
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

const note: ProjectedNode = {
  id: 'note',
  reference: 'N2-2',
  title: 'Remember',
  content:
    '**Standalone** context with [reference](https://example.com) and ![private](https://example.com/private.png)',
  kind: 'note',
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: '2026-08-21T12:00:00.000Z',
  updatedAt: '2026-08-21T12:00:00.000Z'
};

const actions: N2NodeActions = {
  cycleStatus: vi.fn(),
  deleteNode: vi.fn(),
  rename: vi.fn(),
  toggleNoteFold: vi.fn(),
  touchNote: vi.fn()
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Complete React Flow props for an N2 node; each test overrides only the data it exercises. */
const n2NodeProps = (data: Partial<N2NodeData> = {}) => {
  const nodeData = {
    actions,
    handleOrientation: 'horizontal',
    node,
    noteFold: 'folded',
    ...data
  } satisfies N2NodeData;
  return {
    id: nodeData.node.id,
    data: nodeData,
    type: 'n2',
    selected: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true
  } satisfies ComponentProps<typeof N2Node>;
};

describe('N2Node relationship handles', () => {
  it('starts relationships from the subject on the left and ends them at the object on the right', () => {
    const connectionHighlightController = createConnectionHighlightController();
    const props = n2NodeProps();

    render(
      <ConnectionHighlightProvider controller={connectionHighlightController}>
        <N2Node {...props} />
      </ConnectionHighlightProvider>
    );

    const article = screen.getByRole('article');
    expect(screen.getByText('N2-1')).toBeTruthy();
    expect(article.getAttribute('data-network-node-id')).toBe(node.id);
    expect(article.style.getPropertyValue('--relationship-handle-depth')).toBe('11px');
    expect(article.style.getPropertyValue('--relationship-handle-length')).toBe('18px');
    act(() => {
      connectionHighlightController.activate(node.id, {
        connectedNodeIds: new Set(),
        relationshipIds: new Set()
      });
    });
    expect(article.getAttribute('data-network-emphasis')).toBe('focus');
    act(() => connectionHighlightController.clear());
    expect(article.hasAttribute('data-network-emphasis')).toBe(false);

    const subject = screen.getByTestId('handle-relationship-subject');
    expect(subject.getAttribute('data-type')).toBe('source');
    expect(subject.getAttribute('data-position')).toBe('left');
    expect(subject.classList.contains('n2-handle--left')).toBe(true);

    const object = screen.getByTestId('handle-relationship-object');
    expect(object.getAttribute('data-type')).toBe('target');
    expect(object.getAttribute('data-position')).toBe('right');
    expect(object.classList.contains('n2-handle--right')).toBe(true);
  });

  it('can orient the same semantic handles from top to bottom without changing their identities', () => {
    const props = n2NodeProps({ handleOrientation: 'vertical' });

    render(
      <ConnectionHighlightProvider controller={createConnectionHighlightController()}>
        <N2Node {...props} />
      </ConnectionHighlightProvider>
    );

    const subject = screen.getByTestId('handle-relationship-subject');
    expect(subject.getAttribute('data-type')).toBe('source');
    expect(subject.getAttribute('data-position')).toBe('top');
    expect(subject.classList.contains('n2-handle--top')).toBe(true);

    const object = screen.getByTestId('handle-relationship-object');
    expect(object.getAttribute('data-type')).toBe('target');
    expect(object.getAttribute('data-position')).toBe('bottom');
    expect(object.classList.contains('n2-handle--bottom')).toBe(true);
  });

  it('remeasures React Flow handle bounds when a mounted work node changes orientation', () => {
    const connectionHighlightController = createConnectionHighlightController();
    const props = n2NodeProps();
    const rendered = render(
      <ConnectionHighlightProvider controller={connectionHighlightController}>
        <N2Node {...props} />
      </ConnectionHighlightProvider>
    );
    expect(updateNodeInternals).toHaveBeenLastCalledWith(node.id);
    updateNodeInternals.mockClear();

    rendered.rerender(
      <ConnectionHighlightProvider controller={connectionHighlightController}>
        <N2Node
          {...props}
          data={{ ...props.data, handleOrientation: 'vertical' } satisfies N2NodeData}
        />
      </ConnectionHighlightProvider>
    );

    expect(updateNodeInternals).toHaveBeenCalledExactlyOnceWith(node.id);
  });

  it('renders a note as markdown annotation without work controls or handles', () => {
    const props = n2NodeProps({ node: note });

    render(
      <ConnectionHighlightProvider controller={createConnectionHighlightController()}>
        <N2Node {...props} />
      </ConnectionHighlightProvider>
    );

    expect(screen.getByRole('article').classList.contains('n2-note')).toBe(true);
    expect(screen.getByText('· N2-2')).toBeTruthy();
    expect(screen.getByText('Standalone').closest('.note-markdown')).not.toBeNull();
    expect(screen.getByText('Standalone').tagName).toBe('STRONG');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByTestId('handle-relationship-subject')).toBeNull();
    expect(screen.queryByTestId('handle-relationship-object')).toBeNull();
    expect(screen.queryByRole('button', { name: /status/i })).toBeNull();
    const link = screen.getByRole('link', { name: 'reference' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
    expect(link.classList.contains('nodrag')).toBe(true);
    expect(link.hasAttribute('node')).toBe(false);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('[Image omitted: private]')).toBeTruthy();
  });

  it('renders scheduled Roadmap work as a temporal appliance with an independent caption', () => {
    const roadmapNode = {
      ...node,
      progress: 0.4,
      effectiveStatus: 'in_progress' as const,
      planningPlacement: {
        kind: 'window' as const,
        startDate: '2026-08-25' as const,
        endDate: '2026-08-26' as const
      }
    };
    const props = {
      id: roadmapNode.id,
      data: {
        actions,
        node: roadmapNode,
        presentation: {
          placementLabel: 'Aug 25 – Aug 26, 2026',
          captionAlignment: 'start' as const,
          clippedAtStart: false,
          clippedAtEnd: false
        }
      } satisfies RoadmapNodeData,
      type: 'roadmap',
      selected: true,
      isConnectable: true,
      zIndex: 0,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
      dragging: false,
      draggable: true,
      selectable: true,
      deletable: true
    } satisfies ComponentProps<typeof RoadmapNode>;

    render(
      <ConnectionHighlightProvider controller={createConnectionHighlightController()}>
        <RoadmapNode {...props} />
      </ConnectionHighlightProvider>
    );

    const article = screen.getByRole('article');
    expect(article.classList.contains('n2-roadmap-node')).toBe(true);
    expect(article.getAttribute('data-placement-kind')).toBe('window');
    expect(article.style.getPropertyValue('--relationship-handle-center-y')).toBe('53px');
    expect(article.style.getPropertyValue('--relationship-handle-depth')).toBe('9px');
    expect(article.style.getPropertyValue('--relationship-handle-length')).toBe('14px');
    expect(screen.getByText(/task · N2-1/i)).toBeTruthy();
    expect(screen.getByText('Aug 25 – Aug 26, 2026')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
    expect(screen.getByRole('button', { name: 'Delete Node' }).parentElement).toBe(article);
    expect(screen.getByTestId('handle-relationship-subject').getAttribute('data-position')).toBe(
      'left'
    );
    expect(screen.getByTestId('handle-relationship-object').getAttribute('data-position')).toBe(
      'right'
    );
  });
});

const renderWorkNode = (workNode: ProjectedNode) => {
  const props = n2NodeProps({ node: workNode });
  render(
    <ConnectionHighlightProvider controller={createConnectionHighlightController()}>
      <N2Node {...props} />
    </ConnectionHighlightProvider>
  );
};

describe('N2Node Blocked by annotation', () => {
  it('stays inside the fixed-height card by sharing the progress row', () => {
    renderWorkNode({
      ...node,
      requestedStatus: 'in_progress',
      effectiveStatus: 'blocked',
      blockedBy: ['first', 'second']
    });

    const annotation = screen.getByText('Blocked by 2');
    expect(annotation.title).toBe('Blocked by 2 relationships');
    // A separate line below the progress row would spill past the card's lower edge.
    expect(annotation.parentElement?.classList.contains('n2-node__progress-row')).toBe(true);
  });

  it('is absent when nothing blocks the work', () => {
    renderWorkNode(node);

    expect(screen.queryByText(/Blocked by/u)).toBeNull();
  });

  it('is absent when Blocked was requested, since that, not a relationship, is the cause', () => {
    renderWorkNode({
      ...node,
      requestedStatus: 'blocked',
      effectiveStatus: 'blocked',
      blockedBy: ['first']
    });

    expect(screen.queryByText(/Blocked by/u)).toBeNull();
  });
});

describe('N2Node header layout', () => {
  // jsdom has no layout engine, so this cannot prove geometry. It pins the structure and CSS
  // declarations behind the header guarantee; the fit itself was measured in a real browser.
  it('pins the header rules that keep the effective status whole and truncate only the reference', () => {
    renderWorkNode({
      ...node,
      reference: 'LONGPROJEC-12345',
      requestedStatus: 'ready',
      effectiveStatus: 'in_progress'
    });

    const status = screen.getByRole('button', { name: /Effective status: In progress/u });
    const eyebrow = status.closest('.n2-node__eyebrow');
    if (!eyebrow) throw new Error('Missing card eyebrow');
    const [kind, reference, slot] = Array.from(eyebrow.children);
    expect([kind, reference, slot].map((part) => part?.textContent)).toEqual([
      'task ·',
      'LONGPROJEC-12345',
      'In progress'
    ]);
    // One line: the row never wraps, and only the reference may shrink, with an ellipsis.
    expect(getComputedStyle(eyebrow).whiteSpace).toBe('nowrap');
    expect(getComputedStyle(eyebrow).flexWrap).not.toBe('wrap');
    expect([kind, slot].map((part) => part && getComputedStyle(part).flexShrink)).toEqual([
      '0',
      '0'
    ]);
    if (!(reference instanceof HTMLElement)) throw new Error('Missing reference');
    const truncation = getComputedStyle(reference);
    expect([truncation.minWidth, truncation.overflow, truncation.textOverflow]).toEqual([
      '0px',
      'hidden',
      'ellipsis'
    ]);
    expect(reference.title).toBe('LONGPROJEC-12345');
    expect(getComputedStyle(status).height).toBe('var(--n2-eyebrow-height)');
    // A differing requested status is a fixed-size glyph, never words that truncate to a fragment.
    const requested = status.querySelector('.n2-node__requested');
    expect(requested?.textContent).toBe('');
    expect(requested?.querySelector('.status-dot--ready')).toBeTruthy();
  });
});
