import {
  ProjectNameSchema,
  ProjectReferenceKeySchema,
  type CreateProjectInput,
  type ProjectSettingOverrides
} from '@n2/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import * as api from '../api.js';
import { queryView } from '../queryView.js';
import { useRefreshFailureNotice } from '../useRefreshFailureNotice.js';
import { useNotify, type ToastActionButtonProps } from '../notificationContext.js';
import {
  PROJECT_LIBRARY_QUERY_KEY,
  reconcileProjectSummary,
  usePendingLifecycleChange,
  useProjectLibraryQuery,
  useProjectLifecycle
} from '../projectLibraryQueries.js';
import { ArchivedProjects } from './ArchivedProjects.js';
import { ToastActionButton } from './NotificationProvider.js';
import { ProjectCard } from './ProjectCard.js';
import { useLibraryActivitySession } from '../activityQueries.js';
import { libraryDigest } from '../activityPresentation.js';
import type { ProjectArrival } from '../appLocation.js';
import { LibraryActivityPanel } from './LibraryActivityPanel.js';
import { LibraryDigest } from './LibraryDigest.js';
import { ProjectCreationSettings } from './ProjectCreationSettings.js';
import './ProjectLibrary.css';

const isAmbiguousCreationError = (error: Error | null): boolean =>
  error instanceof api.LocalTransportError || error instanceof api.LocalProtocolError;

const suggestedReferenceKey = (name: string): string => {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  if (words.length === 0) return '';
  const initials = words.map((word) => word[0]).join('');
  const candidate = initials.length >= 2 ? initials : words[0]!;
  return candidate.replace(/^[^A-Z]+/, '').slice(0, 10);
};

type ProjectLibraryProps = {
  inert?: boolean;
  onCreationActiveChange: (active: boolean) => void;
  onOpenProject: (projectId: string, arrival?: ProjectArrival) => void;
  onProjectCreated: (projectId: string) => void;
  onOpenSettings: () => void;
};

