import type { ProjectCommand } from '@n2/contracts';
import { describe, expect, it, vi } from 'vitest';
import { executeExecutionCommand, executionFingerprint } from '../src/execution.js';
import { MemoryProjectStore } from './memoryProjectStore.js';

describe('claim validation order', () => {
  it('rejects the first conflict without writing, then claims only after every check passes', () => {
    const writer = new MemoryProjectStore();
    const project = writer.getProject('default');
    const taskIndex = project.nodes.findIndex(({ id }) => id === 'agent');
    const task = project.nodes[taskIndex]!;
    if (task.kind !== 'task') throw new Error('Expected a Task fixture.');
    task.requestedStatus = 'blocked';
    const fingerprint = executionFingerprint(project, task.id);
    const command: Extract<ProjectCommand, { kind: 'claim_task' }> = {
      kind: 'claim_task',
      commandId: '00000000-0000-4000-8000-000000000001',
      taskId: 'missing',
      attemptId: '00000000-0000-4000-8000-000000000002',
      workerId: 'worker',
      expectedFingerprint: 'sha256:stale',
      expectedEnablementId: '00000000-0000-4000-8000-000000000003'
    };
    const reserved = vi.spyOn(writer, 'isExecutionAttemptIdReserved').mockReturnValue(true);
    const create = vi.spyOn(writer, 'createExecutionAttempt');
    const reject = (reason: string) => {
      expect(() => executeExecutionCommand(project.id, project, command, writer)).toThrowError(
        expect.objectContaining({ reason })
      );
      expect(create).not.toHaveBeenCalled();
    };

    reject('task_required');
    command.taskId = task.id;
    project.nodes[taskIndex] = { ...task, kind: 'group' };
    reject('task_required');
    project.nodes[taskIndex] = task;
    reject('attempt_id_conflict');
    reserved.mockReturnValue(false);
    reject('eligibility_disabled');
    const eligibility = {
      taskId: task.id,
      enabled: false,
      enablementId: '00000000-0000-4000-8000-000000000004',
      enabledFingerprint: 'sha256:older-instructions',
      enabledAt: '2026-10-15T00:00:00.000Z',
      disabledAt: null
    };
    writer.saveExecutionEligibility(eligibility);
    reject('eligibility_disabled');
    eligibility.enabled = true;
    writer.saveExecutionEligibility(eligibility);
    reject('stale_fingerprint');
    command.expectedFingerprint = fingerprint;
    reject('stale_enablement');
    command.expectedEnablementId = eligibility.enablementId;
    reject('instructions_changed');
    eligibility.enabledFingerprint = fingerprint;
    writer.saveExecutionEligibility(eligibility);
    reject('task_paused');
    task.requestedStatus = 'done';
    reject('task_done');
    task.requestedStatus = 'ready';
    reject('prerequisite_incomplete');
    const dependency = project.nodes.find(({ id }) => id === 'local')!;
    if (dependency.kind !== 'task') throw new Error('Expected a Task dependency.');
    dependency.requestedStatus = 'done';

    executeExecutionCommand(project.id, project, command, writer);
    expect(create).toHaveBeenCalledOnce();
    expect(writer.getExecutionAttempt(command.attemptId)).toMatchObject({
      taskId: task.id,
      workerId: command.workerId,
      claimedFingerprint: fingerprint,
      enablementId: eligibility.enablementId,
      state: 'active',
      progress: null,
      stopRequestedAt: null,
      finishedAt: null,
      inputSnapshot: {
        taskId: task.id,
        title: task.title,
        dependencies: [{ id: dependency.id, effectiveStatus: 'done' }]
      }
    });

    create.mockClear();
    command.attemptId = '00000000-0000-4000-8000-000000000005';
    reject('attempt_active');
    writer.requestExecutionStop(task.id, '2026-10-15T01:00:00.000Z');
    reject('attempt_active');
  });
});
