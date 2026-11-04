import type {
  CreateRelationshipInput,
  GroupEnablePreview,
  NodeKind,
  NodeStatus,
  Position,
  ProjectedNode,
  ProjectedProject,
  ProjectedWorkNode
} from '@n2/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from './api.js';
import type { CanvasSession } from './canvasSession.js';
import { projectSettingsQueryOptions } from './settingsQueries.js';
import { isKanbanCanvasView, isRoadmapCanvasView, isSwimlaneCanvasView } from './canvasView.js';
import { useActivitySession } from './activityQueries.js';
import { ActivityEntryPoint, ActivityPanel } from './components/ActivityPanel.js';
import { ArchivedProjectGate } from './components/ArchivedProjectGate.js';
import { ConfirmProvider } from './components/ConfirmProvider.js';
import { NotificationProvider } from './components/NotificationProvider.js';
import { useProjectSummary } from './projectLibraryQueries.js';
import { GraphCanvas } from './components/GraphCanvas.js';
import { Inspector } from './components/Inspector.js';
import { ProjectLibrary } from './components/ProjectLibrary.js';
import { SettingsModal } from './components/SettingsModal.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import './components/SettingsEntry.css';
import './components/ProjectWorkspace.css';
import { noSelection, type CanvasSelection, type GraphSelection } from './graphInteraction.js';
import {
  useProjectCommands,
  executionQueryKey,
  projectQueryKey,
  type EditableNodePatch,
  type NodePositionMove
} from './useProjectCommands.js';
import { projectPath, useAppLocation, type ProjectArrival } from './appLocation.js';
import { useCanvasNavigation } from './useCanvasNavigation.js';
import { useCanvasViewState } from './useCanvasViewState.js';
import { useCanvasSelection } from './useCanvasSelection.js';
import { useRelatedWork } from './useRelatedWork.js';
import { useRelationshipRemoval } from './useRelationshipRemoval.js';
import { useSelectionDeletion } from './useSelectionDeletion.js';
import { useTransientNavigationGuard } from './useTransientNavigationGuard.js';
import { useWorkspaceNotifications } from './useWorkspaceNotifications.js';
import { useRefreshFailureNotice } from './useRefreshFailureNotice.js';
import { queryView } from './queryView.js';
import { WorkspaceUnavailable } from './components/WorkspaceUnavailable.js';
import { useDocumentTheme } from './theme.js';

export function App() {
  const [projectCreationActive, setProjectCreationActive] = useState(false);
  const allowProjectCreationNavigation = useTransientNavigationGuard(projectCreationActive);
  const { location, navigate, consumeArrival, navigationRevision } =
    useAppLocation(projectCreationActive);
  useDocumentTheme(location.kind === 'project' ? location.projectId : undefined);
  const [settingsSession, setSettingsSession] = useState<
    | { initialScope: 'application'; navigationRevision: number }
    | {
        initialScope: 'project';
        navigationRevision: number;
        projectId: string;
      }
    | null
  >(null);
  const activeSettingsSession =
    settingsSession?.navigationRevision === navigationRevision ? settingsSession : null;
  const settingsProjectId =
    activeSettingsSession?.initialScope === 'project' ? activeSettingsSession.projectId : undefined;
  const settingsProject = useProjectSummary(settingsProjectId);
  const page =
    location.kind === 'project_library' ? (
      <ProjectLibrary
        inert={activeSettingsSession !== null}
        onCreationActiveChange={setProjectCreationActive}
        onOpenProject={(projectId, arrival) => navigate(projectPath(projectId), arrival)}
        onProjectCreated={(projectId) => {
          allowProjectCreationNavigation();
          setProjectCreationActive(false);
          navigate(projectPath(projectId));
        }}
        onOpenSettings={() =>
          setSettingsSession({ initialScope: 'application', navigationRevision })
        }
      />
    ) : (
      <ArchivedProjectGate
        key={location.projectId}
        inert={activeSettingsSession !== null}
        projectId={location.projectId}
        onOpenLibrary={() => navigate('/')}
      >
        {/* The keyed gate is the workspace session; confirmations live and die with it. */}
        <ConfirmProvider>
          <ProjectWorkspace
            inert={activeSettingsSession !== null}
            keyboardShortcutsEnabled={activeSettingsSession === null}
            projectId={location.projectId}
            arrival={location.arrival}
            onArrivalRead={consumeArrival}
            onOpenLibrary={() => navigate('/')}
            onOpenSettings={(projectId) =>
              setSettingsSession({ initialScope: 'project', navigationRevision, projectId })
            }
          />
        </ConfirmProvider>
      </ArchivedProjectGate>
    );
  // The stack outlives pages on purpose so a Library notice like archive Undo survives opening a
  // Project; workspace-scoped publishers bind themselves to their session instead.
  return (
    <NotificationProvider>
      <UpdateBanner />
      {page}
      {activeSettingsSession ? (
        <SettingsModal
          initialScope={activeSettingsSession.initialScope}
          onClose={() => setSettingsSession(null)}
          {...(settingsProjectId === undefined
            ? {}
            : { project: { id: settingsProjectId, name: settingsProject?.name ?? '…' } })}
        />
      ) : null}
    </NotificationProvider>
  );
}

