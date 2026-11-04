import type { CreateRelationshipInput, ProjectedRelationship } from '@n2/contracts';
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { CanvasGraph } from './canvasGraph.js';
import { RemovedRelationship } from './components/RemovedRelationship.js';
import { applySelectionChanges, type GraphSelection } from './graphInteraction.js';
import { useSessionNotify } from './notificationContext.js';
import type { ProjectCommandDispatch } from './useProjectCommands.js';

// One Undo at a time: a newer removal replaces the older notice instead of stacking.
const REMOVAL_KEY = 'relationship-removed';

/** The input that re-creates a relationship, read through its named endpoint roles. */
const recreation = (relationship: ProjectedRelationship): CreateRelationshipInput =>
  relationship.kind === 'member_of'
    ? { kind: 'member_of', memberId: relationship.memberId, groupId: relationship.groupId }
    : {
        kind: 'depends_on',
        dependentId: relationship.dependentId,
        dependencyId: relationship.dependencyId
      };

/**
 * Removes one relationship, from the canvas or the Inspector, and offers Undo. A relationship is
 * cheap to re-create and Part of lines rest hidden on the canvas (ADR 0016), so removal does not
 * ask first; Undo re-creates it from its named endpoint roles.
 */
export const useRelationshipRemoval = ({
  project,
  dispatch,
  setSelection
}: {
  project: CanvasGraph | undefined;
  dispatch: ProjectCommandDispatch;
  setSelection: Dispatch<SetStateAction<GraphSelection>>;
}) => {
  const { notify } = useSessionNotify();
  return useCallback(
    async (relationshipId: string): Promise<void> => {
      const relationship = project?.relationships.find(({ id }) => id === relationshipId);
      const result = await dispatch({ kind: 'delete_relationship', relationshipId });
      if (result.status !== 'executed') return;
      setSelection((current) =>
        applySelectionChanges(current, [
          { item: 'relationship', id: relationshipId, selected: false }
        ])
      );
      if (!relationship) return;
      const references = new Map(project?.nodes.map((node) => [node.id, node.reference]));
      notify({
        key: REMOVAL_KEY,
        tone: 'info',
        message: <RemovedRelationship relationship={relationship} references={references} />,
        action: {
          label: 'Undo',
          pendingLabel: 'Restoring…',
          run: async () => {
            const restored = await dispatch({
              kind: 'create_relationship',
              input: recreation(relationship)
            });
            if (restored.status !== 'executed') {
              throw new Error('The relationship could not be restored.');
            }
          }
        }
      });
    },
    [dispatch, notify, project, setSelection]
  );
};
