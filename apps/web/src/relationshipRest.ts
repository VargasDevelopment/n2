import type { ProjectedRelationship } from '@n2/contracts';

/**
 * How a relationship is drawn at rest, when it is not hovered, selected or touching the selection
 * (ADR 0016). Those states always draw it whole, with its label; at rest the canvas stays quiet:
 *
 * - blocking: a whole line with its label, always, because it is a state the person must not miss;
 * - Part of where Group regions are drawn: hidden, because the region already says it;
 * - Depends on spanning at least STUB_MIN_LENGTH: a stub at each end, so the card still says
 *   "this depends on something over there" without a line crossing the canvas;
 * - anything else: a whole line, without its label.
 */
export type RestingForm = 'line' | 'stub' | 'hidden';

/** About three card widths. Shorter lines are local and cheap to read whole. */
export const STUB_MIN_LENGTH = 640;

export const restingForm = (
  relationship: ProjectedRelationship,
  { groupRegions, length }: { groupRegions: boolean; length: number }
): RestingForm => {
  if (relationship.isBlocking) return 'line';
  if (relationship.kind === 'member_of') return groupRegions ? 'hidden' : 'line';
  return length >= STUB_MIN_LENGTH ? 'stub' : 'line';
};

/** Only blocking labels show at rest; the rest appear with hover and selection. */
export const labelAtRest = (relationship: ProjectedRelationship): boolean =>
  relationship.isBlocking;

/**
 * Stub dashes are written in `pathLength` units, so the pattern fits any path shape without
 * measuring it in the DOM. Pixel sizes below are converted from the chord length.
 */
export const STUB_PATH_LENGTH = 1000;
const STUB = 56;
const DOT = 1.5;
const GAP = 7;
/** Curves run a little longer than their chord; overestimating keeps stubs from growing. */
const CURVE_ALLOWANCE = 1.12;

/** A stub, two trailing dots, a long gap, two dots and a stub, summing to STUB_PATH_LENGTH. */
export const stubDashArray = (length: number): string => {
  const unit = STUB_PATH_LENGTH / (length * CURVE_ALLOWANCE);
  const [stub, dot, gap] = [STUB * unit, DOT * unit, GAP * unit];
  const rest = STUB_PATH_LENGTH - 2 * stub - 4 * dot - 4 * gap;
  return [stub, gap, dot, gap, dot, rest, dot, gap, dot, gap, stub]
    .map((value) => value.toFixed(2))
    .join(' ');
};
