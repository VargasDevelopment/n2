import type { NodeKind, NodeStatus, RelationshipKind } from '@n2/contracts';
import { relationshipInstruction } from '../relationshipPresentation.js';
import { CanvasFilterPopover } from './CanvasFilterPopover.js';

const nodeOptions: { kind: NodeKind; icon: string; label: string }[] = [
  { kind: 'task', icon: '＋', label: 'Task' },
  { kind: 'group', icon: '▦', label: 'Group' },
  { kind: 'note', icon: '✦', label: 'Note' }
];

const relationshipOptions: { kind: RelationshipKind; label: string }[] = [
  { kind: 'member_of', label: 'Part of' },
  { kind: 'depends_on', label: 'Depends on' }
];

export type NodeToolActivation = {
  kind: NodeKind;
  method: 'pointer' | 'keyboard';
};

export type CanvasFilterControls = {
  hiddenStatuses: ReadonlySet<NodeStatus>;
  textQuery: string;
  onTextQueryChange: (query: string) => void;
  onToggleStatus: (status: NodeStatus) => void;
};

export function CanvasToolbar({
  nodeKind,
  placementKind,
  relationshipKind,
  allowNodeCreation = true,
  hiddenStatuses,
  textQuery,
  onActivateNodeTool,
  onSelectRelationshipKind,
  onTextQueryChange,
  onToggleStatus
}: {
  nodeKind: NodeKind;
  placementKind: NodeKind | null;
  relationshipKind: RelationshipKind;
  allowNodeCreation?: boolean;
  hiddenStatuses: ReadonlySet<NodeStatus>;
  textQuery: string;
  onActivateNodeTool: (activation: NodeToolActivation) => void;
  onSelectRelationshipKind: (kind: RelationshipKind) => void;
  onTextQueryChange: (query: string) => void;
  onToggleStatus: (status: NodeStatus) => void;
}) {
  return (
    <div className="canvas-toolbar" aria-label="Canvas tools">
      <div className="canvas-toolbar__scroll">
        {allowNodeCreation ? (
          <div className="canvas-toolbar__group" aria-label="Node type">
            <span>Create</span>
            {nodeOptions.map((option) => (
              <button
                key={option.kind}
                type="button"
                aria-pressed={nodeKind === option.kind}
                aria-describedby={placementKind === option.kind ? 'node-tool-status' : undefined}
                data-placement-active={placementKind === option.kind}
                onClick={(event) => {
                  onActivateNodeTool({
                    kind: option.kind,
                    method: event.detail === 0 ? 'keyboard' : 'pointer'
                  });
                }}
                aria-label={`${option.label} node. Click, then click the canvas to place. Press Enter to create at canvas center.`}
                title={`Place ${option.label.toLowerCase()}; press Enter to create at canvas center`}
              >
                <b aria-hidden="true">{option.icon}</b>
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        <span id="node-tool-status" className="sr-only" role="status" aria-live="polite">
          {placementKind
            ? `Placing a ${placementKind}. Click the canvas to place it. Escape cancels.`
            : `Default node type: ${nodeKind}.`}
        </span>
        {allowNodeCreation ? <span className="canvas-toolbar__divider" /> : null}
        <div className="canvas-toolbar__group" aria-label="Relationship type">
          <span>Relate</span>
          {relationshipOptions.map((option) => (
            <button
              key={option.kind}
              type="button"
              aria-pressed={relationshipKind === option.kind}
              onClick={() => onSelectRelationshipKind(option.kind)}
              title={relationshipInstruction(option.kind)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <span className="canvas-toolbar__divider" />
      <CanvasFilterPopover
        hiddenStatuses={hiddenStatuses}
        textQuery={textQuery}
        onTextQueryChange={onTextQueryChange}
        onToggleStatus={onToggleStatus}
      />
    </div>
  );
}
