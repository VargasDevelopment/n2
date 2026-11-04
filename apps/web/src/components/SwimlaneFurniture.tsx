import { Fragment } from 'react';
import type { SwimlaneBand, SwimlaneReference } from '../swimlaneLayout.js';
import './SwimlaneFurniture.css';

export function SwimlaneFurniture({
  lanes,
  references,
  width
}: {
  lanes: readonly SwimlaneBand[];
  references: readonly SwimlaneReference[];
  width: number;
}) {
  return (
    <>
      {lanes.map((lane) => (
        <section
          key={lane.id}
          className="swimlane-band"
          data-swimlane-kind={lane.kind}
          style={{ top: lane.y, width, height: lane.height }}
        >
          <header>
            <strong>{lane.label}</strong>
            <span>{lane.count}</span>
          </header>
        </section>
      ))}
      {references.map((reference) => (
        <Fragment key={`${reference.laneId}:${reference.nodeId}`}>
          <div
            className="swimlane-reference"
            data-has-caption={reference.presentation === 'temporal' || undefined}
            data-placement-kind={
              reference.presentation === 'temporal' ? reference.placementKind : undefined
            }
            style={{
              left: reference.x,
              top: reference.y,
              width: reference.width,
              height: reference.height
            }}
          >
            {reference.presentation === 'temporal' ? null : (
              <>
                <span>↗</span>
                <small>{reference.reference}</small>
                <strong>{reference.title}</strong>
              </>
            )}
          </div>
          {reference.presentation === 'temporal' ? (
            <div
              className="swimlane-reference__caption"
              data-caption-alignment={reference.caption.alignment}
              style={{
                left: reference.caption.x,
                top: reference.caption.y,
                width: reference.caption.width
              }}
            >
              <span>↗</span>
              <small>{reference.reference}</small>
              <strong>{reference.title}</strong>
            </div>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}
