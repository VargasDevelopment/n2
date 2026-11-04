import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@xyflow/react', () => ({
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Bottom: 'bottom', Left: 'left', Right: 'right', Top: 'top' },
  MiniMap: () => <div data-testid="preview-minimap" />,
  ReactFlow: ({ children }: { children: ReactNode }) => <div>{children}</div>
}));

import { settingsPreviewEdges, settingsPreviewNodes } from '../settingsPreviewModel.js';
import { SettingsPreview } from './SettingsPreview.js';

afterEach(cleanup);

describe('Settings preview', () => {
  it('changes only renderer orientation while keeping deterministic sample geometry and semantics', () => {
    const horizontal = settingsPreviewNodes('horizontal');
    const vertical = settingsPreviewNodes('vertical');

    expect(vertical.map(({ position }) => position)).toEqual(
      horizontal.map(({ position }) => position)
    );
    expect(horizontal[1]!.position.x).toBeLessThan(horizontal[0]!.position.x);
    expect(horizontal[1]!.position.y).toBeLessThan(horizontal[0]!.position.y);
    expect(horizontal.map(({ data }) => data.handleOrientation)).toEqual([
      'horizontal',
      'horizontal'
    ]);
    expect(vertical.map(({ data }) => data.handleOrientation)).toEqual(['vertical', 'vertical']);
    expect(horizontal[0]?.handles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'relationship-subject', position: 'left', type: 'source' }),
        expect.objectContaining({ id: 'relationship-object', position: 'right', type: 'target' })
      ])
    );
    expect(vertical[0]?.handles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          height: 11,
          id: 'relationship-subject',
          position: 'top',
          type: 'source',
          width: 18
        }),
        expect.objectContaining({
          height: 11,
          id: 'relationship-object',
          position: 'bottom',
          type: 'target',
          width: 18
        })
      ])
    );
    expect(settingsPreviewEdges()[0]).toMatchObject({
      source: 'settings-preview-task',
      target: 'settings-preview-group',
      sourceHandle: 'relationship-subject',
      targetHandle: 'relationship-object',
      data: { relationship: { kind: 'member_of' } },
      // Same marker as the real canvas, not a preview-only color.
      markerEnd: { color: 'var(--color-relationship-member-of)' }
    });
  });

  it('shows or hides the production minimap renderer from preview values', () => {
    const { rerender } = render(
      <SettingsPreview
        values={{ handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' }}
      />
    );
    expect(screen.getByTestId('preview-minimap')).toBeTruthy();
    expect(screen.getByLabelText('Settings preview').querySelector('[inert]')).toBeTruthy();

    rerender(
      <SettingsPreview
        values={{ handleOrientation: 'vertical', minimapVisible: false, theme: 'midnight' }}
      />
    );
    expect(screen.queryByTestId('preview-minimap')).toBeNull();
    expect(screen.getByText(/top → bottom/i)).toBeTruthy();
  });
});
