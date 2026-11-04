import type {
  ActivityChange,
  CommandActor,
  CreateRelationshipInput,
  NodePatch,
  Project,
  ProjectCommand,
  SeenMarker
} from '@n2/contracts';
import { describe, expect, it } from 'vitest';
import {
  deriveProjectActivity,
  type ActivityHistory,
  type StoredCommandReceipt
} from '../src/activity.js';

const project: Project = { id: 'p', name: 'P', referenceKey: 'P', nodes: [], relationships: [] };
const person: CommandActor = { kind: 'person' };
const agent: CommandActor = { kind: 'agent', name: 'example-lead' };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const start = Date.parse('2026-10-21T02:00:00Z');

const receipt = (
  sequence: number,
  minute: number,
  actor: CommandActor | null,
  command: ProjectCommand
): StoredCommandReceipt => ({
  sequence,
  fingerprint: JSON.stringify(command),
  actor,
  createdAt: new Date(start + minute * 60_000).toISOString(),
  itemReference: null,
  itemKind: null
});
const derive = (
  receipts: StoredCommandReceipt[],
  seen: SeenMarker | null,
  enablements: ActivityHistory['enablements'] = [],
  older: Project = project
) => deriveProjectActivity(older, { receipts, enablements }, seen);

const create = (sequence: number, nodeId: string, title: string): ProjectCommand => ({
  kind: 'create_node',
  commandId: uuid(sequence),
  nodeId,
  input: { kind: 'task', title, description: '', position: { x: 0, y: 0 } }
});

const update = (nodeId: string, patch: NodePatch): ProjectCommand => ({
  kind: 'update_node',
  commandId: uuid(0),
  nodeId,
  expectedVersion: 0,
  patch
});
const remove = (nodeId: string): ProjectCommand => ({
  kind: 'delete_node',
  commandId: uuid(0),
  nodeId,
  expectedVersion: 0
});
const link = (relationshipId: string, input: CreateRelationshipInput): ProjectCommand => ({
  kind: 'create_relationship',
  commandId: uuid(0),
  relationshipId,
  input
});
const unlink = (relationshipId: string): ProjectCommand => ({
  kind: 'delete_relationship',
  commandId: uuid(0),
  relationshipId
});

// Runs are 30 minutes apart, so each list is one Activity Run; only the first is already seen.
const changesPerRun = (runs: readonly (readonly ProjectCommand[])[]): ActivityChange[][] => {
  const receipts = runs.flatMap((commands, run) => commands.map((command) => ({ command, run })));
  const activity = derive(
    receipts.map(({ command, run }, index) => receipt(index + 1, run * 30 + index, agent, command)),
    { sequence: runs[0]?.length ?? 0, seenAt: '2026-10-21T02:00:30Z' }
  );
  return activity.runs
    .filter(({ firstSequence }) => firstSequence > (runs[0]?.length ?? 0))
    .reverse()
    .map(({ entries }) => entries.flatMap(({ changes }) => changes));
};

const task = uuid(101);
const group = uuid(102);
const legacy = uuid(103);
const note = uuid(104);
const milestone = { kind: 'milestone', date: '2026-11-02' } as const;

