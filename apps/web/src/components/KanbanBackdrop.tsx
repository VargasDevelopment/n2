import type { NodeStatus } from '@n2/contracts';
import { ViewportPortal } from '@xyflow/react';
import { KANBAN_COLUMN_GAP, type KanbanBoard } from '../kanbanView.js';
import { nodeStatusLabels } from '../statusPresentation.js';
import { SwimlaneFurniture } from './SwimlaneFurniture.js';

export function KanbanBackdrop({
  board,
  dropTarget
}: {
  board: KanbanBoard;
  dropTarget: NodeStatus | null;
}) {
  return (
    <ViewportPortal>
      <div className="kanban-board" style={{ height: board.height }} aria-hidden="true">
        {board.columns.map((column) => (
          <section
            key={column.id}
            className="kanban-column"
            data-kanban-column={column.id}
            data-drop-target={column.id === dropTarget || undefined}
            style={{ left: column.x, width: column.width, height: board.height }}
          >
            <header>
              {column.id === 'notes' ? null : (
                <i className={`status-dot status-dot--${column.id}`} />
              )}
              <strong>{column.id === 'notes' ? 'Notes' : nodeStatusLabels[column.id]}</strong>
              <span>{column.count}</span>
            </header>
          </section>
        ))}
        {board.lanes.length > 0 ? (
          <SwimlaneFurniture
            lanes={board.lanes}
            references={board.references}
            width={
              (board.columns.find(({ id }) => id === 'notes')?.x ?? board.width) - KANBAN_COLUMN_GAP
            }
          />
        ) : null}
      </div>
    </ViewportPortal>
  );
}
