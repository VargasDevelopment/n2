import type { ProjectedProject } from '@n2/contracts';

export type CanvasGraph = Pick<ProjectedProject, 'nodes' | 'relationships'>;