export function ProjectLibrary({
  inert = false,
  onCreationActiveChange,
  onOpenProject,
  onProjectCreated,
  onOpenSettings
}: ProjectLibraryProps) {
  const queryClient = useQueryClient();
  const projectQuery = useProjectLibraryQuery();
  const library = queryView(projectQuery);
  useRefreshFailureNotice(
    [projectQuery],
    'Could not refresh the Project Library. Showing the last loaded list.'
  );
  const undoArchive = useProjectLifecycle().mutateAsync;
  const { notify } = useNotify();
  const [isCreating, setIsCreating] = useState(false);
  const [draftProjectId, setDraftProjectId] = useState(() => crypto.randomUUID());
  const [name, setName] = useState('');
  const [referenceKey, setReferenceKey] = useState('');
  const [referenceKeyEdited, setReferenceKeyEdited] = useState(false);
  const [settingsOverrides, setSettingsOverrides] = useState<ProjectSettingOverrides>({});
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(
    () => () => {
      onCreationActiveChange(false);
    },
    [onCreationActiveChange]
  );

  const normalizedKey = useMemo(
    () =>
      referenceKey
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 10),
    [referenceKey]
  );

  const creation = useMutation({
    mutationFn: api.createProject,
    onSuccess: async ({ project }) => {
      await reconcileProjectSummary(queryClient, project);
      onProjectCreated(project.id);
    },
    onError: (error) => {
      if (isAmbiguousCreationError(error)) {
        void queryClient.invalidateQueries({ queryKey: PROJECT_LIBRARY_QUERY_KEY });
      }
    }
  });
  const creationIntentLocked = isAmbiguousCreationError(creation.error);
  const projects = projectQuery.data?.projects ?? [];
  const activeProjects = projects.filter(({ archivedAt }) => archivedAt === null);
  const archivedProjects = projects.filter(({ archivedAt }) => archivedAt !== null);
  const creationIntentFrozen = creation.isPending || creationIntentLocked;
  const activitySession = useLibraryActivitySession(
    projectQuery.data ? new Set(activeProjects.map(({ id }) => id)) : undefined
  );
  const libraryActivity = activitySession.live;
  const digest = libraryActivity ? libraryDigest(libraryActivity) : [];
  // Every way out of the Library comes through here, so an open Project draft is never dropped.
  const openProject = (projectId: string, arrival?: ProjectArrival): void => {
    if (!isCreating) onOpenProject(projectId, arrival);
  };

  const updateName = (value: string): void => {
    setName(value);
    if (!referenceKeyEdited) setReferenceKey(suggestedReferenceKey(value));
    setValidationError(null);
  };

  const resetCreationDraft = (): void => {
    creation.reset();
    setDraftProjectId(crypto.randomUUID());
    setName('');
    setReferenceKey('');
    setReferenceKeyEdited(false);
    setSettingsOverrides({});
    setValidationError(null);
  };

  const openCreationDraft = (): void => {
    if (isCreating) return;
    resetCreationDraft();
    setIsCreating(true);
    onCreationActiveChange(true);
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nameResult = ProjectNameSchema.safeParse(name);
    const keyResult = ProjectReferenceKeySchema.safeParse(normalizedKey);
    if (!nameResult.success || !keyResult.success) {
      setValidationError(
        nameResult.error?.issues[0]?.message ?? keyResult.error?.issues[0]?.message ?? null
      );
      return;
    }
    const input: CreateProjectInput = {
      projectId: draftProjectId,
      name: nameResult.data,
      referenceKey: keyResult.data,
      ...(Object.keys(settingsOverrides).length === 0 ? {} : { settings: settingsOverrides })
    };
    creation.mutate(input);
  };

  return (
    <main className="project-library document-screen" inert={inert}>
      <header className="project-library__topbar">
        <span className="brand-mark" aria-label="N squared">
          N<sup>2</sup>
        </span>
        <div className="project-library__actions">
          <button
            type="button"
            className="settings-entry"
            disabled={isCreating}
            onClick={onOpenSettings}
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

      <section className="project-library__content">
        <div className="project-library__intro">
          <div>
            <span className="project-library__eyebrow">Project library</span>
            <h1>Choose where to think.</h1>
            <p>Each Project is an independent graph with its own references and canvas.</p>
          </div>
          <button
            className="project-library__new"
            type="button"
            disabled={isCreating}
            onClick={openCreationDraft}
          >
            <span aria-hidden="true">＋</span>
            New Project
          </button>
        </div>

        {isCreating ? (
          <form className="project-creator" onSubmit={submit}>
            <div className="project-creator__heading">
              <div>
                <span className="project-library__eyebrow">New Project</span>
                <h2>Start with an empty canvas</h2>
              </div>
              <button
                type="button"
                className="project-creator__close"
                onClick={() => {
                  resetCreationDraft();
                  setIsCreating(false);
                  onCreationActiveChange(false);
                }}
                aria-label="Close Project creator"
                disabled={creation.isPending}
              >
                ×
              </button>
            </div>
            <div className="project-creator__fields">
              <label>
                <span>Name</span>
                <input
                  autoFocus
                  disabled={creationIntentFrozen}
                  value={name}
                  onChange={(event) => updateName(event.target.value)}
                  placeholder="Project name"
                  maxLength={120}
                />
              </label>
              <label>
                <span>Reference key</span>
                <input
                  value={normalizedKey}
                  disabled={creationIntentFrozen}
                  onChange={(event) => {
                    setReferenceKeyEdited(true);
                    setReferenceKey(event.target.value);
                    setValidationError(null);
                  }}
                  placeholder="KEY"
                  maxLength={10}
                  spellCheck={false}
                />
              </label>
            </div>
            <ProjectCreationSettings
              disabled={creationIntentFrozen}
              draftProjectId={draftProjectId}
              onChange={setSettingsOverrides}
              overrides={settingsOverrides}
            />
            <div className="project-creator__footer">
              <p>
                Canvas items begin at <strong>{normalizedKey || 'KEY'}-1</strong>. The key stays
                fixed so references remain durable.
              </p>
              <button type="submit" disabled={creation.isPending}>
                {creation.isPending
                  ? 'Creating…'
                  : creationIntentLocked
                    ? 'Retry creation'
                    : 'Create Project'}
              </button>
            </div>
            <ProjectCreationError
              validationError={validationError}
              error={creation.error}
              intentLocked={creationIntentLocked}
            />
          </form>
        ) : null}

        {library.status === 'loading' ? (
          <div className="project-library__state">Opening your Project Library…</div>
        ) : library.status === 'unavailable' ? (
          <div className="project-library__state project-library__state--error">
            <strong>N² could not reach its local service.</strong>
            <span>{library.error.message}</span>
            <button
              type="button"
              disabled={projectQuery.isFetching}
              onClick={() => void projectQuery.refetch()}
            >
              {projectQuery.isFetching ? 'Retrying…' : 'Try again'}
            </button>
          </div>
        ) : (
          <>
            {activeProjects.length > 0 ? (
              <LibraryDigest
                activity={libraryActivity}
                digest={digest}
                projects={activeProjects}
                feedOpen={activitySession.open}
                inert={isCreating}
                onOpenFeed={activitySession.toggle}
                onOpenProjectActivity={(projectId) => openProject(projectId, { kind: 'activity' })}
              />
            ) : null}
            {activeProjects.length === 0 ? (
              <p className="project-library__empty">
                {archivedProjects.length === 0
                  ? 'No Projects yet. Start one to begin mapping work.'
                  : 'Every Project is archived. Start a new one or restore one below.'}
              </p>
            ) : (
              <div className="project-list" aria-label="Projects" inert={isCreating}>
                {activeProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    digest={digest.find(({ projectId }) => projectId === project.id)}
                    disabled={isCreating}
                    onOpen={openProject}
                    // Global, not session-bound: Undo must stay reachable after navigating away.
                    onArchived={(archived) =>
                      notify({
                        key: `project-archived:${archived.id}`,
                        tone: 'info',
                        message: (
                          <>
                            <strong>{archived.name}</strong> was archived.
                          </>
                        ),
                        action: {
                          label: 'Undo',
                          pendingLabel: 'Restoring…',
                          run: () => undoArchive({ kind: 'restore', projectId: archived.id }),
                          render: (button) => (
                            <ArchiveUndoAction projectId={archived.id} button={button} />
                          )
                        }
                      })
                    }
                  />
                ))}
              </div>
            )}
            <ArchivedProjects projects={archivedProjects} disabled={isCreating} />
          </>
        )}
      </section>
      {activitySession.open ? (
        <LibraryActivityPanel
          session={activitySession}
          projects={projects}
          onOpenProject={openProject}
        />
      ) : null}
    </main>
  );
}

function ProjectCreationError({
  validationError,
  error,
  intentLocked
}: {
  validationError: string | null;
  error: Error | null;
  intentLocked: boolean;
}) {
  return validationError || error ? (
    <p className="project-creator__error" role="alert">
      {validationError ?? error?.message}
      {intentLocked
        ? ' Retry this unchanged intent, or close it and verify the Project Library before starting over.'
        : null}
    </p>
  ) : null;
}

/** Undo holds while any lifecycle change to the Project is pending, like every other action. */
function ArchiveUndoAction({
  projectId,
  button
}: {
  projectId: string;
  button: ToastActionButtonProps;
}) {
  const pending = usePendingLifecycleChange(projectId);
  return <ToastActionButton {...button} disabled={pending !== undefined} />;
}
