import type { ConnectionHighlight } from './connectionHighlight.js';

const EMPHASIS_ATTRIBUTE = 'data-network-emphasis';
const ACTIVE_ATTRIBUTE = 'data-network-highlight-active';

type AppliedConnectionHighlight = {
  highlight: ConnectionHighlight;
  nodeId: string;
};

export type ConnectionHighlightController = {
  activate: (nodeId: string, highlight: ConnectionHighlight) => void;
  clear: () => void;
  clearIfActive: (nodeId: string) => void;
  createNodeRef: (nodeId: string) => (element: Element | null) => void;
  createRelationshipRef: (relationshipId: string) => (element: Element | null) => void;
  getActiveNodeId: () => string | null;
  setRoot: (root: Element | null) => void;
};

type ElementRegistry = Map<string, Set<Element>>;

const setEmphasis = (
  registry: ElementRegistry,
  ids: Iterable<string>,
  emphasis: 'connected' | 'focus' | null
): void => {
  for (const id of ids) {
    for (const element of registry.get(id) ?? []) {
      if (emphasis === null) element.removeAttribute(EMPHASIS_ATTRIBUTE);
      else element.setAttribute(EMPHASIS_ATTRIBUTE, emphasis);
    }
  }
};

const clearHighlight = (
  nodes: ElementRegistry,
  relationships: ElementRegistry,
  applied: AppliedConnectionHighlight | null
): void => {
  if (!applied) return;
  setEmphasis(nodes, [applied.nodeId], null);
  setEmphasis(nodes, applied.highlight.connectedNodeIds, null);
  setEmphasis(relationships, applied.highlight.relationshipIds, null);
};

const addElement = (registry: ElementRegistry, id: string, element: Element): void => {
  const existing = registry.get(id);
  if (existing) existing.add(element);
  else registry.set(id, new Set([element]));
};

const removeElement = (registry: ElementRegistry, id: string, element: Element): void => {
  element.removeAttribute(EMPHASIS_ATTRIBUTE);
  const existing = registry.get(id);
  existing?.delete(element);
  if (existing?.size === 0) registry.delete(id);
};

export const createConnectionHighlightController = (): ConnectionHighlightController => {
  const nodes: ElementRegistry = new Map();
  const relationships: ElementRegistry = new Map();
  let applied: AppliedConnectionHighlight | null = null;
  let root: Element | null = null;

  const apply = (next: AppliedConnectionHighlight | null): void => {
    clearHighlight(nodes, relationships, applied);
    applied = next;
    root?.toggleAttribute(ACTIVE_ATTRIBUTE, next !== null);
    if (!next) return;
    setEmphasis(nodes, next.highlight.connectedNodeIds, 'connected');
    setEmphasis(relationships, next.highlight.relationshipIds, 'connected');
    setEmphasis(nodes, [next.nodeId], 'focus');
  };

  const createElementRef = (
    registry: ElementRegistry,
    id: string,
    emphasisFor: (current: AppliedConnectionHighlight) => 'connected' | 'focus' | null
  ): ((element: Element | null) => void) => {
    let currentElement: Element | null = null;
    return (element) => {
      if (currentElement) removeElement(registry, id, currentElement);
      currentElement = element;
      if (!element) return;
      addElement(registry, id, element);
      const emphasis = applied ? emphasisFor(applied) : null;
      if (emphasis) element.setAttribute(EMPHASIS_ATTRIBUTE, emphasis);
    };
  };

  return {
    activate: (nodeId, highlight) => apply({ nodeId, highlight }),
    clear: () => apply(null),
    clearIfActive: (nodeId) => {
      if (applied?.nodeId === nodeId) apply(null);
    },
    createNodeRef: (nodeId) =>
      createElementRef(nodes, nodeId, (current) => {
        if (current.nodeId === nodeId) return 'focus';
        return current.highlight.connectedNodeIds.has(nodeId) ? 'connected' : null;
      }),
    createRelationshipRef: (relationshipId) =>
      createElementRef(relationships, relationshipId, (current) =>
        current.highlight.relationshipIds.has(relationshipId) ? 'connected' : null
      ),
    getActiveNodeId: () => applied?.nodeId ?? null,
    setRoot: (nextRoot) => {
      root?.removeAttribute(ACTIVE_ATTRIBUTE);
      root = nextRoot;
      root?.toggleAttribute(ACTIVE_ATTRIBUTE, applied !== null);
    }
  };
};
