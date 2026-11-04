import { ProjectApplication } from '@n2/application';
import {
  ProjectCommandTransportSchema,
  type ActivityChange,
  type ActivitySubject,
  type GraphRelationship,
  type NodeKind,
  type NodeStatus,
  type PlanningPlacement,
  type ProjectCommandInput
} from '@n2/contracts';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ProjectRepository } from '../src/index.js';
import { createTestProjectRepository } from './fixtures/projectDatabase.js';

/*
 * Differential guard for Project Activity's replay: random command sequences run through the real
 * application into a real database, and the feed's unseen entries must equal the difference
 * between the projection at the Seen Marker and at the end. Any rule the replay gets wrong
 * (defaults, cascades, legacy field forms, where an older item starts) shows up as a mismatch.
 */

const agent = { kind: 'agent', name: 'replay-check' } as const;
const directory = mkdtempSync(join(tmpdir(), 'n2-activity-replay-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

// mulberry32: small, seedable, and stable across platforms.
const random = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const TITLES = ['Alpha', 'Beta', 'Gamma'];
const TEXTS = ['', 'one', 'two'];
const STATUSES: NodeStatus[] = ['ready', 'in_progress', 'blocked', 'done'];
const PLACEMENTS: (PlanningPlacement | null)[] = [
  null,
  { kind: 'milestone', date: '2026-11-02' },
  { kind: 'window', startDate: '2026-11-02', endDate: '2026-11-09' }
];

type Field = 'title' | 'text' | 'status' | 'placement' | 'agents';
type ItemSnapshot = { facts: Partial<Record<Field, string>>; links: Set<string> };
type Snapshot = Map<string, ItemSnapshot>;

const snapshot = (repository: ProjectRepository, projectId: string): Snapshot => {
  const project = repository.getProject(projectId);
  const enabled = new Set(
    repository
      .getExecutionEligibilities(projectId)
      .filter(({ enabled }) => enabled)
      .map(({ taskId }) => taskId)
  );
  const items: Snapshot = new Map(
    project.nodes.map((node) => [
      node.id,
      {
        facts:
          node.kind === 'note'
            ? { title: node.title, text: node.content }
            : {
                title: node.title,
                text: node.description,
                status: node.requestedStatus,
                placement: JSON.stringify(node.planningPlacement ?? null),
                agents: String(enabled.has(node.id))
              },
        links: new Set<string>()
      }
    ])
  );
  for (const relationship of project.relationships) {
    const [subject, other] =
      relationship.kind === 'member_of'
        ? [relationship.memberId, relationship.groupId]
        : [relationship.dependentId, relationship.dependencyId];
    items.get(subject)?.links.add(`${relationship.kind}:${other}`);
  }
  return items;
};

const describeChange = (change: ActivityChange): string => {
  switch (change.kind) {
    case 'renamed':
      return `title:${change.to}`;
    case 'status_requested':
      return `status:${change.to}`;
    case 'placement_changed':
      return `placement:${JSON.stringify(change.to)}`;
    case 'text_edited':
      return 'text';
    case 'relationship':
      return `${change.change}:${change.relationship}:${change.other.id}`;
    case 'agent_eligibility':
      return `agents:${String(change.enabled)}`;
    default:
      return change.kind;
  }
};

const expectedFactChange = (
  field: Field,
  value: string,
  was: ItemSnapshot | undefined,
  learned: ReadonlySet<Field>
): string | undefined => {
  const previous = was?.facts[field];
  if (learned.has(field)) {
    if (field === 'title') return `title:${value}`;
    if (field === 'text') return 'text';
    return undefined;
  }
  switch (field) {
    case 'text':
    case 'title':
    case 'placement':
      if (!was || value === previous) return undefined;
      return field === 'text' ? 'text' : `${field}:${value}`;
    case 'status':
      return value !== (previous ?? 'ready') ? `status:${value}` : undefined;
    case 'agents':
      return value !== (previous ?? 'false') ? `agents:${value}` : undefined;
  }
};

/**
 * The projection's difference, in the feed's terms: a new item reports only what its creation did
 * not default, and a deleted one only its deletion. `unknown` holds the fields of older items that
 * no receipt before the marker set: free text first set after it is reported, anything else
 * first set after it is not, whatever its value was.
 */
const expectedChanges = (
  before: Snapshot,
  after: Snapshot,
  unknown: ReadonlyMap<string, ReadonlySet<Field>>
): Map<string, string[]> => {
  const expected = new Map<string, string[]>();
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(id);
    const now = after.get(id);
    const changes: string[] = [];
    if (!now) {
      if (was) changes.push('deleted');
    } else {
      if (!was) changes.push('created');
      const learned = unknown.get(id) ?? new Set();
      for (const [field, value] of Object.entries(now.facts) as [Field, string][]) {
        const change = expectedFactChange(field, value, was, learned);
        if (change !== undefined) changes.push(change);
      }
      for (const link of now.links) if (!was?.links.has(link)) changes.push(`added:${link}`);
      for (const link of was?.links ?? [])
        if (!now.links.has(link)) changes.push(`removed:${link}`);
    }
    if (changes.length > 0) expected.set(id, changes.sort());
  }
  return expected;
};

const PATCH_FIELDS: Record<string, Field> = {
  title: 'title',
  requestedStatus: 'status',
  description: 'text',
  content: 'text',
  planningPlacement: 'placement'
};

const runSequence = (seed: number) => {
  const next = random(seed);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)]!;
  const path = join(directory, `replay-${seed}.sqlite`);
  const repository = createTestProjectRepository(path);
  const application = new ProjectApplication(repository);
  const projectId = randomUUID();
  application.createProject({ projectId, name: `Replay ${seed}`, referenceKey: 'RPL' });

  // Every kind the test has seen, so a deleted item's subject can be checked too.
  const kinds = new Map<string, NodeKind>();
  // Fields each item's applied commands set since the last reset.
  const touched = new Map<string, Set<Field>>();
  const touch = (id: string, field: Field) =>
    touched.set(id, (touched.get(id) ?? new Set<Field>()).add(field));

  const execute = (command: ProjectCommandInput | Record<string, unknown>): boolean => {
    try {
      // Legacy shapes enter the way an old client's would, through the transport schema.
      application.executeCommand(projectId, ProjectCommandTransportSchema.parse(command), agent);
      return true;
    } catch {
      // A command the domain refuses writes no receipt, which is fine for this check.
      return false;
    }
  };
  const create = (kind: NodeKind, extra: Record<string, unknown>): string => {
    const nodeId = randomUUID();
    execute({
      kind: 'create_node',
      commandId: randomUUID(),
      nodeId,
      input: { kind, title: pick(TITLES), position: { x: 0, y: 0 }, ...extra }
    });
    return nodeId;
  };
  const enable = (taskId: string) =>
    execute({
      kind: 'enable_task_for_agents',
      commandId: randomUUID(),
      taskId,
      enablementId: randomUUID()
    });
  const disable = (taskId: string) =>
    execute({ kind: 'disable_task_for_agents', commandId: randomUUID(), taskId });

  // Items older than every receipt: made through the application, then their receipts dropped,
  // which leaves their ID reservations, Enablements and eligibility rows as the durable facts.
  const enabledTask = create('task', { description: '' });
  const disabledTask = create('task', { description: '' });
  const older = [
    create('task', { description: 'older' }),
    create('group', { description: '' }),
    create('note', { content: 'older note' }),
    enabledTask,
    disabledTask
  ];
  enable(enabledTask);
  enable(disabledTask);
  disable(disabledTask);
  const sqlite = new Database(path);
  sqlite.prepare('DELETE FROM command_receipts WHERE workspace_id = ?').run(projectId);
  sqlite.close();
  // Nothing proves what an older item's fields were before a receipt set them, nor whether a
  // Task enabled before the receipts was still enabled.
  const unknown = new Map<string, Set<Field>>(
    older.map((id) => [
      id,
      new Set<Field>([
        'title',
        'text',
        'status',
        'placement',
        ...(id === enabledTask || id === disabledTask ? (['agents'] as const) : [])
      ])
    ])
  );

  const createRandomNode = () => {
    const kind = pick(['task', 'task', 'group', 'note'] as const);
    if (kind === 'note') {
      // Half the Notes use the pre-standalone `description` field.
      return create(kind, next() < 0.5 ? { content: pick(TEXTS) } : { description: pick(TEXTS) });
    }
    const placement = next() < 0.3 ? { planningPlacement: pick(PLACEMENTS.slice(1)) } : {};
    const nodeId = randomUUID();
    // Old clients omitted `kind` for Tasks.
    const named = kind === 'task' && next() < 0.3 ? {} : { kind };
    return execute({
      kind: 'create_node',
      commandId: randomUUID(),
      nodeId,
      input: {
        ...named,
        title: pick(TITLES),
        description: pick(TEXTS),
        position: { x: 0, y: 0 },
        ...placement
      }
    });
  };

  const step = () => {
    const { nodes, relationships } = repository.getProject(projectId);
    for (const node of nodes) kinds.set(node.id, node.kind);
    const work = nodes.filter((node) => node.kind !== 'note');
    const roll = next();
    if (nodes.length < 3 || roll < 0.15) {
      return createRandomNode();
    }
    const node = pick(nodes);
    if (roll < 0.55) {
      const patch =
        node.kind === 'note'
          ? pick([{ title: pick(TITLES) }, { content: pick(TEXTS) }, { position: { x: 1, y: 1 } }])
          : pick([
              { title: pick(TITLES) },
              { requestedStatus: pick(STATUSES) },
              { description: pick(TEXTS) },
              { planningPlacement: pick(PLACEMENTS) },
              { position: { x: 2, y: 2 } }
            ]);
      const applied = execute({
        kind: 'update_node',
        commandId: randomUUID(),
        nodeId: node.id,
        expectedVersion: node.version,
        patch
      });
      for (const key of Object.keys(patch)) {
        const field = PATCH_FIELDS[key];
        if (applied && field) touch(node.id, field);
      }
      return;
    }
    if (roll < 0.65 && node.kind === 'task') {
      if (next() < 0.5 ? enable(node.id) : disable(node.id)) touch(node.id, 'agents');
      return;
    }
    if (roll < 0.82 && work.length >= 2) {
      const [subject, other] = [pick(work), pick(work)];
      return execute({
        kind: 'create_relationship',
        commandId: randomUUID(),
        relationshipId: randomUUID(),
        input:
          other.kind === 'group' && next() < 0.5
            ? { kind: 'member_of', memberId: subject.id, groupId: other.id }
            : { kind: 'depends_on', dependentId: subject.id, dependencyId: other.id }
      });
    }
    if (roll < 0.9 && relationships.length > 0) {
      const relationship: GraphRelationship = pick(relationships);
      return execute({
        kind: 'delete_relationship',
        commandId: randomUUID(),
        relationshipId: relationship.id
      });
    }
    return execute({
      kind: 'delete_node',
      commandId: randomUUID(),
      nodeId: node.id,
      expectedVersion: node.version
    });
  };

  for (let index = 0; index < 30; index += 1) step();
  const marker = application.queryActivity(projectId).latestSequence;
  application.markActivitySeen(projectId, marker);
  const atMarker = snapshot(repository, projectId);
  // A field set before the marker is known from there on; one set only after it is learned.
  const unknownAtMarker = new Map(
    [...unknown].map(([id, fields]) => [
      id,
      new Set([...fields].filter((field) => !touched.get(id)?.has(field)))
    ])
  );
  touched.clear();
  for (let index = 0; index < 30; index += 1) step();
  const atEnd = snapshot(repository, projectId);
  for (const node of repository.getProject(projectId).nodes) kinds.set(node.id, node.kind);
  const learned = new Map(
    [...unknownAtMarker].map(([id, fields]) => [
      id,
      new Set([...fields].filter((field) => touched.get(id)?.has(field)))
    ])
  );

  const activity = application.queryActivity(projectId);
  const actual = new Map<string, string[]>();
  const subjects: ActivitySubject[] = [];
  for (const run of activity.runs.filter(({ firstSequence }) => firstSequence > marker)) {
    for (const entry of run.entries) {
      subjects.push(entry.subject);
      for (const change of entry.changes)
        if (change.kind === 'relationship') subjects.push(change.other);
      actual.set(entry.subject.id, [
        ...(actual.get(entry.subject.id) ?? []),
        ...entry.changes.map(describeChange)
      ]);
    }
  }
  for (const [id, changes] of actual) actual.set(id, changes.sort());
  repository.close();
  return {
    actual,
    expected: expectedChanges(atMarker, atEnd, learned),
    unseen: activity.unseenItemCount,
    kinds: subjects.map(({ id, kind }) => [id, kind, kinds.get(id)])
  };
};

describe('Project Activity replay', () => {
  it.each(Array.from({ length: 24 }, (_, index) => index + 1))(
    'matches the projection difference for seed %i',
    (seed) => {
      const { actual, expected, unseen, kinds } = runSequence(seed);
      expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
      expect(unseen).toBe(expected.size);
      for (const [id, reported, kind] of kinds) expect([id, reported]).toEqual([id, kind]);
    }
  );
});
