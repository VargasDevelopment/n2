import { ProjectApplication } from '@n2/application';
import { ProjectCommandResponseSchema, ProjectCommandSchema } from '@n2/contracts';
import type { ProjectRepository } from '@n2/db';
import { createTestProjectRepository } from '@n2/db/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const groupId = id(901);
const taskId = id(902);

describe('Command Effects', () => {
  let directory: string;
  let repository: ProjectRepository;
  let application: ProjectApplication;
  let commandSequence: number;

  // Two clients share one server; each command is judged against the state it was applied to.
  const execute = (command: Record<string, unknown>) =>
    application.executeCommand(
      'default',
      ProjectCommandSchema.parse({ commandId: id(++commandSequence), ...command })
    );
  const versionOf = (nodeId: string) =>
    application.queryProject('default').nodes.find((node) => node.id === nodeId)?.version ?? -1;
  const requestStatus = (nodeId: string, requestedStatus: string) =>
    execute({
      kind: 'update_node',
      nodeId,
      patch: { requestedStatus },
      expectedVersion: versionOf(nodeId)
    });

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'n2-effects-'));
    repository = createTestProjectRepository(join(directory, 'test.sqlite'));
    application = new ProjectApplication(repository);
    commandSequence = 0;
    execute({
      kind: 'create_node',
      nodeId: groupId,
      input: { kind: 'group', title: 'Launch', position: { x: 0, y: 0 } }
    });
    execute({
      kind: 'create_node',
      nodeId: taskId,
      input: { kind: 'task', title: 'Ship', position: { x: 0, y: 200 } }
    });
    execute({
      kind: 'create_relationship',
      relationshipId: id(903),
      input: { kind: 'member_of', memberId: taskId, groupId }
    });
  });

  afterEach(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('reports the Group Completion a command causes, on the wire too', async () => {
    const response = await createApp(application, repository.readiness).request(
      '/api/projects/default/commands',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          commandId: id(++commandSequence),
          kind: 'update_node',
          nodeId: taskId,
          patch: { requestedStatus: 'done' },
          expectedVersion: versionOf(taskId)
        })
      }
    );

    const result = ProjectCommandResponseSchema.parse(await response.json());
    expect(result.effects).toEqual({ completedGroupIds: [groupId] });
  });

  it('never credits a completion another command already caused', () => {
    expect(requestStatus(taskId, 'done').effects.completedGroupIds).toEqual([groupId]);

    // The other client still believes the Group is ready.
    expect(requestStatus(groupId, 'in_progress').effects.completedGroupIds).toEqual([]);
    const rename = execute({
      kind: 'update_node',
      nodeId: groupId,
      patch: { title: 'Launch v2' },
      expectedVersion: versionOf(groupId)
    });
    expect(rename.effects.completedGroupIds).toEqual([]);
  });

  it('reports no effects when a completing command replays', () => {
    const completing = {
      commandId: id(990),
      kind: 'update_node',
      nodeId: taskId,
      patch: { requestedStatus: 'done' },
      expectedVersion: versionOf(taskId)
    };

    expect(execute(completing).effects.completedGroupIds).toEqual([groupId]);
    const replay = execute(completing);

    expect(replay.disposition).toBe('replayed');
    expect(replay.effects.completedGroupIds).toEqual([]);
  });
});
