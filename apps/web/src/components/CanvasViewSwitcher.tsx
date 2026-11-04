import type { CanvasSession } from '../canvasSession.js';
import { canvasTransformations, type CanvasTransformationId } from '../canvasView.js';
import { byAuthoritativePosition } from '../structuredCanvasItems.js';
import { RoadmapRangeControlBar } from './RoadmapRangeControls.js';
import './CanvasViewSwitcher.css';

export function CanvasViewControls({
  canvasSession,
  onSetSwimlaneScopeId,
  onShowFreeform,
  onToggleTransformation
}: {
  canvasSession: CanvasSession;
  onSetSwimlaneScopeId: (groupId: string) => void;
  onShowFreeform: () => void;
  onToggleTransformation: (transformation: CanvasTransformationId) => void;
}) {
  const view = canvasSession.view;
  const enabled = new Set<CanvasTransformationId>(canvasTransformations(view));
  const groupOptions = view.graph.nodes
    .filter((node) => node.kind === 'group')
    .sort(byAuthoritativePosition);
  return (
    <div
      className="canvas-view-controls"
      data-swimlane-active={enabled.has('swimlane') || undefined}
    >
      <nav className="canvas-view-switcher" aria-label="Canvas view">
        <button type="button" aria-pressed={view.layout === 'freeform'} onClick={onShowFreeform}>
          Freeform
        </button>
        <button
          type="button"
          aria-pressed={enabled.has('kanban')}
          onClick={() => onToggleTransformation('kanban')}
        >
          Kanban
        </button>
        <button
          type="button"
          aria-pressed={enabled.has('roadmap')}
          onClick={() => onToggleTransformation('roadmap')}
        >
          Roadmap
        </button>
        <button
          type="button"
          aria-pressed={enabled.has('swimlane')}
          onClick={() => onToggleTransformation('swimlane')}
        >
          Swimlanes
        </button>
        {enabled.has('swimlane') && canvasSession.kind !== 'freeform' ? (
          <label className="canvas-view-switcher__scope">
            <span>Scope</span>
            <select
              aria-label="Swimlane scope"
              disabled={groupOptions.length === 0}
              value={canvasSession.view.swimlaneModel?.scopeGroupId ?? ''}
              onChange={(event) => onSetSwimlaneScopeId(event.target.value)}
            >
              {groupOptions.length === 0 ? <option value="">No visible Groups</option> : null}
              {groupOptions.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </nav>
      <RoadmapRangeControlBar canvasSession={canvasSession} />
    </div>
  );
}
