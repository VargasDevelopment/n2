import { createHash } from 'node:crypto';
import type { N2Client } from '@n2/client';
import type { NodeStatus, PlanningPlacement, ProjectCommandInput } from '@n2/contracts';

// A small, believable project for README screenshots. Every item is created through public
// Project Commands, the same contract the web interface and the CLI use.

type WorkItem = {
  key: string;
  kind: 'task' | 'group';
  title: string;
  description?: string;
  at: [x: number, y: number];
  status?: Exclude<NodeStatus, 'ready'>;
  plan?: PlanningPlacement;
  memberOf?: string;
  dependsOn?: readonly string[];
};

type NoteItem = { key: string; kind: 'note'; title: string; content: string; at: [number, number] };

const between = (startDate: string, endDate: string): PlanningPlacement => ({
  kind: 'window',
  startDate,
  endDate
});

// Columns are 290 apart and rows 190 apart, so 230 x 140 cards keep even gutters. Dependencies
// sit to the left of their dependents, so edges read left to right.
const col = (index: number): number => index * 290;
const row = (index: number): number => index * 190;

export const DEMO_PROJECT = {
  name: 'Launch Sprout 1.0',
  referenceKey: 'SPR'
} as const;

/**
 * The Task the README explains: blocked through a dependency, not by its own status. The README
 * quotes these references, so seeding fails if the item order ever allocates different ones.
 */
export const BLOCKED_TASK = {
  key: 'submit',
  reference: 'SPR-17',
  groupReference: 'SPR-12'
} as const;

const items: readonly (WorkItem | NoteItem)[] = [
  { key: 'design', kind: 'group', title: 'Design', at: [col(0), row(0)] },
  {
    key: 'sketch',
    kind: 'task',
    title: 'Sketch the core screens',
    at: [col(0), row(1)],
    status: 'done',
    plan: between('2026-09-07', '2026-09-18'),
    memberOf: 'design'
  },
  {
    key: 'icon',
    kind: 'task',
    title: 'Pick a name and app icon',
    at: [col(0), row(2)],
    status: 'done',
    plan: between('2026-09-14', '2026-09-25'),
    memberOf: 'design'
  },
  {
    key: 'onboardingDesign',
    kind: 'task',
    title: 'Design onboarding',
    at: [col(0), row(3)],
    status: 'done',
    plan: between('2026-09-21', '2026-10-02'),
    memberOf: 'design'
  },
  { key: 'build', kind: 'group', title: 'Build', at: [col(1.4), row(0)] },
  {
    key: 'ci',
    kind: 'task',
    title: 'Set up the repo and CI',
    at: [col(1.4), row(1)],
    status: 'done',
    plan: between('2026-09-14', '2026-09-18'),
    memberOf: 'build'
  },
  {
    key: 'plants',
    kind: 'task',
    title: 'Plant list and care cards',
    at: [col(2.4), row(1)],
    status: 'done',
    plan: between('2026-09-21', '2026-10-16'),
    memberOf: 'build',
    dependsOn: ['ci']
  },
  {
    key: 'sync',
    kind: 'task',
    title: 'Sync between devices',
    at: [col(1.4), row(2)],
    plan: between('2026-11-09', '2026-11-20'),
    memberOf: 'build'
  },
  {
    key: 'journal',
    kind: 'task',
    title: 'Photo journal',
    at: [col(2.4), row(2)],
    plan: between('2026-11-16', '2026-11-27'),
    memberOf: 'build',
    dependsOn: ['sync']
  },
  {
    key: 'onboarding',
    kind: 'task',
    title: 'Build onboarding',
    at: [col(1.4), row(3)],
    status: 'done',
    plan: between('2026-10-05', '2026-10-23'),
    memberOf: 'build',
    dependsOn: ['onboardingDesign']
  },
  {
    key: 'reminders',
    kind: 'task',
    title: 'Watering reminders',
    description: 'One local notification per plant. Onboarding asks for permission first.',
    at: [col(2.4), row(3)],
    status: 'in_progress',
    plan: between('2026-10-19', '2026-11-13'),
    memberOf: 'build',
    dependsOn: ['onboarding']
  },
  { key: 'launch', kind: 'group', title: 'Launch', at: [col(3.8), row(0)] },
  {
    key: 'account',
    kind: 'task',
    title: 'Get the developer account approved',
    description: 'Waiting on the D-U-N-S number for the business account.',
    at: [col(5.15), row(0)],
    status: 'blocked',
    plan: between('2026-10-12', '2026-11-13'),
    memberOf: 'launch'
  },
  {
    key: 'listing',
    kind: 'task',
    title: 'Write the App Store listing',
    at: [col(3.8), row(1)],
    status: 'in_progress',
    plan: between('2026-10-26', '2026-11-13'),
    memberOf: 'launch'
  },
  {
    key: 'beta',
    kind: 'task',
    title: 'Beta with 25 testers',
    at: [col(3.8), row(2)],
    status: 'in_progress',
    plan: between('2026-11-02', '2026-11-20'),
    memberOf: 'launch',
    dependsOn: ['reminders']
  },
  {
    key: 'site',
    kind: 'task',
    title: 'Landing page',
    at: [col(3.8), row(3)],
    status: 'done',
    plan: between('2026-10-26', '2026-11-06'),
    memberOf: 'launch'
  },
  // Outside every Group: the checkpoint the Groups lead to. Inside Launch it would be a second
  // blocked member, and a second Blocked part edge would cross the canvas.
  {
    key: BLOCKED_TASK.key,
    kind: 'task',
    title: 'Submit to the App Store',
    description: 'Needs the approved account, the final listing and a clean beta build.',
    at: [col(6.35), row(1.5)],
    plan: { kind: 'milestone', date: '2026-11-24' },
    dependsOn: ['account', 'listing', 'beta']
  },
  {
    key: 'goal',
    kind: 'note',
    title: 'Launch goal',
    content:
      'Ship 1.0 on iOS before December.\n\nFree for three plants, then a one-time $4.99 unlock. Android comes after launch.',
    at: [col(0), row(4.1)]
  },
  {
    key: 'feedback',
    kind: 'note',
    title: 'Beta feedback so far',
    content:
      '- Reminders fire twice after a time-zone change\n- Wants a "snooze for a day" option\n- Care cards are the favorite screen',
    at: [col(5.15), row(2.6)]
  }
];

