import { createContext, useContext, useMemo, type RefCallback } from 'react';
import type { ConnectionHighlightController } from './connectionHighlightDom.js';

export const ConnectionHighlightContext = createContext<ConnectionHighlightController | null>(null);

export const useConnectionHighlightController = (): ConnectionHighlightController => {
  const controller = useContext(ConnectionHighlightContext);
  if (!controller) throw new Error('Connection highlight registration requires its provider.');
  return controller;
};

export const useConnectionHighlightNodeRef = (nodeId: string): RefCallback<Element> => {
  const controller = useConnectionHighlightController();
  return useMemo(() => controller.createNodeRef(nodeId), [controller, nodeId]);
};

export const useConnectionHighlightRelationshipRef = (
  relationshipId: string
): RefCallback<Element> => {
  const controller = useConnectionHighlightController();
  return useMemo(
    () => controller.createRelationshipRef(relationshipId),
    [controller, relationshipId]
  );
};
