import type { SwimlaneId, SwimlaneKind } from './swimlaneModel.js';

export const SWIMLANE_LABEL_WIDTH = 190;
export const SWIMLANE_PADDING = 20;
export const SWIMLANE_ITEM_GAP = 24;
export const SWIMLANE_REFERENCE_HEIGHT = 32;

export type SwimlaneBand = {
  id: SwimlaneId;
  label: string;
  kind: SwimlaneKind;
  count: number;
  y: number;
  height: number;
};

type SwimlaneReferenceBase = {
  laneId: SwimlaneId;
  nodeId: string;
  reference: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CardSwimlaneReference = SwimlaneReferenceBase & {
  presentation: 'card';
};

export type TemporalSwimlaneReference = SwimlaneReferenceBase & {
  presentation: 'temporal';
  placementKind: 'window' | 'milestone';
  caption: {
    x: number;
    y: number;
    width: number;
    alignment: 'start' | 'end';
  };
};

export type SwimlaneReference = CardSwimlaneReference | TemporalSwimlaneReference;
