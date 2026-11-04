import Database from 'better-sqlite3';
import { ProjectApplication } from '@n2/application';
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

describe('agent execution persistence', () => {
  let directory: string;
  let repository: ProjectRepository;
  let application: ProjectApplication;
  let sequence: number;

  const uuid = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` as const;

  const execute = (command: CommandWithoutId, commandId = uuid()) =>
    application.executeCommand('default', ProjectCommandSchema.parse({ ...command, commandId }));

  const enable = (taskId: string) => {
    const enablementId = uuid();
    execute({ kind: 'enable_task_for_agents', taskId, enablementId });
    return application.queryExecution('default').tasks.find((task) => task.taskId === taskId)!;
  };

  const claim = (
    taskId: string,
    workerId = 'worker-one',
    attemptId = uuid(),
    commandId = uuid()
  ) => {
    const task = application
      .queryExecution('default')
      .tasks.find((item) => item.taskId === taskId)!;
    return application.executeCommand('default', {
      kind: 'claim_task',
      commandId,
      taskId,
      attemptId,
      workerId,
      expectedFingerprint: task.currentFingerprint,
      expectedEnablementId: task.enablementId!
    });
  };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'n2-execution-'));
    repository = createTestProjectRepository(join(directory, 'project.sqlite'));
    application = new ProjectApplication(repository);
    sequence = 1000;
  });

  afterEach(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('migrates existing Tasks OFF and leaves newly created Tasks OFF', () => {
    const databasePath = join(directory, 'project.sqlite');
    const graphBeforeMigration = repository.getProject('default');
    repository.close();
    const version12 = new Database(databasePath);
    version12.exec(`
      DROP TABLE execution_attempts;
      DROP TABLE execution_enablement_reservations;
      DROP TABLE execution_eligibilities;
    `);
    version12.pragma('user_version = 12');
    version12.close();

    repository = new ProjectRepository(databasePath);
    application = new ProjectApplication(repository);
    expect(repository.getProject('default')).toEqual(graphBeforeMigration);
    expect(
      application.queryExecution('default').tasks.every(({ eligibility }) => eligibility === 'off')
    ).toBe(true);
    const taskId = uuid();
    execute({
      kind: 'create_node',
      nodeId: taskId,
      input: { kind: 'task', title: 'Future work', position: { x: 0, y: 0 } }
    });
    expect(
      application.queryExecution('default').tasks.find((task) => task.taskId === taskId)
    ).toMatchObject({ eligibility: 'off', dispatchable: false });

    const sqlite = new Database(databasePath, { readonly: true });
    expect(sqlite.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM execution_eligibilities').get()).toEqual({
      count: 0
    });
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM execution_enablement_reservations').get()
    ).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM execution_attempts').get()).toEqual({
      count: 0
    });
    sqlite.close();
  });

  it('materializes a previewed nested, shared Task set and does not inherit to later work', () => {
    const outer = uuid();
    const inner = uuid();
    const sharedTask = uuid();
    for (const [nodeId, kind, title] of [
      [outer, 'group', 'Outer'],
      [inner, 'group', 'Inner'],
      [sharedTask, 'task', 'Shared Task']
    ] as const) {
      execute({ kind: 'create_node', nodeId, input: { kind, title, position: { x: 0, y: 0 } } });
    }
    execute({
      kind: 'create_relationship',
      relationshipId: uuid(),
      input: { kind: 'member_of', memberId: inner, groupId: outer }
    });
    execute({
      kind: 'create_relationship',
      relationshipId: uuid(),
      input: { kind: 'member_of', memberId: sharedTask, groupId: inner }
    });
    execute({
      kind: 'create_relationship',
      relationshipId: uuid(),
      input: { kind: 'member_of', memberId: sharedTask, groupId: outer }
    });

    const preview = application.previewGroupEnablement('default', outer);
    expect(preview.tasks.map(({ taskId }) => taskId)).toEqual([sharedTask]);
    execute({
      kind: 'enable_group_for_agents',
      groupId: outer,
      previewToken: preview.previewToken,
      taskEnablements: [{ taskId: sharedTask, enablementId: uuid() }]
    });
    expect(
      application.queryExecution('default').tasks.find(({ taskId }) => taskId === sharedTask)
    ).toMatchObject({ eligibility: 'enabled' });

    const laterTask = uuid();
    execute({
      kind: 'create_node',
      nodeId: laterTask,
      input: { kind: 'task', title: 'Attached later', position: { x: 0, y: 0 } }
    });
    execute({
      kind: 'create_relationship',
      relationshipId: uuid(),
      input: { kind: 'member_of', memberId: laterTask, groupId: inner }
    });
    expect(
      application.queryExecution('default').tasks.find(({ taskId }) => taskId === laterTask)
    ).toMatchObject({ eligibility: 'off' });

    expect(() =>
      execute({
        kind: 'enable_group_for_agents',
        groupId: outer,
        previewToken: preview.previewToken,
        taskEnablements: [{ taskId: sharedTask, enablementId: uuid() }]
      })
    ).toThrowError(expect.objectContaining({ reason: 'preview_changed' }));
  });

  it('invalidates eligibility for title, description, and Depends on edits but not planning edits', () => {
    let task = enable('local');
    const enabledFingerprint = task.currentFingerprint;

    execute({
      kind: 'update_node',
      nodeId: 'local',
      expectedVersion: 0,
      patch: { position: { x: 999, y: 999 }, requestedStatus: 'ready' }
    });
    task = application.queryExecution('default').tasks.find(({ taskId }) => taskId === 'local')!;
    expect(task.currentFingerprint).toBe(enabledFingerprint);
    expect(task.eligibility).toBe('enabled');

    execute({
      kind: 'update_node',
      nodeId: 'local',
      expectedVersion: 1,
      patch: { planningPlacement: { kind: 'milestone', date: '2026-11-01' } }
    });
    expect(
      application.queryExecution('default').tasks.find(({ taskId }) => taskId === 'local')
        ?.currentFingerprint
    ).toBe(enabledFingerprint);

    const evidenceNote = uuid();
    execute({
      kind: 'create_node',
      nodeId: evidenceNote,
      input: {
        kind: 'note',
        title: 'Evidence',
        content: 'Initial observation',
        position: { x: 0, y: 0 }
      }
    });
    execute({
      kind: 'update_node',
      nodeId: evidenceNote,
      expectedVersion: 0,
      patch: { content: 'Worker progress evidence' }
    });
    const secondaryGroup = uuid();
    execute({
      kind: 'create_node',
      nodeId: secondaryGroup,
      input: { kind: 'group', title: 'Secondary scope', position: { x: 0, y: 0 } }
    });
    execute({
      kind: 'create_relationship',
      relationshipId: uuid(),
      input: { kind: 'member_of', memberId: 'local', groupId: secondaryGroup }
    });
    expect(
      application.queryExecution('default').tasks.find(({ taskId }) => taskId === 'local')
        ?.currentFingerprint
    ).toBe(enabledFingerprint);

    execute({
      kind: 'update_node',
      nodeId: 'local',
      expectedVersion: 2,
      patch: { title: 'Material title edit' }
    });
    expect(
      application.queryExecution('default').tasks.find(({ taskId }) => taskId === 'local')
    ).toMatchObject({ eligibility: 'instructions_changed' });

    enable('local');
    execute({
      kind: 'update_node',
      nodeId: 'local',
      expectedVersion: 3,
      patch: { description: 'New acceptance criteria and scope' }
    });
    expect(
      application.queryExecution('default').tasks.find(({ taskId }) => taskId === 'local')
    ).toMatchObject({ eligibility: 'instructions_changed' });

    enable('local');
    const additionalDependency = uuid();
    execute({
      kind: 'create_node',
      nodeId: additionalDependency,
      input: { kind: 'task', title: 'Additional dependency', position: { x: 0, y: 0 } }
    });
    execute({
      kind: 'update_node',
      nodeId: additionalDependency,
      expectedVersion: 0,
      patch: { requestedStatus: 'done' }
    });
    execute({
      kind: 'create_relationship',
      relationshipId: uuid(),
      input: { kind: 'depends_on', dependentId: 'local', dependencyId: additionalDependency }
    });
    expect(
      application.queryExecution('default').tasks.find(({ taskId }) => taskId === 'local')
    ).toMatchObject({ eligibility: 'instructions_changed' });

    enable('domain');
    execute({
      kind: 'create_relationship',
      relationshipId: uuid(),
      input: { kind: 'depends_on', dependentId: 'agent', dependencyId: 'domain' }
    });
    expect(
      application.queryExecution('default').tasks.find(({ taskId }) => taskId === 'domain')
    ).toMatchObject({ eligibility: 'instructions_changed' });
  });

  it('permanently reserves Task and Group enablement IDs', () => {
    const taskEnablementId = uuid();
    execute({ kind: 'enable_task_for_agents', taskId: 'local', enablementId: taskEnablementId });
    execute({ kind: 'disable_task_for_agents', taskId: 'local' });
    expect(() =>
      execute({ kind: 'enable_task_for_agents', taskId: 'local', enablementId: taskEnablementId })
    ).toThrowError(expect.objectContaining({ reason: 'enablement_id_conflict' }));
    execute({ kind: 'enable_task_for_agents', taskId: 'local', enablementId: uuid() });
    expect(() =>
      execute({ kind: 'enable_task_for_agents', taskId: 'local', enablementId: taskEnablementId })
    ).toThrowError(expect.objectContaining({ reason: 'enablement_id_conflict' }));

    const groupId = uuid();
    const firstTaskId = uuid();
    const secondTaskId = uuid();
    for (const [nodeId, kind] of [
      [groupId, 'group'],
      [firstTaskId, 'task'],
      [secondTaskId, 'task']
    ] as const) {
      execute({
        kind: 'create_node',
        nodeId,
        input: { kind, title: nodeId, position: { x: 0, y: 0 } }
      });
    }
    for (const taskId of [firstTaskId, secondTaskId]) {
      execute({
        kind: 'create_relationship',
        relationshipId: uuid(),
        input: { kind: 'member_of', memberId: taskId, groupId }
      });
    }
    const preview = application.previewGroupEnablement('default', groupId);
    const firstEnablementId = uuid();
    const secondEnablementId = uuid();
    execute({
      kind: 'enable_group_for_agents',
      groupId,
      previewToken: preview.previewToken,
      taskEnablements: [
        { taskId: firstTaskId, enablementId: firstEnablementId },
        { taskId: secondTaskId, enablementId: secondEnablementId }
      ]
    });
    const before = application
      .queryExecution('default')
      .tasks.filter(({ taskId }) => new Set<string>([firstTaskId, secondTaskId]).has(taskId));
    expect(() =>
      execute({
        kind: 'enable_group_for_agents',
        groupId,
        previewToken: preview.previewToken,
        taskEnablements: [
          { taskId: firstTaskId, enablementId: uuid() },
          { taskId: secondTaskId, enablementId: secondEnablementId }
        ]
      })
    ).toThrowError(expect.objectContaining({ reason: 'enablement_id_conflict' }));
    const after = application
      .queryExecution('default')
      .tasks.filter(({ taskId }) => new Set<string>([firstTaskId, secondTaskId]).has(taskId));
    expect(after).toEqual(before);
  });

  it('does not let Ready or enabled dependents authorize unfinished prerequisites', () => {
    const agent = enable('agent');
    expect(agent.claimBlockers).toContainEqual({
      code: 'unfinished_dependencies',
      taskIds: ['local']
    });
    expect(
      application.queryExecution('default').tasks.find(({ taskId }) => taskId === 'local')
    ).toMatchObject({ eligibility: 'off' });
    expect(() => claim('agent')).toThrowError(
      expect.objectContaining({ reason: 'prerequisite_incomplete' })
    );
  });

  it('freezes claim input, reports newer instructions, and requires confirmed stopping', () => {
    const enabled = enable('local');
    const attemptId = uuid();
    claim('local', 'worker-one', attemptId);
    const claimed = application
      .queryExecution('default')
      .attempts.find((attempt) => attempt.attemptId === attemptId)!;
    expect(claimed.inputSnapshot.title).toBe('Make local persistence boring');
    expect(claimed.claimedFingerprint).toBe(enabled.currentFingerprint);
    execute({
      kind: 'record_attempt_progress',
      attemptId,
      workerId: 'worker-one',
      progress: 'Implemented the first safe step.'
    });
    execute({ kind: 'heartbeat_attempt', attemptId, workerId: 'worker-one' });
    expect(
      application.queryExecution('default').attempts.find((item) => item.attemptId === attemptId)
    ).toMatchObject({
      newerInstructionsExist: false,
      progress: 'Implemented the first safe step.'
    });

    execute({
      kind: 'update_node',
      nodeId: 'local',
      expectedVersion: 0,
      patch: { title: 'Newer instructions' }
    });
    let attempt = application
      .queryExecution('default')
      .attempts.find((item) => item.attemptId === attemptId)!;
    expect(attempt.inputSnapshot.title).toBe('Make local persistence boring');
    expect(attempt.newerInstructionsExist).toBe(true);

    execute({ kind: 'disable_task_for_agents', taskId: 'local' });
    attempt = application
      .queryExecution('default')
      .attempts.find((item) => item.attemptId === attemptId)!;
    expect(attempt.state).toBe('stop_requested');
    expect(attempt.stopRequested).toBe(true);
    expect(attempt.finishedAt).toBeNull();
    expect(() =>
      execute({ kind: 'confirm_attempt_stopped', attemptId, workerId: 'worker-two' })
    ).toThrowError(expect.objectContaining({ reason: 'attempt_owner_mismatch' }));
    execute({ kind: 'confirm_attempt_stopped', attemptId, workerId: 'worker-one' });
    expect(
      application.queryExecution('default').attempts.find((item) => item.attemptId === attemptId)
    ).toMatchObject({ state: 'stopped', stopRequested: false });
  });

  it('turns an explicit pause into a Stop Request and rejects new claims', () => {
    enable('local');
    const attemptId = uuid();
    claim('local', 'worker-one', attemptId);
    execute({
      kind: 'update_node',
      nodeId: 'local',
      expectedVersion: 0,
      patch: { requestedStatus: 'blocked' }
    });
    expect(
      application.queryExecution('default').attempts.find((item) => item.attemptId === attemptId)
    ).toMatchObject({ state: 'stop_requested' });
    execute({ kind: 'confirm_attempt_stopped', attemptId, workerId: 'worker-one' });
    expect(() => claim('local')).toThrowError(expect.objectContaining({ reason: 'task_paused' }));
  });

  it('rejects stale claims, competing workers, and non-owner lifecycle commands', () => {
    const enabled = enable('local');
    const staleEnablementId = enabled.enablementId!;
    enable('local');
    const current = application
      .queryExecution('default')
      .tasks.find(({ taskId }) => taskId === 'local')!;
    expect(() =>
      application.executeCommand('default', {
        kind: 'claim_task',
        commandId: uuid(),
        taskId: 'local',
        attemptId: uuid(),
        workerId: 'stale-worker',
        expectedFingerprint: current.currentFingerprint,
        expectedEnablementId: staleEnablementId
      })
    ).toThrowError(expect.objectContaining({ reason: 'stale_enablement' }));

    const attemptId = uuid();
    const claimCommandId = uuid();
    const first = claim('local', 'worker-one', attemptId, claimCommandId);
    const replay = application.executeCommand('default', {
      kind: 'claim_task',
      commandId: claimCommandId,
      taskId: 'local',
      attemptId,
      workerId: 'worker-one',
      expectedFingerprint: current.currentFingerprint,
      expectedEnablementId: current.enablementId!
    });
    expect(first.disposition).toBe('applied');
    expect(replay.disposition).toBe('replayed');
    expect(replay.outcome).toEqual(first.outcome);
    expect(() => claim('local', 'worker-two')).toThrowError(
      expect.objectContaining({ reason: 'attempt_active' })
    );
    expect(() =>
      execute({ kind: 'heartbeat_attempt', attemptId, workerId: 'worker-two' })
    ).toThrowError(expect.objectContaining({ reason: 'attempt_owner_mismatch' }));
  });

  it('rejects a claim carrying an old fingerprint after a material edit', () => {
    const enabled = enable('local');
    execute({
      kind: 'update_node',
      nodeId: 'local',
      expectedVersion: 0,
      patch: { description: 'Changed after queueing' }
    });
    expect(() =>
      application.executeCommand('default', {
        kind: 'claim_task',
        commandId: uuid(),
        taskId: 'local',
        attemptId: uuid(),
        workerId: 'stale-worker',
        expectedFingerprint: enabled.currentFingerprint,
        expectedEnablementId: enabled.enablementId!
      })
    ).toThrowError(expect.objectContaining({ reason: 'stale_fingerprint' }));
  });

  it('supports terminal Attempt outcomes and rejects commands for a superseded Attempt', () => {
    enable('local');
    const completedId = uuid();
    claim('local', 'worker-one', completedId);
    execute({ kind: 'complete_attempt', attemptId: completedId, workerId: 'worker-one' });

    const failedId = uuid();
    claim('local', 'worker-two', failedId);
    expect(() =>
      execute({ kind: 'heartbeat_attempt', attemptId: completedId, workerId: 'worker-one' })
    ).toThrowError(expect.objectContaining({ reason: 'attempt_superseded' }));
    execute({
      kind: 'fail_attempt',
      attemptId: failedId,
      workerId: 'worker-two',
      error: 'The external tool failed.'
    });

    const releasedId = uuid();
    claim('local', 'worker-three', releasedId);
    execute({ kind: 'release_attempt', attemptId: releasedId, workerId: 'worker-three' });
    expect(
      application
        .queryExecution('default')
        .attempts.map(({ attemptId, state, progress }) => ({ attemptId, state, progress }))
    ).toEqual(
      expect.arrayContaining([
        { attemptId: completedId, state: 'completed', progress: null },
        { attemptId: failedId, state: 'failed', progress: 'The external tool failed.' },
        { attemptId: releasedId, state: 'released', progress: null }
      ])
    );
  });

  it('blocks deletion while an Attempt can run and retains terminal Attempts after deletion', () => {
    const taskId = uuid();
    execute({
      kind: 'create_node',
      nodeId: taskId,
      input: { kind: 'task', title: 'Disposable Task', position: { x: 0, y: 0 } }
    });
    enable(taskId);
    const attemptId = uuid();
    claim(taskId, 'worker-one', attemptId);

    expect(() => execute({ kind: 'delete_node', nodeId: taskId, expectedVersion: 0 })).toThrowError(
      expect.objectContaining({ reason: 'task_has_active_attempt' })
    );
    execute({ kind: 'disable_task_for_agents', taskId });
    expect(() => execute({ kind: 'delete_node', nodeId: taskId, expectedVersion: 0 })).toThrowError(
      expect.objectContaining({ reason: 'task_has_active_attempt' })
    );

    execute({ kind: 'confirm_attempt_stopped', attemptId, workerId: 'worker-one' });
    execute({ kind: 'delete_node', nodeId: taskId, expectedVersion: 0 });
    expect(application.queryExecution('default').tasks.some((task) => task.taskId === taskId)).toBe(
      false
    );
    expect(
      application
        .queryExecution('default')
        .attempts.find((attempt) => attempt.attemptId === attemptId)
    ).toMatchObject({ taskId, state: 'stopped', newerInstructionsExist: false });
  });
});