describe('Activity Entry net change', () => {
  it.each<{ name: string; runs: ProjectCommand[][]; expected: ActivityChange[][] }>([
    {
      name: 'create then delete',
      runs: [[], [create(1, task, 'Spike'), remove(task)]],
      expected: []
    },
    {
      name: 'a rename round trip',
      runs: [[create(1, task, 'A')], [update(task, { title: 'B' }), update(task, { title: 'A' })]],
      expected: []
    },
    {
      name: 'a status round trip',
      runs: [
        [create(1, task, 'A')],
        [update(task, { requestedStatus: 'blocked' }), update(task, { requestedStatus: 'ready' })]
      ],
      expected: []
    },
    {
      name: 'a description round trip',
      runs: [
        [create(1, task, 'A')],
        [update(task, { description: 'Draft' }), update(task, { description: '' })]
      ],
      expected: []
    },
    {
      name: 'a placement round trip',
      runs: [
        [create(1, task, 'A')],
        [update(task, { planningPlacement: milestone }), update(task, { planningPlacement: null })]
      ],
      expected: []
    },
    {
      name: 'a membership added and removed',
      runs: [
        [create(1, task, 'A'), create(2, group, 'G')],
        [link(uuid(201), { kind: 'member_of', memberId: task, groupId: group }), unlink(uuid(201))]
      ],
      expected: []
    },
    {
      name: 'a dependency removed and added back',
      runs: [
        [link(uuid(201), { kind: 'depends_on', dependentId: legacy, dependencyId: task })],
        [
          unlink(uuid(201)),
          link(uuid(202), { kind: 'depends_on', dependentId: legacy, dependencyId: task })
        ]
      ],
      expected: []
    },
    {
      // Receipts from before standalone Notes name a Note's text `description`.
      name: 'a Note edited under its legacy field name, then set back under the modern one',
      runs: [
        [
          {
            kind: 'create_node',
            commandId: uuid(1),
            nodeId: note,
            input: { kind: 'note', title: 'N', content: 'original', position: { x: 0, y: 0 } }
          },
          update(note, { description: 'changed' })
        ],
        [update(note, { content: 'original' })]
      ],
      expected: [[{ kind: 'text_edited', edits: 1 }]]
    },
    {
      name: 'a dependency on an item deleted in the same run',
      runs: [
        [create(1, task, 'A'), create(2, group, 'B')],
        [
          link(uuid(201), { kind: 'depends_on', dependentId: task, dependencyId: group }),
          remove(group)
        ]
      ],
      expected: [[{ kind: 'deleted' }]]
    },
    {
      name: 'a Task disabled for agents that was never enabled',
      runs: [
        [create(1, task, 'A')],
        [{ kind: 'disable_task_for_agents', commandId: uuid(0), taskId: task }]
      ],
      expected: []
    },
    {
      name: 'a legacy item learned from an update, then renamed, then deleted',
      runs: [
        [update(legacy, { title: 'Known title' })],
        [update(legacy, { title: 'Second' })],
        [remove(legacy)]
      ],
      expected: [[{ kind: 'renamed', from: 'Known title', to: 'Second' }], [{ kind: 'deleted' }]]
    }
  ])('reports only the net change for $name', ({ runs, expected }) => {
    expect(changesPerRun(runs)).toEqual(expected);
  });

  it('reports a dependency lost when the item it pointed at is deleted', () => {
    const [run] = changesPerRun([
      [
        create(1, task, 'A'),
        create(2, group, 'B'),
        link(uuid(201), { kind: 'depends_on', dependentId: task, dependencyId: group })
      ],
      [remove(group)]
    ]);
    expect(run).toMatchObject([
      { kind: 'deleted' },
      { kind: 'relationship', change: 'removed', relationship: 'depends_on', other: { id: group } }
    ]);
  });

  describe('an item older than every receipt', () => {
    const olderTask = uuid(105);
    const withOlderTask: Project = {
      ...project,
      nodes: [
        {
          id: olderTask,
          reference: 'P-1',
          kind: 'task',
          title: 'Older',
          description: '',
          requestedStatus: 'ready',
          position: { x: 0, y: 0 },
          version: 0,
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z'
        }
      ]
    };
    const disable: ProjectCommand = {
      kind: 'disable_task_for_agents',
      commandId: uuid(0),
      taskId: olderTask
    };
    const changesOf = (
      commands: ProjectCommand[],
      enablements: ActivityHistory['enablements'] = []
    ): ActivityChange[] =>
      derive(
        commands.map((command, index) => receipt(index + 1, index, agent, command)),
        null,
        enablements,
        withOlderTask
      ).runs.flatMap(({ entries }) => entries.flatMap(({ changes }) => changes));

    it('was never enabled for agents when none of its Enablements predates the receipts', () => {
      expect(changesOf([disable])).toEqual([]);
      expect(
        changesOf([
          {
            kind: 'enable_task_for_agents',
            commandId: uuid(1),
            taskId: olderTask,
            enablementId: uuid(301)
          }
        ])
      ).toEqual([{ kind: 'agent_eligibility', enabled: true }]);
    });

    it('reports only its free text when what came before is unknown', () => {
      const enabledBefore = [{ enablementId: uuid(300), taskId: olderTask }];
      expect(
        changesOf(
          [
            update(olderTask, { title: 'Renamed' }),
            update(olderTask, { requestedStatus: 'done' }),
            update(olderTask, { planningPlacement: milestone }),
            update(olderTask, { description: 'Notes' }),
            disable
          ],
          enabledBefore
        )
      ).toEqual([
        { kind: 'renamed', from: null, to: 'Renamed' },
        { kind: 'text_edited', edits: 1 }
      ]);
    });

    it('keeps its reserved kind after deletion', () => {
      const activity = derive(
        [
          { ...receipt(1, 0, agent, update(note, { description: 'Edited' })), itemKind: 'note' },
          { ...receipt(2, 1, agent, remove(note)), itemKind: 'note' }
        ],
        { sequence: 1, seenAt: '2026-10-21T02:00:30Z' }
      );
      expect(activity.runs.map(({ entries }) => entries[0]?.subject.kind)).toEqual([
        'note',
        'note'
      ]);
    });
  });

  it('keeps a deleted legacy item’s learned title', () => {
    const activity = derive(
      [
        receipt(1, 0, agent, update(legacy, { title: 'Known title' })),
        receipt(2, 1, agent, remove(legacy))
      ],
      null
    );
    expect(activity.runs[0]?.entries).toMatchObject([
      { subject: { title: 'Known title', present: false }, changes: [{ kind: 'deleted' }] }
    ]);
  });
});

