import type { ProjectedRelationship } from '@n2/contracts';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConnectionHighlightController } from '../connectionHighlightDom.js';

vi.mock('@xyflow/react', () => ({
  BaseEdge: ({
    className,
    id,
    markerEnd,
    path
  }: {
    className: string;
    id: string;
    markerEnd?: string;
    path: string;
  }) => (
    <span
      className={className}
      data-testid={`edge-path-${id}`}
      data-marker-end={markerEnd}
      data-path={path}
    />
  ),
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <>{children}</>,
  getBezierPath: () => ['M bezier', 50, 20],
  getSmoothStepPath: () => ['M smooth-step', 60, 30],
  Position: { Bottom: 'bottom', Left: 'left', Right: 'right', Top: 'top' }
}));

import { N2Edge } from './N2Edge.js';
import { ConnectionHighlightProvider } from './ConnectionHighlightProvider.js';

const relationship: ProjectedRelationship = {
  id: 'dependency',
  kind: 'depends_on',
  dependentId: 'a',
  dependencyId: 'b',
  createdAt: '2026-08-21T12:00:00.000Z',
  isBlocking: false
};
const membershipRelationship: ProjectedRelationship = {
  id: 'membership',
  kind: 'member_of',
  memberId: 'a',
  groupId: 'b',
  createdAt: relationship.createdAt,
  isBlocking: false
};
const connectionHighlightController = createConnectionHighlightController();
// N2Edge draws its own hit path beside BaseEdge's, so a stub's dashes can apply to both.
const hitWidth = (id: string): string | null | undefined =>
  screen
    .getByTestId(`edge-path-${id}`)
    .parentElement?.querySelector('.react-flow__edge-interaction')
    ?.getAttribute('stroke-width');
const renderWithHighlight = (ui: ReactNode, controller = connectionHighlightController) =>
  render(<ConnectionHighlightProvider controller={controller}>{ui}</ConnectionHighlightProvider>);

afterEach(cleanup);