type ProjectWorkspaceProps = {
  inert: boolean;
  keyboardShortcutsEnabled: boolean;
  projectId: string;
  /** Read once, on mount, and then consumed, so a remount behind the archive gate cannot replay it. */
  arrival: ProjectArrival | undefined;
  onArrivalRead: () => void;
  onOpenLibrary: () => void;
  onOpenSettings: (projectId: string) => void;
};

function ProjectWorkspace({
  inert,
  keyboardShortcutsEnabled,
  projectId,
  arrival,
  onArrivalRead,
  onOpenLibrary,
  onOpenSettings
}: ProjectWorkspaceProps) {
  // The canvas and the Activity sheet take the arrival into their own state as they mount.
  useEffect(() => {
    if (arrival) onArrivalRead();
  }, [arrival, onArrivalRead]);
  const projectQuery = useQuery({
    queryKey: projectQueryKey(projectId),
    queryFn: () => api.getProject(projectId),
    refetchOnMount: 'always',
    // Hides the graph's copy of the name: command responses can land after a rename.
    select: (graph): Omit<ProjectedProject, 'name'> => graph
  });
  const summary = useProjectSummary(projectId);
  const projectSettingsQuery = useQuery({
    ...projectSettingsQueryOptions(projectId),
    refetchOnMount: 'always'
  });
  const executionQuery = useQuery({
    queryKey: executionQueryKey(projectId),
    queryFn: () => api.getExecution(projectId),
    refetchOnMount: 'always'
  });
  const [selection, setSelection] = useState<GraphSelection>(noSelection);
  const { reportError, celebrateGroups, announce } = useWorkspaceNotifications();
  const { dispatch } = useProjectCommands(projectId, reportError, celebrateGroups);

  const project = projectQuery.data;
  const workspaceQueries = [projectQuery, projectSettingsQuery, executionQuery];
  useRefreshFailureNotice(
    workspaceQueries,
    'Could not refresh this Project. Showing the last loaded version.'
  );
  const viewState = useCanvasViewState(project);
  const { canvasGraph, canvasView, roadmapRange, setRoadmapRange, reveal } = viewState;
  const { visibleGraph, selectedNode } = useCanvasSelection(canvasView, selection, setSelection);
  const navigation = useCanvasNavigation({
    project,
    selection,
    setSelection,
    reveal,
    announce,
    initialIntent:
      arrival?.kind === 'item'
        ? { nodeId: arrival.nodeId, placement: 'right', sequence: arrival.sequence }
        : null
  });
  const { navigate } = navigation;
  // A link still waiting when its sheet closes is dropped with it.
  const activitySession = useActivitySession(
    projectId,
    project?.latestSequence,
    navigation.withdraw,
    arrival?.kind === 'activity'
  );
  // Moving through related work keeps the Inspector where it is, so the layout does not shuffle.
  const navigateToRelated = useCallback(
    (nodeId: string) => navigate({ nodeId, placement: selection.inspectorPlacement, sequence: 0 }),
    [navigate, selection.inspectorPlacement]
  );
  const removeRelationship = useRelationshipRemoval({ project, dispatch, setSelection });
  const relationships = useRelatedWork({
    project,
    visibleGraph,
    selectedNode,
    onNavigate: navigateToRelated,
    onRemove: removeRelationship
  });
  const selectedTaskExecution =
    selectedNode?.kind === 'task'
      ? (executionQuery.data?.tasks.find(({ taskId }) => taskId === selectedNode.id) ?? null)
      : null;

  const previewSelectedGroup = useCallback(async (): Promise<GroupEnablePreview | null> => {
    if (selectedNode?.kind !== 'group') return null;
    try {
      const preview = await api.previewGroupEnablement(projectId, selectedNode.id);
      reportError('');
      return preview;
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : 'The Group preview failed.');
      return null;
    }
  }, [projectId, reportError, selectedNode]);

  const confirmSelectedGroup = useCallback(
    async (preview: GroupEnablePreview): Promise<boolean> => {
      if (selectedNode?.kind !== 'group' || preview.groupId !== selectedNode.id) return false;
      const result = await dispatch({
        kind: 'enable_group_for_agents',
        groupId: selectedNode.id,
        previewToken: preview.previewToken,
        taskIds: preview.tasks.map(({ taskId }) => taskId)
      });
      return result.status === 'executed';
    },
    [dispatch, selectedNode]
  );

  const createNode = useCallback(
    (kind: NodeKind, position: Position): void => {
      void dispatch(
        kind === 'note'
          ? {
              kind: 'create_node',
              input: { title: 'New note', content: '', kind, position }
            }
          : {
              kind: 'create_node',
              input: {
                title: kind === 'group' ? 'New group' : 'New task',
                description: '',
                kind,
                position
              }
            }
      );
    },
    [dispatch]
  );

  const updateNode = useCallback(
    async (node: ProjectedNode, patch: EditableNodePatch): Promise<ProjectedNode | null> => {
      const result = await dispatch({ kind: 'update_node', nodeId: node.id, patch });
      return result.project?.nodes.find(({ id }) => id === node.id) ?? null;
    },
    [dispatch]
  );

  const moveNodes = useCallback(
    async (moves: readonly NodePositionMove[]): Promise<ProjectedProject | null> => {
      const result = await dispatch({ kind: 'move_nodes', moves: [...moves] });
      return result.project;
    },
    [dispatch]
  );

  const deleteSelection = useSelectionDeletion(dispatch, setSelection);

  const createRelationship = useCallback(
    (input: CreateRelationshipInput): void => {
      void dispatch({ kind: 'create_relationship', input });
    },
    [dispatch]
  );

  const cycleStatus = useCallback(
    (node: ProjectedWorkNode): void => void dispatch({ kind: 'cycle_status', nodeId: node.id }),
    [dispatch]
  );

  const setRequestedStatus = useCallback(
    (node: ProjectedWorkNode, requestedStatus: NodeStatus): void => {
      void updateNode(node, { requestedStatus });
    },
    [updateNode]
  );

  const canvasSession = useMemo<CanvasSession | null>(() => {
    if (!canvasView) return null;
    if (isKanbanCanvasView(canvasView)) {
      return { kind: 'kanban', view: canvasView, onSetRequestedStatus: setRequestedStatus };
    }
    if (isRoadmapCanvasView(canvasView)) {
      return {
        kind: 'roadmap',
        view: canvasView,
        isAutomaticRange: roadmapRange === null,
        onSetRoadmapRange: setRoadmapRange,
        onResetRoadmapRange: () => setRoadmapRange(null)
      };
    }
    if (isSwimlaneCanvasView(canvasView)) return { kind: 'swimlane', view: canvasView };
    return {
      kind: 'freeform',
      view: canvasView,
      onCreateNode: createNode,
      onMoveNodes: moveNodes
    };
  }, [canvasView, createNode, moveNodes, roadmapRange, setRequestedStatus, setRoadmapRange]);

  const canvasProps = useMemo(
    () => ({
      onCreateRelationship: createRelationship,
      onCycleStatus: cycleStatus,
      onDeleteSelection: (deletion: CanvasSelection) => void deleteSelection(deletion),
      onDeleteRelationship: removeRelationship,
      onRenameNode: (node: ProjectedNode, title: string) => updateNode(node, { title })
    }),
    [createRelationship, cycleStatus, deleteSelection, removeRelationship, updateNode]
  );

  if (workspaceQueries.some((query) => queryView<unknown>(query).status === 'loading')) {
    return (
      <main className="center-state document-screen" inert={inert}>
        Opening your local project…
      </main>
    );
  }
  const settings = projectSettingsQuery.data;
  if (
    !project ||
    !settings ||
    !executionQuery.data ||
    !canvasGraph ||
    !canvasView ||
    !canvasSession
  ) {
    return (
      <WorkspaceUnavailable
        inert={inert}
        onOpenLibrary={onOpenLibrary}
        queries={workspaceQueries}
      />
    );
  }

  return (
    <main className="shell" inert={inert}>
      <header className="topbar">
        <div className="brand-block">
          <button
            className="brand-home"
            type="button"
            onClick={onOpenLibrary}
            aria-label="Open Project Library"
          >
            <span className="brand-mark" aria-hidden="true">
              N<sup>2</sup>
            </span>
          </button>
          <span className="brand-divider" />
          <div>
            <strong>{summary?.name ?? '…'}</strong>
            <span>{project.referenceKey} Project</span>
          </div>
        </div>
        <div className="topbar-actions">
          <ActivityEntryPoint session={activitySession} />
          <button
            type="button"
            className="settings-entry"
            onClick={() => onOpenSettings(projectId)}
          >
            <span aria-hidden="true">⚙</span>
            Settings
          </button>
          <div className="local-indicator">
            <span />
            Stored on this machine
          </div>
        </div>
      </header>

      <section className="project-shell">
        <GraphCanvas
          canvasSession={canvasSession}
          settings={settings.effectiveValues}
          keyboardShortcutsEnabled={keyboardShortcutsEnabled}
          onSetSwimlaneScopeId={viewState.setSwimlaneScopeId}
          selection={selection}
          onSelectionChange={setSelection}
          filterControls={viewState.filterControls}
          noteExpansion={viewState.noteExpansion}
          onToggleTransformation={viewState.toggleTransformation}
          onShowFreeform={viewState.showFreeform}
          focusRequest={navigation.focusRequest}
          onFocusSettled={navigation.focusSettled}
          onPersonMovedViewport={navigation.personMovedViewport}
          {...canvasProps}
        />
        {selectedNode ? (
          <Inspector
            key={selectedNode.id}
            node={selectedNode}
            placement={selection.inspectorPlacement}
            onClose={() => setSelection(noSelection)}
            onDelete={(node) => void deleteSelection({ nodeIds: [node.id], relationshipIds: [] })}
            onUpdate={updateNode}
            execution={selectedTaskExecution}
            onEnableTaskForAgents={async () => {
              await dispatch({ kind: 'enable_task_for_agents', taskId: selectedNode.id });
            }}
            onDisableTaskForAgents={async () => {
              await dispatch({ kind: 'disable_task_for_agents', taskId: selectedNode.id });
            }}
            onPreviewGroupEnablement={previewSelectedGroup}
            onConfirmGroupEnablement={confirmSelectedGroup}
            relationships={relationships}
          />
        ) : null}
        {activitySession.open ? (
          <ActivityPanel
            session={activitySession}
            onOpenItem={navigate}
            pendingItem={navigation.pending}
          />
        ) : null}
      </section>
    </main>
  );
}
