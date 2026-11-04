import { useStore, ViewportPortal } from '@xyflow/react';
import { memo, useDeferredValue, useLayoutEffect, useMemo, useState } from 'react';
import type { CanvasGraph } from '../canvasGraph.js';
import { canvasCards, type N2CanvasNode } from '../canvasNodes.js';
import { useConnectionHighlightNodeRef } from '../connectionHighlightContext.js';
import {
  createGroupRegionCache,
  groupRegions,
  type GroupMembership,
  type GroupRegion,
  type Membership
} from '../groupRegions/regions.js';
import { formatPoint, outlinePath } from '../groupRegions/shapes.js';
import { bundlePath, type BundlePath, type RelationshipBundle } from '../relationshipBundles.js';
import { CanvasOverviewLabels } from './CanvasOverviewLabels.js';
import './GroupRegionLayer.css';

/** Below this zoom the canvas is an overview: bundles and region titles stand in for detail. */
export const OVERVIEW_ZOOM = 0.45;
export type ZoomTier = 'overview' | 'detail';

/**
 * One region. It registers with the connection highlight as its Group, so hovering a member lights
 * the regions it is part of. Memoised: a drag reshapes one region, not all of them.
 */
const RegionShape = memo(function RegionShape({
  region,
  focused
}: {
  region: GroupRegion;
  focused: boolean;
}) {
  const highlightRef = useConnectionHighlightNodeRef(region.groupId);
  const area = useMemo(() => outlinePath(region.outline), [region.outline]);
  const tethers = useMemo(
    () => region.tethers.map(([a, b]) => `M${formatPoint(a)} L${formatPoint(b)}`),
    [region.tethers]
  );
  return (
    <g
      ref={highlightRef}
      className={`group-region group-region--level-${Math.min(region.level, 2)}`}
      data-group-region-id={region.groupId}
      data-group-region-focus={focused || undefined}
    >
      <path className="group-region__area" d={area} />
      {/* One path per tether. Chrome dashed a single path of hundreds of dotted tethers along its
          whole length on every repaint, which cost 50 ms frames while dragging a widely scattered
          Group; one-line paths stay cheap. */}
      {tethers.map((tether, index) => (
        <path key={index} className="group-region__tether" d={tether} />
      ))}
    </g>
  );
});

function BundlePaths({
  paths,
  focusKeys
}: {
  paths: readonly BundlePath[];
  focusKeys: ReadonlySet<string>;
}) {
  return (
    <g className="relationship-bundles">
      {paths.map((bundle) => (
        <path
          key={bundle.key}
          className="relationship-bundle"
          data-relationship-focus={focusKeys.has(bundle.key) || undefined}
          d={bundle.path}
          markerEnd="url(#relationship-bundle-arrow)"
          // Thicker for more relationships, with diminishing growth so a large bundle stays a line.
          style={{ strokeWidth: 1.6 + Math.sqrt(bundle.count) * 1.5 }}
        />
      ))}
    </g>
  );
}

/**
 * The freeform canvas's Group regions, drawn beneath the cards, and its zoomed-out overview of
 * counted bundles and region titles (ADR 0016). Regions follow positions through a deferred value,
 * so a drag paints the moving card first and the region catches up when the frame has room; while
 * a card is dragged, regions that do not hold it ignore it until the drop.
 */
export function GroupRegionLayer({
  nodes,
  graph,
  bundles,
  focusGroupIds,
  focusBundleKeys,
  onZoomTier
}: {
  nodes: readonly N2CanvasNode[];
  graph: CanvasGraph;
  bundles: readonly RelationshipBundle[];
  focusGroupIds: ReadonlySet<string>;
  focusBundleKeys: ReadonlySet<string>;
  /** The canvas marks its root with the tier, so CSS hands relationships to their bundles. */
  onZoomTier: (tier: ZoomTier) => void;
}) {
  const deferredNodes = useDeferredValue(nodes);
  const cards = useMemo(() => canvasCards(deferredNodes), [deferredNodes]);
  const groups = useMemo(
    (): GroupMembership => ({
      groupIds: graph.nodes.flatMap((node) => (node.kind === 'group' ? [node.id] : [])),
      memberships: graph.relationships.flatMap((relationship): Membership[] =>
        relationship.kind === 'member_of'
          ? [{ memberId: relationship.memberId, groupId: relationship.groupId }]
          : []
      )
    }),
    [graph.nodes, graph.relationships]
  );
  const moving = useMemo(
    () => new Set(deferredNodes.flatMap((node) => (node.dragging === true ? [node.id] : []))),
    [deferredNodes]
  );
  const [cache] = useState(createGroupRegionCache);
  const regions = useMemo(
    () => groupRegions(cards, groups, { cache, moving }),
    [cache, cards, groups, moving]
  );
  const overview = useStore((state) => state.transform[2] < OVERVIEW_ZOOM);
  const bundlePaths = useMemo(
    () => (overview ? bundles.flatMap((bundle) => bundlePath(bundle, cards) ?? []) : []),
    [bundles, cards, overview]
  );

  // Before paint, so a canvas that opens zoomed out never flashes the relationships it bundles.
  useLayoutEffect(() => onZoomTier(overview ? 'overview' : 'detail'), [onZoomTier, overview]);

  return (
    <>
      <ViewportPortal>
        <svg className="group-regions" width={1} height={1} aria-hidden="true">
          <defs>
            <marker
              id="relationship-bundle-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path className="relationship-bundle__arrow" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          {regions.map((region) => (
            <RegionShape
              key={region.groupId}
              region={region}
              focused={focusGroupIds.has(region.groupId)}
            />
          ))}
          <BundlePaths paths={bundlePaths} focusKeys={focusBundleKeys} />
        </svg>
      </ViewportPortal>
      {overview ? (
        <CanvasOverviewLabels
          regions={regions}
          bundles={bundlePaths}
          focusBundleKeys={focusBundleKeys}
          graph={graph}
        />
      ) : null}
    </>
  );
}
