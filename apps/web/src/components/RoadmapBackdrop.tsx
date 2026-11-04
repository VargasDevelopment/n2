import { ViewportPortal } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { RoadmapBoard, RoadmapRegion } from '../roadmapView.js';
import { ROADMAP_GEOMETRY } from '../roadmapGeometry.js';
import { SwimlaneFurniture } from './SwimlaneFurniture.js';
import './RoadmapBackdrop.css';

const regionLabel = (region: RoadmapRegion): string => {
  if (region.id === 'scheduled') return 'Scheduled work';
  if (region.id === 'unscheduled') return 'Unscheduled work';
  return 'Notes';
};

export function RoadmapBackdrop({ board }: { board: RoadmapBoard }) {
  const scheduled = board.regions.find(({ id }) => id === 'scheduled');
  const axis = board.axis;
  return (
    <ViewportPortal>
      <div
        className="roadmap-board"
        style={
          {
            width: board.width,
            height: board.height,
            '--roadmap-region-header-height': `${ROADMAP_GEOMETRY.regionHeaderHeight}px`
          } as CSSProperties
        }
        aria-hidden="true"
      >
        {board.regions.map((region) => (
          <section
            key={region.id}
            className="roadmap-region"
            data-roadmap-region={region.id}
            style={{ top: region.y, width: board.width, height: region.height }}
          >
            <header>
              <strong>{regionLabel(region)}</strong>
              <span>{region.count}</span>
            </header>
          </section>
        ))}

        {axis && scheduled ? (
          <div
            className="roadmap-axis"
            style={{
              left: axis.x,
              top: ROADMAP_GEOMETRY.regionHeaderHeight,
              width: axis.width,
              height: scheduled.height - ROADMAP_GEOMETRY.regionHeaderHeight
            }}
          >
            {axis.ticks.map((tick) => (
              <div key={tick.date} className="roadmap-tick" style={{ left: tick.x - axis.x }}>
                <span style={{ width: axis.dayWidth }}>{tick.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="roadmap-empty-schedule">Add a Planning Window or Milestone to begin.</div>
        )}
        {board.lanes.length > 0 ? (
          <SwimlaneFurniture
            lanes={board.lanes}
            references={board.references}
            width={board.width}
          />
        ) : null}
      </div>
    </ViewportPortal>
  );
}
