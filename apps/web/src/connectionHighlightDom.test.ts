import { describe, expect, it } from 'vitest';
import type { ConnectionHighlight } from './connectionHighlight.js';
import { createConnectionHighlightController } from './connectionHighlightDom.js';

const highlight: ConnectionHighlight = {
  connectedNodeIds: new Set(['neighbor']),
  relationshipIds: new Set(['relationship'])
};

describe('connection highlight controller', () => {
  it('emphasizes the complete network and clears every registered representation', () => {
    const controller = createConnectionHighlightController();
    const root = document.createElement('section');
    const focus = document.createElement('article');
    const neighbor = document.createElement('article');
    const unrelated = document.createElement('article');
    const edgePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const edgeLabel = document.createElement('span');

    controller.setRoot(root);
    controller.createNodeRef('focus')(focus);
    controller.createNodeRef('neighbor')(neighbor);
    controller.createNodeRef('unrelated')(unrelated);
    controller.createRelationshipRef('relationship')(edgePath);
    controller.createRelationshipRef('relationship')(edgeLabel);
    controller.activate('focus', highlight);

    expect(root.hasAttribute('data-network-highlight-active')).toBe(true);
    expect(focus.getAttribute('data-network-emphasis')).toBe('focus');
    expect(neighbor.getAttribute('data-network-emphasis')).toBe('connected');
    expect(unrelated.hasAttribute('data-network-emphasis')).toBe(false);
    expect(edgePath.getAttribute('data-network-emphasis')).toBe('connected');
    expect(edgeLabel.getAttribute('data-network-emphasis')).toBe('connected');

    controller.clear();

    expect(root.hasAttribute('data-network-highlight-active')).toBe(false);
    for (const element of [focus, neighbor, unrelated, edgePath, edgeLabel]) {
      expect(element.hasAttribute('data-network-emphasis')).toBe(false);
    }
  });

  it('immediately syncs elements that mount after highlighting starts', () => {
    const controller = createConnectionHighlightController();
    const lateNeighbor = document.createElement('article');
    const lateEdge = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    controller.activate('focus', highlight);
    const neighborRef = controller.createNodeRef('neighbor');
    const edgeRef = controller.createRelationshipRef('relationship');
    neighborRef(lateNeighbor);
    edgeRef(lateEdge);

    expect(lateNeighbor.getAttribute('data-network-emphasis')).toBe('connected');
    expect(lateEdge.getAttribute('data-network-emphasis')).toBe('connected');

    neighborRef(null);
    edgeRef(null);
    expect(lateNeighbor.hasAttribute('data-network-emphasis')).toBe(false);
    expect(lateEdge.hasAttribute('data-network-emphasis')).toBe(false);
  });

  it('clears every old representation when replacing an active network', () => {
    const controller = createConnectionHighlightController();
    const oldFocus = document.createElement('article');
    const oldNeighbor = document.createElement('article');
    const oldEdgePath = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const oldEdgeLabel = document.createElement('span');
    const nextFocus = document.createElement('article');
    const nextNeighbor = document.createElement('article');
    const nextEdge = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    controller.createNodeRef('old-focus')(oldFocus);
    controller.createNodeRef('old-neighbor')(oldNeighbor);
    controller.createRelationshipRef('old-edge')(oldEdgePath);
    controller.createRelationshipRef('old-edge')(oldEdgeLabel);
    controller.createNodeRef('next-focus')(nextFocus);
    controller.createNodeRef('next-neighbor')(nextNeighbor);
    controller.createRelationshipRef('next-edge')(nextEdge);
    controller.activate('old-focus', {
      connectedNodeIds: new Set(['old-neighbor']),
      relationshipIds: new Set(['old-edge'])
    });

    controller.activate('next-focus', {
      connectedNodeIds: new Set(['next-neighbor']),
      relationshipIds: new Set(['next-edge'])
    });

    for (const element of [oldFocus, oldNeighbor, oldEdgePath, oldEdgeLabel]) {
      expect(element.hasAttribute('data-network-emphasis')).toBe(false);
    }
    expect(nextFocus.getAttribute('data-network-emphasis')).toBe('focus');
    expect(nextNeighbor.getAttribute('data-network-emphasis')).toBe('connected');
    expect(nextEdge.getAttribute('data-network-emphasis')).toBe('connected');
  });
});
