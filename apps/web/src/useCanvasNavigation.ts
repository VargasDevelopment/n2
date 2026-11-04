import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { CanvasGraph } from './canvasGraph.js';
import { nodeSelection, type GraphSelection, type InspectorPlacement } from './graphInteraction.js';
import type { CanvasFocusRequest } from './useCanvasFocusRequest.js';

/** A person's request to go to one item: a Project Activity link or a related-item link. */
export type NavigationIntent = {
  nodeId: string;
  placement: InspectorPlacement;
  /**
   * The newest command the link's source reflects; only a graph at or past it shows what the link
   * shows. For an Activity link that is the whole response's sequence, not its entry's, since every
   * entry names its item by the response's current title.
   */
  sequence: number;
  /** Which link asked, so only that one shows it is waiting. */
  link?: string;
};

/** Said when a link's item is gone by the time the graph reflects the link. */
export const DELETED_ITEM_NOTICE = 'That item has since been deleted.';

/**
 * The one navigation in flight. `waiting` lasts until the loaded graph reflects the link's
 * command, however long its refresh takes; `focusing` hands the canvas a request once the item is
 * revealed and selected, until the canvas says the pan has ended. Idle covers done, given up and
 * cancelled, with what to announce, if any. So a request outlives neither its pan nor its canvas:
 * a canvas mounted later, after an error, sees a request only if it is still to be carried out.
 */
type Navigation =
  | { phase: 'idle'; announcement: string | null }
  | { phase: 'waiting'; intent: NavigationIntent; selection: string }
  | { phase: 'focusing'; request: CanvasFocusRequest; announcement: string | null };

const idle: Navigation = { phase: 'idle', announcement: null };

const selectionKey = ({ nodeIds, relationshipIds }: GraphSelection): string =>
  `${nodeIds.join()}|${relationshipIds.join()}`;

/**
 * Owns navigation to an item. Its inputs are a new intent (`navigate`), each graph update, and the
 * single signal that the person took the viewport (`personMovedViewport`), which ends any
 * navigation, waiting or focusing. A person choosing another selection while it waits ends it too.
 *
 * It resolves on one condition: the graph has reached the link's sequence. A cached graph that
 * already holds the item is not enough, because the change the link reports (a rename a filter
 * hides, a status that moves a Kanban card) may still be on its way.
 */
export const useCanvasNavigation = ({
  project,
  selection,
  setSelection,
  reveal,
  announce,
  initialIntent = null
}: {
  project: (CanvasGraph & { latestSequence: number }) | undefined;
  selection: GraphSelection;
  setSelection: Dispatch<SetStateAction<GraphSelection>>;
  /** Resets view state hiding the item; returns what it reset, to announce, or null. */
  reveal: (nodeId: string) => string | null;
  announce: (message: string) => void;
  /** An item to go to as soon as the graph allows, such as one followed from the Library feed. */
  initialIntent?: NavigationIntent | null;
}) => {
  const [navigation, setNavigation] = useState<Navigation>(() =>
    initialIntent
      ? { phase: 'waiting', intent: initialIntent, selection: selectionKey(selection) }
      : idle
  );

  // Moved on during render, so no frame shows a graph holding the item without it selected.
  if (navigation.phase === 'waiting' && project) {
    const { intent } = navigation;
    if (selectionKey(selection) !== navigation.selection) setNavigation(idle);
    else if (project.latestSequence >= intent.sequence) {
      if (project.nodes.some(({ id }) => id === intent.nodeId)) {
        const announcement = reveal(intent.nodeId);
        setSelection(nodeSelection(intent.nodeId, intent.placement));
        setNavigation({ phase: 'focusing', request: { nodeId: intent.nodeId }, announcement });
      } else {
        setNavigation({ phase: 'idle', announcement: DELETED_ITEM_NOTICE });
      }
    }
  }

  useEffect(() => {
    if (navigation.phase !== 'waiting' && navigation.announcement) {
      announce(navigation.announcement);
    }
  }, [announce, navigation]);

  const navigate = useCallback(
    (intent: NavigationIntent): void =>
      setNavigation({ phase: 'waiting', intent, selection: selectionKey(selection) }),
    [selection]
  );
  const personMovedViewport = useCallback(
    (): void => setNavigation((current) => (current.phase === 'idle' ? current : idle)),
    []
  );
  /** The link's source went away, such as the Activity sheet closing: drop what still waits. */
  const withdraw = useCallback(
    (): void => setNavigation((current) => (current.phase === 'waiting' ? idle : current)),
    []
  );
  /** The canvas finished carrying out `request`, however its pan ended. */
  const focusSettled = useCallback(
    (request: CanvasFocusRequest): void =>
      setNavigation((current) =>
        current.phase === 'focusing' && current.request === request ? idle : current
      ),
    []
  );
  return {
    navigate,
    personMovedViewport,
    withdraw,
    focusSettled,
    /** The link still waiting for the graph, so it can show that it heard the click. */
    pending: navigation.phase === 'waiting' ? navigation.intent : null,
    focusRequest: navigation.phase === 'focusing' ? navigation.request : null
  };
};
