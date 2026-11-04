import { ViewportPortal } from '@xyflow/react';
import type { SwimlaneBoard } from '../swimlaneView.js';
import { SwimlaneFurniture } from './SwimlaneFurniture.js';

export function SwimlaneBackdrop({ board }: { board: SwimlaneBoard }) {
  return (
    <ViewportPortal>
      <div
        className="swimlane-board"
        style={{ width: board.width, height: board.height }}
        aria-hidden="true"
      >
        <SwimlaneFurniture lanes={board.lanes} references={board.references} width={board.width} />
      </div>
    </ViewportPortal>
  );
}
