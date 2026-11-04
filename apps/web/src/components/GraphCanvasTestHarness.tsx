import type {
  ProjectedNode,
  ProjectedProject,
  ProjectedRelationship,
  ProjectedWorkNode,
  WorkNodeKind
} from '@n2/contracts';
import { PRODUCT_DEFAULT_SETTINGS, type SettingsValues } from '@n2/contracts';
import { act, render, screen } from '@testing-library/react';
import { useRef, useState, type ComponentProps, type SetStateAction } from 'react';
import { vi } from 'vitest';
import {
  isKanbanCanvasView,
  isRoadmapCanvasView,
  resolveCanvasView,
  toggleCanvasTransformation,
  type CanvasTransformationId
} from '../canvasView.js';
import { noSelection, type GraphSelection } from '../graphInteraction.js';
import { useNoteExpansion } from '../noteFold.js';
import type { RoadmapRange } from '../roadmapRange.js';
import { GraphCanvas } from './GraphCanvas.js';

const now = '2026-08-21T12:00:00.000Z';

export const makeNode = (
  id = 'node',
  overrides: Partial<Omit<ProjectedWorkNode, 'kind'>> & { kind?: WorkNodeKind } = {}
): ProjectedWorkNode => {
  const kind = overrides.kind ?? 'task';
  const item = {
    id,
    reference: 'N2-1',
    title: id === 'node' ? 'Node' : id,
    description: '',
    requestedStatus: 'ready' as const,
    effectiveStatus: 'ready' as const,
    progress: 0,
    blockedBy: [],
    position: { x: 0, y: 0 },
    version: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
  return kind === 'group' ? { ...item, kind } : { ...item, kind };
};

export const node = makeNode();

export const makeNote = (id = 'note'): ProjectedNode => ({
  id,
  reference: 'N2-9',
  title: 'Note',
  content: '',
  kind: 'note',
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: now,
  updatedAt: now
});

export const makeDependency = (
  id = 'dependency-edge',
  dependentId = node.id,
  dependencyId = 'dependency'
): ProjectedRelationship => ({
  id,
  kind: 'depends_on',
  dependentId,
  dependencyId,
  createdAt: now,
  isBlocking: false
});

export const makeMembership = (
  memberId: string,
  groupId: string,
  id = 'membership'
): ProjectedRelationship => ({
  id,
  kind: 'member_of',
  memberId,
  groupId,
  createdAt: now,
  isBlocking: false
});

export const makeProject = (
  nodes: ProjectedNode[] = [node],
  relationships: ProjectedRelationship[] = []
): ProjectedProject => ({
  id: 'project',
  name: 'N²',
  referenceKey: 'N2',
  nodes,
  relationships,
  warnings: [],
  latestSequence: 0
});

type CanvasProps = ComponentProps<typeof GraphCanvas>;
export type CanvasCallbacks = Pick<
  CanvasProps,
  | 'onCreateRelationship'
  | 'onDeleteSelection'
  | 'onDeleteRelationship'
  | 'onRenameNode'
  | 'onCycleStatus'
  | 'onSetSwimlaneScopeId'
  | 'onSelectionChange'
> & {
  onCreateNode: Extract<CanvasProps['canvasSession'], { kind: 'freeform' }>['onCreateNode'];
  onMoveNodes: Extract<CanvasProps['canvasSession'], { kind: 'freeform' }>['onMoveNodes'];
  onSetRequestedStatus: Extract<
    CanvasProps['canvasSession'],
    { kind: 'kanban' }
  >['onSetRequestedStatus'];
  onSetRoadmapRange: Extract<
    CanvasProps['canvasSession'],
    { kind: 'roadmap' }
  >['onSetRoadmapRange'];
  onResetRoadmapRange: Extract<
    CanvasProps['canvasSession'],
    { kind: 'roadmap' }
  >['onResetRoadmapRange'];
};

export const makeCallbacks = (overrides: Partial<CanvasCallbacks> = {}): CanvasCallbacks => ({
  onCreateNode: vi.fn(),
  onCreateRelationship: vi.fn(),
  onDeleteSelection: vi.fn(),
  onDeleteRelationship: vi.fn().mockResolvedValue(undefined),
  onMoveNodes: vi.fn().mockResolvedValue(null),
  onSetRequestedStatus: vi.fn(),
  onSetRoadmapRange: vi.fn(),
  onResetRoadmapRange: vi.fn(),
  onSetSwimlaneScopeId: vi.fn(),
  onRenameNode: vi.fn().mockResolvedValue(null),
  onCycleStatus: vi.fn(),
  onSelectionChange: vi.fn(),
  ...overrides
});

export const renderCanvas = ({
  project = makeProject(),
  selection = noSelection,
  callbacks: callbackOverrides = {},
  keyboardShortcutsEnabled = true,
  settings = PRODUCT_DEFAULT_SETTINGS,
  transformations = new Set()
}: {
  project?: ProjectedProject;
  selection?: GraphSelection;
  callbacks?: Partial<CanvasCallbacks>;
  keyboardShortcutsEnabled?: boolean;
  settings?: SettingsValues;
  transformations?: ReadonlySet<CanvasTransformationId>;
} = {}) => {
  const callbacks = makeCallbacks(callbackOverrides);
  let setRenderedProject: ((nextProject: ProjectedProject) => void) | null = null;
  let setRenderedSettings: ((nextSettings: SettingsValues) => void) | null = null;
  let setRenderedSelection: ((nextSelection: GraphSelection) => void) | null = null;

  function ControlledCanvas() {
    const [currentSelection, setCurrentSelection] = useState(selection);
    // Resolves updaters as React would, so the spy sees each selection the canvas produced.
    const latestSelection = useRef(currentSelection);
    const [currentProject, setCurrentProject] = useState(project);
    const [currentSettings, setCurrentSettings] = useState(settings);
    const [currentTransformations, setCurrentTransformations] = useState(transformations);
    const [roadmapRange, setRoadmapRange] = useState<RoadmapRange | null>(null);
    const [swimlaneScopeId, setSwimlaneScopeId] = useState<string | null>(null);
    setRenderedProject = setCurrentProject;
    setRenderedSettings = setCurrentSettings;
    const onSelectionChange = (change: SetStateAction<GraphSelection>): void => {
      const nextSelection = typeof change === 'function' ? change(latestSelection.current) : change;
      if (nextSelection === latestSelection.current) return;
      latestSelection.current = nextSelection;
      callbacks.onSelectionChange(nextSelection);
      setCurrentSelection(nextSelection);
    };
    setRenderedSelection = onSelectionChange;
    const noteExpansion = useNoteExpansion(currentProject.nodes);

    const view = resolveCanvasView(currentProject, currentTransformations, {
      roadmapRange,
      swimlaneScopeId
    });
    const setScope = (groupId: string): void => {
      callbacks.onSetSwimlaneScopeId(groupId);
      setSwimlaneScopeId(groupId);
    };
    let canvasSession: CanvasProps['canvasSession'];
    if (view.layout === 'freeform') {
      canvasSession = {
        kind: 'freeform',
        view,
        onCreateNode: callbacks.onCreateNode,
        onMoveNodes: callbacks.onMoveNodes
      };
    } else if (isKanbanCanvasView(view)) {
      canvasSession = {
        kind: 'kanban',
        view,
        onSetRequestedStatus: callbacks.onSetRequestedStatus
      };
    } else if (isRoadmapCanvasView(view)) {
      canvasSession = {
        kind: 'roadmap',
        view,
        isAutomaticRange: roadmapRange === null,
        onSetRoadmapRange: (range) => {
          callbacks.onSetRoadmapRange(range);
          setRoadmapRange(range);
        },
        onResetRoadmapRange: () => {
          callbacks.onResetRoadmapRange();
          setRoadmapRange(null);
        }
      };
    } else {
      canvasSession = { kind: 'swimlane', view };
    }
    return (
      <GraphCanvas
        canvasSession={canvasSession}
        keyboardShortcutsEnabled={keyboardShortcutsEnabled}
        settings={currentSettings}
        selection={currentSelection}
        noteExpansion={noteExpansion}
        filterControls={{
          hiddenStatuses: new Set(),
          textQuery: '',
          onTextQueryChange: vi.fn(),
          onToggleStatus: vi.fn()
        }}
        {...callbacks}
        onSetSwimlaneScopeId={setScope}
        onToggleTransformation={(transformation) => {
          setCurrentTransformations((current) =>
            toggleCanvasTransformation(current, transformation)
          );
        }}
        onShowFreeform={() => setCurrentTransformations(new Set())}
        onSelectionChange={onSelectionChange}
      />
    );
  }

  return {
    callbacks,
    replaceProject: (nextProject: ProjectedProject): void => {
      act(() => setRenderedProject?.(nextProject));
    },
    replaceSettings: (nextSettings: SettingsValues): void => {
      act(() => setRenderedSettings?.(nextSettings));
    },
    /** Selects as the app does programmatically, e.g. navigating to a related node. */
    replaceSelection: (nextSelection: GraphSelection): void => {
      act(() => setRenderedSelection?.(nextSelection));
    },
    ...render(<ControlledCanvas />)
  };
};

export const dependencyProject = (): ProjectedProject => {
  const dependency = makeNode('dependency', { position: { x: 300, y: 0 } });
  return makeProject([node, dependency], [makeDependency()]);
};

export const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

export const edgeById = (id = 'dependency-edge'): HTMLElement =>
  screen.getByTestId(`mock-edge-${id}`);
export const nodeById = (id: string): HTMLElement => screen.getByTestId(`mock-node-${id}`);
