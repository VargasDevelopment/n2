import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { NodeDeletionSummary } from './components/NodeDeletionSummary.js';
import { useConfirm } from './confirmContext.js';
import {
  applySelectionChanges,
  nodeDeletion,
  type CanvasSelection,
  type GraphSelection,
  type SelectionChange
} from './graphInteraction.js';
import type { ProjectCommandDispatch } from './useProjectCommands.js';

/**
 * Deletes a selection with nodes in it after one confirmation that names them. The service deletes
 * one item per command, so the selection is confirmed once, as a whole, against the authoritative
 * state its first command sees, then deleted in order until a command fails. Relationships come
 * last: those that touched a deleted node are already gone, so their commands are no-ops.
 */
export const useSelectionDeletion = (
  dispatch: ProjectCommandDispatch,
  setSelection: Dispatch<SetStateAction<GraphSelection>>
) => {
  const confirm = useConfirm();
  return useCallback(
    async (deletion: CanvasSelection): Promise<void> => {
      const deselect = (change: SelectionChange): void =>
        setSelection((current) => applySelectionChanges(current, [change]));
      const [firstId, ...restIds] = deletion.nodeIds;
      if (firstId === undefined) return;
      const first = await dispatch(
        { kind: 'delete_node', nodeId: firstId },
        {
          confirm: async (authoritativeProject) => {
            const described = nodeDeletion(authoritativeProject, deletion);
            return (
              described === null ||
              confirm({
                title: described.title,
                body: <NodeDeletionSummary deletion={described} />,
                confirmLabel: described.confirmLabel,
                tone: 'destructive'
              })
            );
          }
        }
      );
      if (first.status !== 'executed') return;
      deselect({ item: 'node', id: firstId, selected: false });
      for (const nodeId of restIds) {
        const result = await dispatch({ kind: 'delete_node', nodeId });
        if (result.status !== 'executed') return;
        deselect({ item: 'node', id: nodeId, selected: false });
      }
      for (const relationshipId of deletion.relationshipIds) {
        const result = await dispatch({ kind: 'delete_relationship', relationshipId });
        if (result.status !== 'executed') return;
        deselect({ item: 'relationship', id: relationshipId, selected: false });
      }
    },
    [confirm, dispatch, setSelection]
  );
};
