import { ProjectApplication } from '@n2/application';
import {
  LibraryActivitySchema,
  LibrarySeenMarkersSchema,
  ProjectActivitySchema,
  SeenMarkerSchema
} from '@n2/contracts';
import type { ProjectRepository } from '@n2/db';
import { createTestProjectRepository } from '@n2/db/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('Project Activity API', () => {
  let directory: string;
  let repository: ProjectRepository;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'n2-activity-api-'));
    repository = createTestProjectRepository(join(directory, 'test.sqlite'));
    app = createApp(new ProjectApplication(repository), repository.readiness);
  });

  afterEach(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const createTask = (sequence: number, actorHeader?: string) =>
    app.request('/api/projects/default/commands', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(actorHeader === undefined ? {} : { 'n2-actor': actorHeader })
      },
      body: JSON.stringify({
        kind: 'create_node',
        commandId: `00000000-0000-4000-8000-00000000040${sequence}`,
        nodeId: `00000000-0000-4000-8000-00000000041${sequence}`,
        input: { kind: 'task', title: `Task ${sequence}`, position: { x: 0, y: 0 } }
      })
    });

  it('attributes commands by the declared Actor and never rejects them for a bad header', async () => {
    for (const [sequence, header] of [
      [1, 'agent:codex%20review'],
      [2, 'person'],
      [3, 'robot'],
      [4, 'agent:%E0%A4%A']
    ] as const) {
      expect((await createTask(sequence, header)).status).toBe(200);
    }

    const activity = ProjectActivitySchema.parse(
      await (await app.request('/api/projects/default/activity')).json()
    );
    expect(activity.runs.map(({ actor }) => actor).reverse()).toEqual([
      { kind: 'agent', name: 'codex review' },
      { kind: 'person' },
      null
    ]);
  });

  it('clamps a Seen Marker to the latest receipt and never moves it back', async () => {
    await createTask(1);
    const markSeen = async (sequence: number) =>
      SeenMarkerSchema.parse(
        await (
          await app.request('/api/projects/default/activity/seen', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sequence })
          })
        ).json()
      );

    expect(await markSeen(50)).toMatchObject({ sequence: 1 });
    expect(await markSeen(0)).toMatchObject({ sequence: 1 });
  });

  it('reads the Library feed and marks what it loaded as seen in one request', async () => {
    await createTask(1, 'agent:codex-review');
    const readLibrary = async () =>
      LibraryActivitySchema.parse(await (await app.request('/api/activity')).json());

    const before = await readLibrary();
    expect(before.runs).toMatchObject([{ projectId: 'default', unseen: true }]);
    const response = await app.request('/api/activity/seen', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projects: before.projects.map(({ projectId, latestSequence }) => ({
          projectId,
          sequence: latestSequence
        }))
      })
    });
    expect(LibrarySeenMarkersSchema.parse(await response.json()).projects).toMatchObject([
      { projectId: 'default', seen: { sequence: 1 } }
    ]);
    expect((await readLibrary()).runs).toMatchObject([{ projectId: 'default', unseen: false }]);
  });
});
