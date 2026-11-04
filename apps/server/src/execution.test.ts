import { ProjectApplication } from '@n2/application';
import { ProjectExecutionSchema } from '@n2/contracts';
import type { ProjectRepository } from '@n2/db';
import { createTestProjectRepository } from '@n2/db/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('execution API', () => {
  let directory: string;
  let repository: ProjectRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'n2-execution-api-'));
    repository = createTestProjectRepository(join(directory, 'test.sqlite'));
  });

  afterEach(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('exposes execution state, bound Group previews, and typed stale-claim errors', async () => {
    const app = createApp(new ProjectApplication(repository), repository.readiness);
    const initialResponse = await app.request('/api/projects/default/execution');
    expect(initialResponse.status).toBe(200);
    const initial = ProjectExecutionSchema.parse(await initialResponse.json());
    expect(initial.tasks.every(({ eligibility }) => eligibility === 'off')).toBe(true);

    const previewResponse = await app.request(
      '/api/projects/default/groups/n2-group/agent-enablement-preview'
    );
    expect(previewResponse.status).toBe(200);
    expect(await previewResponse.json()).toMatchObject({
      projectId: 'default',
      groupId: 'n2-group',
      tasks: [{ taskId: 'agent' }, { taskId: 'domain' }, { taskId: 'local' }]
    });

    const enablementId = '00000000-0000-4000-8000-000000000810';
    const enable = await app.request('/api/projects/default/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'enable_task_for_agents',
        commandId: '00000000-0000-4000-8000-000000000801',
        taskId: 'local',
        enablementId
      })
    });
    expect(enable.status).toBe(200);
    const execution = ProjectExecutionSchema.parse(
      await (await app.request('/api/projects/default/execution')).json()
    );
    const local = execution.tasks.find(({ taskId }) => taskId === 'local')!;
    const staleClaim = await app.request('/api/projects/default/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'claim_task',
        commandId: '00000000-0000-4000-8000-000000000802',
        taskId: 'local',
        attemptId: '00000000-0000-4000-8000-000000000811',
        workerId: 'api-worker',
        expectedFingerprint: `sha256:${'0'.repeat(64)}`,
        expectedEnablementId: enablementId
      })
    });
    expect(staleClaim.status).toBe(409);
    expect(await staleClaim.json()).toMatchObject({
      code: 'execution_conflict',
      details: { reason: 'stale_fingerprint', taskId: 'local' }
    });
    expect(local.currentFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
