import { useStore } from '@xyflow/react';
import { useMemo } from 'react';
import type { CanvasGraph } from '../canvasGraph.js';
import type { GroupRegion } from '../groupRegions/regions.js';
import type { BundlePath } from '../relationshipBundles.js';

type Transform = { tx: number; ty: number; zoom: number };
type PlacedTitle = { groupId: string; level: number; text: string; x: number; y: number };

const TITLE_HEIGHT = 20;
const TITLE_MAX_WIDTH = 240;

/**
 * Greedy map-label placement in screen space: outer regions claim their spot first; a title that
 * would collide slides down a row or two inside its region, and is dropped if it still collides.
 * Widths are estimated from the text, so placement needs no DOM measurement.
 */
const placeRegionTitles = (
  regions: readonly GroupRegion[],
  titles: ReadonlyMap<string, string>,
  { tx, ty, zoom }: Transform
): PlacedTitle[] => {
  const placed: { x: number; y: number; width: number }[] = [];
  const result: PlacedTitle[] = [];
  for (const region of regions) {
    const text = titles.get(region.groupId) ?? '';
    if (!text) continue;
    const width = Math.min(TITLE_MAX_WIDTH, 16 + text.length * (region.level > 0 ? 7.6 : 6.9));
    const x = Math.round(region.titleAnchor.x * zoom + tx + 10);
    const baseY = Math.round(region.titleAnchor.y * zoom + ty - TITLE_HEIGHT + 2);
    const free = (y: number): boolean =>
      placed.every(
        (box) =>
          x + width <= box.x ||
          box.x + box.width <= x ||
          y + TITLE_HEIGHT <= box.y ||
          box.y + TITLE_HEIGHT <= y
      );
    const y = [0, 1, 2].map((step) => baseY + step * (TITLE_HEIGHT + 2)).find(free);
    if (y === undefined) continue;
    placed.push({ x, y, width });
    result.push({ groupId: region.groupId, level: region.level, text, x, y });
  }
  return result;
};

/**
 * Region titles and bundle counts for the zoomed-out canvas. They sit in screen space above the
 * cards at a constant size, like labels on a map, so they follow the viewport transform.
 */
export function CanvasOverviewLabels({
  regions,
  bundles,
  focusBundleKeys,
  graph
}: {
  regions: readonly GroupRegion[];
  bundles: readonly BundlePath[];
  focusBundleKeys: ReadonlySet<string>;
  graph: CanvasGraph;
}) {
  const [tx, ty, zoom] = useStore((state) => state.transform);
  const titles = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node.title])),
    [graph.nodes]
  );
  const placedTitles = useMemo(
    () => placeRegionTitles(regions, titles, { tx, ty, zoom }),
    [regions, titles, tx, ty, zoom]
  );
  return (
    <div className="canvas-overview-labels" aria-hidden="true">
      {placedTitles.map((title) => (
        <span
          key={title.groupId}
          className={`group-region-title${title.level > 0 ? ' group-region-title--outer' : ''}`}
          style={{ transform: `translate(${title.x}px, ${title.y}px)` }}
        >
          {title.text}
        </span>
      ))}
      {bundles.map((bundle) => (
        <span
          key={bundle.key}
          className="relationship-bundle-count"
          data-relationship-bundle-count={bundle.count}
          data-relationship-focus={focusBundleKeys.has(bundle.key) || undefined}
          style={{
            transform: `translate(${Math.round(bundle.label.x * zoom + tx)}px, ${Math.round(bundle.label.y * zoom + ty)}px) translate(-50%, -50%)`
          }}
        >
          {bundle.count}
        </span>
      ))}
    </div>
  );
}
