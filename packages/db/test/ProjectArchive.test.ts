import Database from 'better-sqlite3';
import { ProjectApplication, ProjectArchivedError } from '@n2/application';
import { ProjectCommandSchema, type ProjectCommandInput } from '@n2/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION, ProjectRepository } from '../src/index.js';
import { createTestProjectRepository } from './fixtures/projectDatabase.js';

type CommandWithoutId = ProjectCommandInput extends infer Command
  ? Command extends { commandId: string }
    ? Omit<Command, 'commandId'>
    : never
  : never;

const archived = ProjectArchivedError;

describe('Project archive, restore, and rename', () => {
  let directory: string;
  let databasePath: string;
  let repository: ProjectRepository;
  let application: ProjectApplication;
  let sequence: number;

  const uuid = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  const execute = (command: CommandWithoutId, commandId = uuid()) =>
    application.executeCommand('default', ProjectCommandSchema.parse({ ...command, commandId }));
  const taskExecution = (taskId: string) =>
    application.queryExecution('default').tasks.find((task) => task.taskId === taskId)!;
  const claim = (taskId: string, attemptId = uuid()) => {
    const task = taskExecution(taskId);
    return execute({
      kind: 'claim_task',
      taskId,
      attemptId,
      workerId: 'worker-one',
      expectedFingerprint: task.currentFingerprint,
      expectedEnablementId: task.enablementId!
    });
  };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'n2-project-archive-'));
    databasePath = join(directory, 'library.sqlite');
    repository = createTestProjectRepository(databasePath);
    application = new ProjectApplication(repository);
    sequence = 2000;
  });

  afterEach(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('migrates version 13 Projects to unarchived without touching their graphs', () => {
    const graphBeforeMigration = repository.getProject('default');
    repository.close();
    const version13 = new Database(databasePath);
    version13.exec('ALTER TABLE workspaces DROP COLUMN archived_at;');
    version13.exec('ALTER TABLE workspaces DROP COLUMN lifecycle_revision;');
    version13.pragma('user_version = 13');
    version13.close();

    repository = new ProjectRepository(databasePath);
    application = new ProjectApplication(repository);
    expect(repository.getProject('default')).toEqual(graphBeforeMigration);
    expect(application.queryProjectLibrary().projects).toEqual([
      expect.objectContaining({ id: 'default', archivedAt: null, lifecycleRevision: 0 })
    ]);
    const sqlite = new Database(databasePath, { readonly: true });
    expect(sqlite.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    sqlite.close();
  });

  it('archives and restores idempotently while preserving the Project and its history', () => {
    const settings = application.updateProjectSettingOverride('default', {
      key: 'handleOrientation',
      value: 'vertical'
    });
    const graph = application.queryProject('default');

    const first = application.archiveProject('default');
    expect(first).toMatchObject({
      disposition: 'updated',
      project: { id: 'default', lifecycleRevision: 1 }
    });
    const { archivedAt } = first.project;
    expect(archivedAt).toEqual(expect.any(String));
    expect(application.archiveProject('default')).toEqual({
      disposition: 'unchanged',
      project: first.project
    });

    expect(application.queryProjectLibrary().projects).toEqual([]);
    expect(application.queryProjectLibrary({ includeArchived: true }).projects).toEqual([
      first.project
    ]);
    expect(application.queryProject('default')).toEqual(graph);
    expect(application.explainNode('default', 'N2-3').node.id).toBe('local');
    expect(application.queryProjectSettings('default')).toEqual(settings);

    repository.close();
    repository = new ProjectRepository(databasePath);
    application = new ProjectApplication(repository);
    expect(application.queryProjectLibrary({ includeArchived: true }).projects).toEqual([
      expect.objectContaining({ id: 'default', archivedAt })
    ]);
    // Reopening never reseeds an archived starter Project.
    expect(application.queryProject('default')).toEqual(graph);

    expect(application.restoreProject('default')).toMatchObject({
      disposition: 'updated',
      project: { id: 'default', archivedAt: null, lifecycleRevision: 2 }
    });
    // A no-op restore commits nothing, so the revision stays put.
    expect(application.restoreProject('default')).toMatchObject({
      disposition: 'unchanged',
      project: { lifecycleRevision: 2 }
    });
    expect(application.queryProjectLibrary().projects).toEqual([
      expect.objectContaining({ id: 'default', archivedAt: null })
    ]);
  });

  it('renames only the display name, validates it, and is idempotent', () => {
    expect(application.renameProject('default', { name: '  Build N² v2  ' })).toEqual({
      disposition: 'updated',
      project: {
        id: 'default',
        name: 'Build N² v2',
        referenceKey: 'N2',
        canvasItemCount: 4,
        archivedAt: null,
        lifecycleRevision: 1
      }
    });
    expect(application.renameProject('default', { name: 'Build N² v2' })).toMatchObject({
      disposition: 'unchanged',
      project: { lifecycleRevision: 1 }
    });
    expect(() => application.renameProject('default', { name: '   ' })).toThrow();
    expect(() => application.renameProject('missing', { name: 'Ghost' })).toThrowError(
      /does not exist/
    );
    expect(application.queryProject('default').nodes.map(({ reference }) => reference)).toContain(
      'N2-1'
    );
  });

  it('rejects every write into an Archived Project but replays committed commands', () => {
    const commandId = uuid();
    const created = { kind: 'create_node', nodeId: uuid(), input: newTask } as const;
    execute(created, commandId);
    execute({ kind: 'enable_task_for_agents', taskId: 'local', enablementId: uuid() });
    application.archiveProject('default');
    expect(taskExecution('local')).toMatchObject({
      eligibility: 'enabled',
      dispatchable: false,
      claimBlockers: [{ code: 'project_archived', taskIds: [] }]
    });

    expect(execute(created, commandId).disposition).toBe('replayed');
    expect(() => execute({ kind: 'create_node', nodeId: uuid(), input: newTask })).toThrowError(
      archived
    );
    expect(() =>
      execute({ kind: 'enable_task_for_agents', taskId: 'agent', enablementId: uuid() })
    ).toThrowError(archived);
    expect(() => claim('local')).toThrowError(archived);
    expect(() =>
      application.updateProjectSettingOverride('default', {
        key: 'minimapVisible',
        value: false
      })
    ).toThrowError(archived);
    expect(() => application.clearProjectSettingOverride('default', 'minimapVisible')).toThrowError(
      archived
    );
    expect(() => application.renameProject('default', { name: 'Renamed' })).toThrowError(archived);
    expect(application.queryProject('default').nodes).toHaveLength(5);

    application.restoreProject('default');
    expect(claim('local').disposition).toBe('applied');
  });

  it('refuses to archive while an Execution Attempt is active or stop-requested', () => {
    execute({ kind: 'enable_task_for_agents', taskId: 'local', enablementId: uuid() });
    const attemptId = uuid();
    claim('local', attemptId);
    const expectArchiveRefused = () =>
      expect(() => application.archiveProject('default')).toThrowError(
        expect.objectContaining({
          reason: 'project_has_active_attempt',
          details: { taskIds: ['local'] }
        })
      );
    expectArchiveRefused();

    execute({ kind: 'disable_task_for_agents', taskId: 'local' });
    expect(taskExecution('local').activeAttempt).toMatchObject({ state: 'stop_requested' });
    expectArchiveRefused();
    expect(application.queryProjectLibrary().projects[0]?.archivedAt).toBeNull();

    execute({ kind: 'confirm_attempt_stopped', attemptId, workerId: 'worker-one' });
    expect(application.archiveProject('default').disposition).toBe('updated');
  });

  it('keeps creation retries for an Archived Project archived', () => {
    const input = { projectId: uuid(), name: 'Electricity Renewal 2026', referenceKey: 'ELEC' };
    application.createProject(input);
    const archivedProject = application.archiveProject(input.projectId).project;
    expect(application.createProject(input)).toEqual({
      disposition: 'existing',
      project: archivedProject
    });
  });
});

const newTask = { kind: 'task', title: 'Archived write', position: { x: 0, y: 0 } } as const;