describe('N2Edge label layout', () => {
  it('registers and clears both the rendered path wrapper and label', () => {
    const controller = createConnectionHighlightController();
    const props = {
      id: relationship.id,
      data: { relationship, lane: 0 },
      selected: false,
      sourcePosition: 'left',
      sourceX: -115,
      sourceY: 0,
      targetPosition: 'right',
      targetX: 415,
      targetY: 0
    } as ComponentProps<typeof N2Edge>;
    renderWithHighlight(<N2Edge {...props} />, controller);
    const pathWrapper = screen.getByTestId('edge-path-dependency').parentElement!;
    const label = screen.getByText('Depends on');

    act(() => {
      controller.activate('a', {
        connectedNodeIds: new Set(['b']),
        relationshipIds: new Set(['dependency'])
      });
    });

    expect(pathWrapper.getAttribute('data-network-emphasis')).toBe('connected');
    expect(label.getAttribute('data-network-emphasis')).toBe('connected');

    act(() => controller.clear());
    expect(pathWrapper.hasAttribute('data-network-emphasis')).toBe(false);
    expect(label.hasAttribute('data-network-emphasis')).toBe(false);
  });

  it('preserves the relationship-kind path when there is no parallel neighbor', () => {
    const props = {
      id: relationship.id,
      data: { relationship, lane: 0 },
      selected: false,
      sourcePosition: 'left',
      sourceX: -115,
      sourceY: 0,
      targetPosition: 'right',
      targetX: 415,
      targetY: 0
    } as ComponentProps<typeof N2Edge>;

    renderWithHighlight(<N2Edge {...props} />);

    expect(screen.getByTestId('edge-path-dependency').getAttribute('data-path')).toBe('M bezier');
    expect(screen.getByText('Depends on').style.transform).toBe(
      'translate(-50%, -50%) translate(50px, 20px)'
    );
  });

  it('preserves the smooth-step path for an unaccompanied membership', () => {
    const props = {
      id: membershipRelationship.id,
      data: { relationship: membershipRelationship, lane: 0 },
      selected: false,
      sourcePosition: 'left',
      sourceX: -115,
      sourceY: 0,
      targetPosition: 'right',
      targetX: 415,
      targetY: 0
    } as ComponentProps<typeof N2Edge>;

    renderWithHighlight(<N2Edge {...props} />);

    expect(screen.getByTestId('edge-path-membership').getAttribute('data-path')).toBe(
      'M smooth-step'
    );
    expect(screen.getByText('Part of').style.transform).toBe(
      'translate(-50%, -50%) translate(60px, 30px)'
    );
  });

  it('applies the assigned perpendicular lane to the rendered label', () => {
    const props = {
      id: relationship.id,
      data: { relationship, lane: -1 },
      selected: false,
      sourcePosition: 'left',
      sourceX: -115,
      sourceY: 0,
      targetPosition: 'right',
      targetX: 415,
      targetY: 0
    } as ComponentProps<typeof N2Edge>;

    renderWithHighlight(<N2Edge {...props} />);

    expect(screen.getByTestId('edge-path-dependency').getAttribute('data-path')).not.toBe(
      'M bezier'
    );
    expect(screen.getByText('Depends on').style.transform).toBe(
      'translate(-50%, -50%) translate(150px, -94px)'
    );
  });

  it('keeps opposite-direction parallel paths, hit areas, and presentation distinct', () => {
    const blockedMembership: ProjectedRelationship = {
      ...membershipRelationship,
      isBlocking: true
    };
    const reverseDependency: ProjectedRelationship = {
      ...relationship,
      dependentId: 'b',
      dependencyId: 'a'
    };

    renderWithHighlight(
      <>
        <N2Edge
          {...({
            id: blockedMembership.id,
            data: {
              relationship: blockedMembership,
              lane: -1
            },
            interactionWidth: 30,
            markerEnd: 'membership-marker',
            selected: true,
            sourcePosition: 'left',
            sourceX: -115,
            sourceY: 0,
            targetPosition: 'right',
            targetX: 415,
            targetY: 0
          } as ComponentProps<typeof N2Edge>)}
        />
        <N2Edge
          {...({
            id: reverseDependency.id,
            data: { relationship: reverseDependency, lane: 1 },
            interactionWidth: 30,
            markerEnd: 'dependency-marker',
            selected: false,
            sourcePosition: 'left',
            sourceX: 185,
            sourceY: 0,
            targetPosition: 'right',
            targetX: 115,
            targetY: 0
          } as ComponentProps<typeof N2Edge>)}
        />
      </>
    );

    const memberPath = screen.getByTestId('edge-path-membership');
    const dependencyPath = screen.getByTestId('edge-path-dependency');
    expect(memberPath.getAttribute('data-path')).not.toBe(dependencyPath.getAttribute('data-path'));
    expect(hitWidth('membership')).toBe('30');
    expect(hitWidth('dependency')).toBe('30');
    expect(memberPath.getAttribute('data-marker-end')).toBe('membership-marker');
    expect(dependencyPath.getAttribute('data-marker-end')).toBe('dependency-marker');
    expect(memberPath.classList.contains('n2-edge--member_of')).toBe(true);
    expect(memberPath.classList.contains('n2-edge--blocking')).toBe(true);
    expect(memberPath.classList.contains('n2-edge--selected')).toBe(true);
    expect(memberPath.parentElement?.getAttribute('data-network-relationship-id')).toBe(
      'membership'
    );
    expect(dependencyPath.classList.contains('n2-edge--depends_on')).toBe(true);
    expect(dependencyPath.parentElement?.getAttribute('data-network-relationship-id')).toBe(
      'dependency'
    );
    expect(screen.getByText('Blocked part').getAttribute('data-network-relationship-id')).toBe(
      'membership'
    );
    expect(screen.getByText('Blocked part').style.transform).not.toBe(
      screen.getByText('Depends on').style.transform
    );
  });

  it('uses the relationship-kind fallback for a nonzero mixed-axis lane', () => {
    const props = {
      id: relationship.id,
      data: { relationship, lane: -1 },
      selected: false,
      sourcePosition: 'left',
      sourceX: -115,
      sourceY: 0,
      targetPosition: 'bottom',
      targetX: 300,
      targetY: 70
    } as ComponentProps<typeof N2Edge>;

    renderWithHighlight(<N2Edge {...props} />);

    expect(screen.getByTestId('edge-path-dependency').getAttribute('data-path')).toBe('M bezier');
    expect(screen.getByText('Depends on').style.transform).toBe(
      'translate(-50%, -50%) translate(50px, 20px)'
    );
  });

  it('recomputes a parallel path and label when an endpoint moves', () => {
    const props = {
      id: relationship.id,
      data: { relationship, lane: -1 },
      interactionWidth: 30,
      markerEnd: 'dependency-marker',
      selected: true,
      sourcePosition: 'left',
      sourceX: -115,
      sourceY: 0,
      targetPosition: 'right',
      targetX: 415,
      targetY: 0
    } as ComponentProps<typeof N2Edge>;
    const rendered = renderWithHighlight(<N2Edge {...props} />);
    const originalPath = screen.getByTestId('edge-path-dependency').getAttribute('data-path');
    const originalLabel = screen.getByText('Depends on').style.transform;

    rendered.rerender(
      <ConnectionHighlightProvider controller={connectionHighlightController}>
        <N2Edge {...props} targetX={515} targetY={100} />
      </ConnectionHighlightProvider>
    );

    const movedPath = screen.getByTestId('edge-path-dependency');
    expect(movedPath.getAttribute('data-path')).not.toBe(originalPath);
    expect(screen.getByText('Depends on').style.transform).not.toBe(originalLabel);
    expect(movedPath.getAttribute('data-marker-end')).toBe('dependency-marker');
    expect(hitWidth('dependency')).toBe('30');
    expect(movedPath.classList.contains('n2-edge--selected')).toBe(true);
  });
});