/** A fixed UUID per name, so every run creates the same identities in the same order. */
const stableUuid = (name: string): string => {
  const hex = createHash('sha256').update(`n2-screenshots:${name}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** Creates the demo Project and returns its ID. */
export async function seedDemoProject(client: N2Client): Promise<string> {
  const projectId = stableUuid('project');
  await client.createProject({ projectId, ...DEMO_PROJECT });
  const nodeIds = new Map(items.map((item) => [item.key, stableUuid(`node:${item.key}`)]));
  const idOf = (key: string): string => {
    const id = nodeIds.get(key);
    if (!id) throw new Error(`Unknown demo item: ${key}`);
    return id;
  };
  const run = (name: string, command: DistributiveOmit<ProjectCommandInput, 'commandId'>) =>
    client.executeCommand(projectId, { ...command, commandId: stableUuid(`command:${name}`) });

  for (const item of items) {
    const [x, y] = item.at;
    const input =
      item.kind === 'note'
        ? { kind: item.kind, title: item.title, content: item.content, position: { x, y } }
        : {
            kind: item.kind,
            title: item.title,
            description: item.description ?? '',
            position: { x, y },
            ...(item.plan ? { planningPlacement: item.plan } : {})
          };
    await run(`create:${item.key}`, { kind: 'create_node', nodeId: idOf(item.key), input });
  }

  for (const item of items) {
    if (item.kind === 'note') continue;
    if (item.memberOf) {
      await run(`member:${item.key}`, {
        kind: 'create_relationship',
        relationshipId: stableUuid(`member:${item.key}`),
        input: { kind: 'member_of', memberId: idOf(item.key), groupId: idOf(item.memberOf) }
      });
    }
    for (const dependency of item.dependsOn ?? []) {
      await run(`depends:${item.key}:${dependency}`, {
        kind: 'create_relationship',
        relationshipId: stableUuid(`depends:${item.key}:${dependency}`),
        input: { kind: 'depends_on', dependentId: idOf(item.key), dependencyId: idOf(dependency) }
      });
    }
  }

  // Statuses last, against each node's current version.
  const { nodes } = await client.getProject(projectId);
  const referenceOf = (key: string) => nodes.find(({ id }) => id === idOf(key))?.reference;
  if (
    referenceOf(BLOCKED_TASK.key) !== BLOCKED_TASK.reference ||
    referenceOf('launch') !== BLOCKED_TASK.groupReference
  ) {
    throw new Error('The demo items no longer get the references the README quotes.');
  }
  for (const item of items) {
    if (item.kind === 'note' || !item.status) continue;
    const node = nodes.find(({ id }) => id === idOf(item.key));
    if (!node) throw new Error(`Demo item was not created: ${item.key}`);
    await run(`status:${item.key}`, {
      kind: 'update_node',
      nodeId: node.id,
      expectedVersion: node.version,
      patch: { requestedStatus: item.status }
    });
  }

  return projectId;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
