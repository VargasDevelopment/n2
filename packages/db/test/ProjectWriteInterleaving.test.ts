import { ExecutionConflictError, ProjectApplication, ProjectArchivedError } from '@n2/application';
import { ProjectCommandSchema, type ProjectCommandInput } from '@n2/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectRepository } from '../src/index.js';
import { createTestProjectRepository } from './fixtures/projectDatabase.js';

type CommandWithoutId = ProjectCommandInput extends infer Command
  ? Command extends { commandId: string }
    ? Omit<Command, 'commandId'>
    : never
  : never;

/**
 * Two connections to one library. Connection A runs the write under test; once A has read its
 * Project, the next statement A starts gives connection B one chance to commit a competing change.
 * Every Project write must hold the write lock across that window, so B is refused with SQLITE_BUSY.
 */
describe('Project writes interleaved across two connections', () => {
  let directory: string;
  let repositories: ProjectRepository[];
  let a: ProjectApplication;
  let b: ProjectApplication;
  let interference: (() => void) | null;
  let projectRead: boolean;
  let competingWrite: unknown;
  let sequence: number;

  const uuid = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  const command = (application: ProjectApplication, input: CommandWithoutId) =>
    application.executeCommand(
      'default',
      ProjectCommandSchema.parse({ ...input, commandId: uuid() })
    );
  const claimCommand = (application: ProjectApplication, taskId: string): CommandWithoutId => {
    const task = application
      .queryExecution('default')
      .tasks.find((each) => each.taskId === taskId)!;
    return {
      kind: 'claim_task',
      taskId,
      attemptId: uuid(),
      workerId: 'worker-one',
      expectedFingerprint: task.currentFingerprint,
      expectedEnablementId: task.enablementId!
    };
  };
  const enableLocalTask = () =>
    command(a, { kind: 'enable_task_for_agents', taskId: 'local', enablementId: uuid() });

  /** Runs `write` on connection A while `competitor` tries to commit on connection B. */
  const interleave = <T>(write: () => T, competitor: () => void): T => {
    interference = competitor;
    projectRead = false;
    competingWrite = 'not attempted';
    try {
      return write();
    } finally {
      interference = null;
    }
  };
  const expectCompetitorBlocked = () =>
    expect(competingWrite).toMatchObject({ code: 'SQLITE_BUSY' });

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'n2-project-interleaving-'));
    const databasePath = join(directory, 'library.sqlite');
    interference = null;
    sequence = 3000;
    const first = createTestProjectRepository(databasePath, {
      verbose: (statement?: unknown) => {
        if (!interference) return;
        if (!projectRead) {
          projectRead = String(statement).includes('from "workspaces"');
          return;
        }
        const compete = interference;
        interference = null;
        try {
          compete();
          competingWrite = 'committed';
        } catch (error) {
          competingWrite = error;
        }
      }
    });
    // B never waits for the lock, so a competing commit is refused instead of queued.
    const second = new ProjectRepository(databasePath, { timeout: 0 });
    repositories = [first, second];
    a = new ProjectApplication(first);
    b = new ProjectApplication(second);
  });

  afterEach(() => {
    for (const repository of repositories) repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const archiveOnB = () => void b.archiveProject('default');

  it.each<{ family: string; write: () => unknown }>([
    {
      family: 'graph commands',
      write: () =>
        command(a, {
          kind: 'create_node',
          nodeId: uuid(),
          input: { kind: 'task', title: 'Raced', position: { x: 0, y: 0 } }
        })
    },
    {
      family: 'Project Setting writes',
      write: () =>
        a.updateProjectSettingOverride('default', { key: 'minimapVisible', value: false })
    },
    {
      family: 'Project Setting clears',
      write: () => a.clearProjectSettingOverride('default', 'minimapVisible')
    },
    {
      family: 'renames',
      write: () => a.renameProject('default', { name: 'Raced name' })
    }
  ])('keeps archive from committing inside $family', ({ write }) => {
    interleave(write, archiveOnB);
    expectCompetitorBlocked();

    expect(b.archiveProject('default').disposition).toBe('updated');
    expect(write).toThrowError(ProjectArchivedError);
  });

  it('keeps archive from committing inside a claim, then refuses it for the active Attempt', () => {
    enableLocalTask();
    const claim = claimCommand(a, 'local');
    interleave(() => command(a, claim), archiveOnB);
    expectCompetitorBlocked();

    expect(() => b.archiveProject('default')).toThrowError(ExecutionConflictError);
    expect(a.queryProjectLibrary().projects[0]?.archivedAt).toBeNull();
  });

  it('serializes an archive racing a claim instead of failing with a stale snapshot', () => {
    enableLocalTask();
    const claim = claimCommand(b, 'local');
    const archived = interleave(
      () => a.archiveProject('default'),
      () => void command(b, claim)
    );
    expectCompetitorBlocked();
    expect(archived.disposition).toBe('updated');

    expect(() => command(b, claim)).toThrowError(ProjectArchivedError);
    expect(
      b.queryExecution('default').tasks.find(({ taskId }) => taskId === 'local')
    ).toMatchObject({ activeAttempt: null });
  });

  it('serializes competing restores so the second reports unchanged', () => {
    a.archiveProject('default');
    const restored = interleave(
      () => a.restoreProject('default'),
      () => void b.restoreProject('default')
    );
    expectCompetitorBlocked();
    expect(restored.disposition).toBe('updated');
    expect(b.restoreProject('default').disposition).toBe('unchanged');
  });
});
