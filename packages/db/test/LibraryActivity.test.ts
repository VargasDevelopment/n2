import { ProjectApplication } from '@n2/application';
import type { CommandActor } from '@n2/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRepository } from '../src/index.js';
import { createTestProjectRepository } from './fixtures/projectDatabase.js';

const web = '00000000-0000-4000-8000-000000000a01';
const garden = '00000000-0000-4000-8000-000000000a02';
const shelved = '00000000-0000-4000-8000-000000000a03';
const codex = { kind: 'agent', name: 'codex-review' } as const;
const lead = { kind: 'agent', name: 'example-lead' } as const;

describe('Library Activity', () => {
  let directory: string;
  let repository: ProjectRepository;
  let application: ProjectApplication;
  let commands = 0;
  let clock = Date.parse('2026-10-20T08:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    directory = mkdtempSync(join(tmpdir(), 'n2-library-activity-'));
    repository = createTestProjectRepository(join(directory, 'library.sqlite'));
    application = new ProjectApplication(repository);
    for (const [projectId, name, referenceKey] of [
      [web, 'Website relaunch', 'WEB'],
      [garden, 'Garden research', 'GARDEN'],
      [shelved, 'Shelved', 'OLD']
    ] as const) {
      application.createProject({ projectId, name, referenceKey });
    }
  });

  afterEach(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
    vi.useRealTimers();
  });

  // Each task lands a minute after the last, so runs from different Projects have a clear order.
  const createTask = (projectId: string, actor: CommandActor) => {
    commands += 1;
    clock += 60_000;
    vi.setSystemTime(clock);
    const suffix = commands.toString(16).padStart(4, '0');
    application.executeCommand(
      projectId,
      {
        kind: 'create_node',
        commandId: `00000000-0000-4000-8000-00000000${suffix}`,
        nodeId: `00000000-0000-4000-8000-00000001${suffix}`,
        input: { kind: 'task', title: `Task ${commands}`, position: { x: 0, y: 0 } }
      },
      actor
    );
  };
  // Twenty-one quiet minutes end a run, so the next command starts a new one.
  const pause = () => (clock += 21 * 60_000);

  it('merges unarchived Projects newest first and leaves Archived Projects out', () => {
    createTask(web, codex);
    createTask(shelved, codex);
    application.archiveProject(shelved);
    createTask(garden, lead);
    createTask(web, { kind: 'person' });

    const library = application.queryLibraryActivity();

    expect(library.projects.map(({ projectId }) => projectId)).toEqual(
      expect.not.arrayContaining([shelved])
    );
    expect(library.runs.map(({ projectId, actor, unseen }) => [projectId, actor, unseen])).toEqual([
      // The Person's own changes are listed but never new.
      [web, { kind: 'person' }, false],
      [garden, lead, true],
      [web, codex, true]
    ]);
    expect(
      library.projects
        .filter(({ projectId }) => projectId !== 'default')
        .map(({ projectId, latestSequence, unseenItemCount }) => [
          projectId,
          latestSequence,
          unseenItemCount
        ])
    ).toEqual([
      [garden, 1, 1],
      [web, 2, 1]
    ]);
  });

  it('keeps every new run and cuts only seen context short', () => {
    for (let run = 0; run < 7; run += 1) {
      createTask(web, { kind: 'person' });
      pause();
    }
    for (let run = 0; run < 7; run += 1) {
      createTask(garden, codex);
      pause();
    }

    const library = application.queryLibraryActivity();

    expect(library.runs.filter(({ unseen }) => unseen)).toHaveLength(7);
    expect(library.runs.filter(({ unseen }) => !unseen)).toHaveLength(5);
    expect(library.hasEarlier).toBe(true);
  });

  it('marks each Project seen by the per-Project rule, all or none', () => {
    createTask(web, codex);
    createTask(garden, lead);
    createTask(garden, lead);

    expect(() =>
      application.markLibraryActivitySeen({
        projects: [
          { projectId: web, sequence: 1 },
          { projectId: '00000000-0000-4000-8000-00000000dead', sequence: 1 }
        ]
      })
    ).toThrow();
    expect(repository.getSeenMarker(web)).toBeNull();

    // Clamped to the latest receipt, and a stale, lower sequence never moves a marker back.
    const marked = application.markLibraryActivitySeen({
      projects: [
        { projectId: web, sequence: 50 },
        { projectId: garden, sequence: 1 }
      ]
    });
    expect(marked.projects.map(({ projectId, seen }) => [projectId, seen.sequence])).toEqual([
      [web, 1],
      [garden, 1]
    ]);
    application.markLibraryActivitySeen({ projects: [{ projectId: garden, sequence: 0 }] });
    expect(repository.getSeenMarker(garden)?.sequence).toBe(1);
    expect(application.queryActivity(garden).unseenItemCount).toBe(1);
    expect(application.queryActivity(web).unseenItemCount).toBe(0);
  });

  it('never acknowledges a Project archived before the close lands', () => {
    createTask(web, codex);
    createTask(garden, lead);
    // The feed loaded both; the archive lands between that read and the close.
    application.archiveProject(garden);

    const marked = application.markLibraryActivitySeen({
      projects: [
        { projectId: web, sequence: 1 },
        { projectId: garden, sequence: 1 }
      ]
    });

    expect(marked.projects.map(({ projectId }) => projectId)).toEqual([web]);
    application.restoreProject(garden);
    expect(repository.getSeenMarker(garden)).toBeNull();
    expect(application.queryActivity(garden).unseenItemCount).toBe(1);
  });
});
