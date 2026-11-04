import { describe, expect, it } from 'vitest';
import {
  formatCommandActorHeader,
  LibraryActivitySchema,
  parseCommandActorHeader
} from '../src/index.js';

describe('Command actor header', () => {
  it('round-trips a person and an agent name that needs escaping', () => {
    for (const actor of [{ kind: 'person' }, { kind: 'agent', name: 'codex: review' }] as const) {
      expect(parseCommandActorHeader(formatCommandActorHeader(actor))).toEqual(actor);
    }
  });

  it('treats a missing or malformed header as unattributed', () => {
    for (const value of [undefined, '', 'robot', 'agent:', 'agent:%E0%A4%A']) {
      expect(parseCommandActorHeader(value)).toBeNull();
    }
  });
});

describe('Library Activity', () => {
  const at = '2026-10-20T09:00:00.000Z';
  const project = (projectId: string) => ({
    projectId,
    latestSequence: 1,
    seen: null,
    unseenItemCount: 1
  });
  const run = {
    projectId: 'web',
    actor: null,
    startedAt: at,
    endedAt: at,
    firstSequence: 1,
    lastSequence: 1,
    unseen: true,
    entries: [
      {
        subject: { id: 'item', reference: 'WEB-1', title: 'Item', kind: 'task', present: true },
        lastSequence: 1,
        at,
        commandCount: 1,
        changes: [{ kind: 'created' }]
      }
    ]
  };
  const parse = (projects: unknown[]) =>
    LibraryActivitySchema.safeParse({ projects, runs: [run], hasEarlier: false }).success;

  it('rejects a run whose Project it does not list', () => {
    expect(parse([project('web')])).toBe(true);
    expect(parse([project('pens')])).toBe(false);
  });

  it('rejects a Project listed twice', () => {
    expect(parse([project('web'), project('web')])).toBe(false);
  });
});