describe('Project Activity', () => {
  it('splits Activity Runs at a 20-minute gap, the Seen Marker, and a change of Actor', () => {
    const activity = derive(
      [
        receipt(1, 0, agent, create(1, uuid(101), 'Draft')),
        receipt(2, 20, agent, {
          kind: 'update_node',
          commandId: uuid(2),
          nodeId: uuid(101),
          expectedVersion: 0,
          patch: { title: 'Final' }
        }),
        receipt(3, 41, agent, create(3, uuid(102), 'Second')),
        receipt(4, 42, agent, create(4, uuid(103), 'After the marker')),
        receipt(5, 43, person, create(5, uuid(104), 'Mine'))
      ],
      { sequence: 3, seenAt: '2026-10-21T02:41:30Z' }
    );

    expect(
      activity.runs.map(({ actor, firstSequence, unseen }) => [actor, firstSequence, unseen])
    ).toEqual([
      [person, 5, false],
      [agent, 4, true],
      [agent, 3, false],
      [agent, 1, false]
    ]);
    // One net entry per item: the rename belongs to the creation it followed.
    expect(activity.runs[3]?.entries).toMatchObject([
      {
        subject: { id: uuid(101), title: 'Final' },
        commandCount: 2,
        changes: [{ kind: 'created' }]
      }
    ]);
    // Only the agent's item after the marker counts; the Person's own change is listed but not.
    expect(activity.unseenItemCount).toBe(1);
  });

  it.each([60, 61])('returns all %i unseen runs and cuts only seen history', (unseen) => {
    const seen = 10;
    const activity = derive(
      Array.from({ length: seen + unseen }, (_, index) =>
        receipt(
          index + 1,
          index * 30,
          agent,
          create(index + 1, uuid(1000 + index), `Item ${index}`)
        )
      ),
      { sequence: seen, seenAt: '2026-10-21T02:00:30Z' }
    );

    // Closing the sheet acknowledges latestSequence, so the oldest unseen run must be in it.
    expect(activity.runs.filter((run) => run.unseen)).toHaveLength(unseen);
    expect(activity.runs.at(-1)?.firstSequence).toBe(seen - 4);
    expect(activity.hasEarlier).toBe(true);
  });

  it.each([
    ['only the Person', [], [18, 17, 16, 15, 14]],
    ['an agent before the Person', [11], [18, 17, 16, 15, 14, 11]]
  ])(
    'treats the Person’s own runs after the marker as context, not news, when %s changed things',
    (_name, agentSequences: number[], shown: number[]) => {
      // Ten seen agent runs, then one run per command after the marker at sequence 10.
      const activity = derive(
        Array.from({ length: 18 }, (_, index) => {
          const sequence = index + 1;
          const actor = sequence <= 10 || agentSequences.includes(sequence) ? agent : person;
          return receipt(sequence, index * 30, actor, create(sequence, uuid(1000 + index), 'Item'));
        }),
        { sequence: 10, seenAt: '2026-10-21T06:30:00Z' }
      );

      // Every agent run after the marker is returned and counted; the Person's own fill the
      // usual five runs of context and no more, so they never stretch the history.
      expect(activity.runs.map(({ firstSequence }) => firstSequence)).toEqual(shown);
      expect(activity.runs.filter((run) => run.unseen).map((run) => run.firstSequence)).toEqual(
        agentSequences
      );
      expect(activity.unseenItemCount).toBe(agentSequences.length);
      expect(activity.hasEarlier).toBe(true);
    }
  );

  it('leaves layout moves and Attempt heartbeats out of the feed', () => {
    const activity = derive(
      [
        receipt(1, 0, agent, {
          kind: 'move_nodes',
          commandId: uuid(1),
          moves: { [uuid(101)]: { position: { x: 4, y: 4 }, expectedVersion: 0 } }
        }),
        receipt(2, 1, agent, {
          kind: 'update_node',
          commandId: uuid(2),
          nodeId: uuid(101),
          expectedVersion: 1,
          patch: { position: { x: 8, y: 8 } }
        }),
        receipt(3, 2, agent, {
          kind: 'heartbeat_attempt',
          commandId: uuid(3),
          attemptId: uuid(201),
          workerId: 'example-lead'
        })
      ],
      null
    );

    expect(activity).toMatchObject({ latestSequence: 3, unseenItemCount: 0, runs: [] });
  });

  it('names a deleted item by the Reference it kept', () => {
    const activity = derive(
      [
        receipt(1, 0, agent, create(1, uuid(101), 'Spike')),
        {
          ...receipt(2, 1, agent, {
            kind: 'delete_node',
            commandId: uuid(2),
            nodeId: uuid(101),
            expectedVersion: 0
          }),
          itemReference: 'P-7'
        }
      ],
      { sequence: 1, seenAt: '2026-10-21T02:00:30Z' }
    );

    expect(activity.runs[0]?.entries[0]?.subject).toEqual({
      id: uuid(101),
      reference: 'P-7',
      title: 'Spike',
      kind: 'task',
      present: false
    });
  });
});
