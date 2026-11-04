import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SwimlaneFurniture } from './SwimlaneFurniture.js';

afterEach(cleanup);

describe('SwimlaneFurniture', () => {
  it('keeps Canvas Item References visible on card and temporal lane occurrences', () => {
    render(
      <SwimlaneFurniture
        lanes={[]}
        width={800}
        references={[
          {
            presentation: 'card',
            laneId: 'group:alpha',
            nodeId: 'shared',
            reference: 'N2-42',
            title: 'Shared work',
            x: 0,
            y: 0,
            width: 300,
            height: 32
          },
          {
            presentation: 'temporal',
            laneId: 'group:beta',
            nodeId: 'shared',
            reference: 'N2-42',
            title: 'Shared work',
            x: 0,
            y: 60,
            width: 120,
            height: 12,
            placementKind: 'window',
            caption: { x: 0, y: 40, width: 320, alignment: 'start' }
          }
        ]}
      />
    );

    expect(screen.getAllByText('N2-42')).toHaveLength(2);
    expect(screen.getAllByText('Shared work')).toHaveLength(2);
  });
});
