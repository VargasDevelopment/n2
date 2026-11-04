import {
  isWorkNode,
  type GroupEnablePreview,
  type NodePatch,
  type ProjectedNode,
  type ProjectedWorkNode,
  type TaskExecution
} from '@n2/contracts';
import { useLayoutEffect, useState } from 'react';
import type { InspectorPlacement } from '../graphInteraction.js';
import { nodeStatusOptions, relationshipBlockers } from '../statusPresentation.js';
import { GroupAgentControls, TaskAgentControls } from './InspectorAgents.js';
import { InspectorFace } from './InspectorFace.js';
import { InspectorRelationships, type RelatedWork } from './InspectorRelationships.js';
import { InspectorText } from './InspectorText.js';
import { PlanningPlacementEditor } from './PlanningPlacementEditor.js';
import { useExecutionAuthorizationGuard } from './useExecutionAuthorizationGuard.js';
import './Inspector.css';

type InspectorUpdate = (node: ProjectedNode, patch: NodePatch) => Promise<ProjectedNode | null>;

/** The status the person asks for, one choice in one row; the face shows what N² derives. */
function RequestedStatus({
  node,
  onUpdate
}: {
  node: ProjectedWorkNode;
  onUpdate: InspectorUpdate;
}) {
  return (
    <section className="inspector__section inspector__section--tight">
      <h3 className="inspector__label" id={`requested-status-${node.id}`}>
        Requested status
      </h3>
      <div
        className="inspector__choices inspector__status-row"
        role="group"
        aria-labelledby={`requested-status-${node.id}`}
      >
        {nodeStatusOptions.map(({ status, label }) => (
          <button
            type="button"
            key={status}
            className={node.requestedStatus === status ? 'is-active' : ''}
            aria-pressed={node.requestedStatus === status}
            onClick={() => void onUpdate(node, { requestedStatus: status })}
          >
            <span className={`status-dot status-dot--${status}`} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

type AgentProps = {
  execution?: TaskExecution | null | undefined;
  onDisableTaskForAgents?: (() => Promise<void>) | undefined;
  onEnableTaskForAgents?: (() => Promise<void>) | undefined;
  onPreviewGroupEnablement?: (() => Promise<GroupEnablePreview | null>) | undefined;
  onConfirmGroupEnablement?: ((preview: GroupEnablePreview) => Promise<boolean>) | undefined;
};

function AgentSection({ node, agents }: { node: ProjectedWorkNode; agents: AgentProps }) {
  const { isExecutionAuthorizationPending, runExecutionAuthorization } =
    useExecutionAuthorizationGuard();
  return node.kind === 'task' ? (
    <TaskAgentControls
      execution={agents.execution ?? null}
      isPending={isExecutionAuthorizationPending}
      onDisable={agents.onDisableTaskForAgents}
      onEnable={agents.onEnableTaskForAgents}
      runExecutionAuthorization={runExecutionAuthorization}
    />
  ) : (
    <GroupAgentControls
      isPending={isExecutionAuthorizationPending}
      onConfirm={agents.onConfirmGroupEnablement}
      onPreview={agents.onPreviewGroupEnablement}
      runExecutionAuthorization={runExecutionAuthorization}
    />
  );
}

/** Every Work Node kind lists the same sections in the same order; a Note simply has fewer. */
function WorkSections({
  node,
  onUpdate,
  relationships,
  agents
}: {
  node: ProjectedWorkNode;
  onUpdate: InspectorUpdate;
  relationships: RelatedWork | undefined;
  agents: AgentProps;
}) {
  return (
    <>
      <RequestedStatus node={node} onUpdate={onUpdate} />
      <InspectorText
        variant="description"
        value={node.description}
        persist={async (description) => {
          const accepted = await onUpdate(node, { description });
          return accepted && isWorkNode(accepted) ? accepted.description : null;
        }}
      />
      {relationships ? (
        <InspectorRelationships
          relationships={relationships.items}
          blockedBy={relationshipBlockers(node)}
          onSelect={relationships.onNavigate}
          onRemove={relationships.onRemove}
        />
      ) : null}
      <PlanningPlacementEditor node={node} onUpdate={onUpdate} />
      <AgentSection node={node} agents={agents} />
    </>
  );
}

// Below this much room for the body, the whole panel scrolls, so a tall face never hides it.
const MIN_BODY_ROOM = 120;

/** Whether the face leaves the body too little room to scroll beneath it. */
function useCrowdedFace(panel: HTMLElement | null): boolean {
  const [crowded, setCrowded] = useState(false);
  useLayoutEffect(() => {
    const face = panel?.querySelector<HTMLElement>(':scope > .inspector__face');
    const body = panel?.querySelector<HTMLElement>(':scope > .inspector__scroll');
    if (!panel || !face || !body) return;
    const measure = () => {
      const bodyRoom = Math.min(MIN_BODY_ROOM, body.scrollHeight);
      setCrowded(face.offsetHeight + bodyRoom > panel.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    observer.observe(face);
    return () => observer.disconnect();
  }, [panel]);
  return crowded;
}

export function Inspector({
  node,
  placement,
  onClose,
  onDelete,
  onUpdate,
  relationships,
  ...agents
}: {
  node: ProjectedNode;
  placement: InspectorPlacement;
  onClose: () => void;
  onDelete: (node: ProjectedNode) => void;
  onUpdate: InspectorUpdate;
  relationships?: RelatedWork | undefined;
} & AgentProps) {
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const crowded = useCrowdedFace(panel);
  return (
    <aside
      ref={setPanel}
      className={`inspector inspector--${placement} inspector--${node.kind}${crowded ? ' is-crowded' : ''}`}
      aria-label={`Details for ${node.title}`}
    >
      <InspectorFace
        node={node}
        relationships={relationships}
        onClose={onClose}
        persistTitle={async (draft) => {
          const title = draft.trim();
          if (!title) return node.title;
          return (await onUpdate(node, { title }))?.title ?? null;
        }}
      />
      <div className="inspector__scroll">
        {isWorkNode(node) ? (
          <WorkSections
            node={node}
            onUpdate={onUpdate}
            relationships={relationships}
            agents={agents}
          />
        ) : (
          <InspectorText
            variant="note"
            value={node.content}
            persist={async (content) => {
              const accepted = await onUpdate(node, { content });
              return accepted?.kind === 'note' ? accepted.content : null;
            }}
          />
        )}
        <footer className="inspector__footer">
          <button type="button" className="inspector__delete" onClick={() => onDelete(node)}>
            Delete {node.kind}
          </button>
        </footer>
      </div>
    </aside>
  );
}
