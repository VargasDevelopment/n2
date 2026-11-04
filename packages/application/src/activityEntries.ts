import {
  ProjectCommandTransportSchema,
  type ActivityChange,
  type CreateRelationshipInput,
  type NodeKind,
  type NodeStatus,
  type PlanningPlacement,
  type Project,
  type ProjectCommand
} from '@n2/contracts';
import {
  initialAgentEligibility,
  initialRequestedStatus,
  isDeletedWithItem,
  patchedText
} from '@n2/domain';
import type { ActivityHistory, StoredCommandReceipt } from './activity.js';

/*
 * Replays Command Receipts into per-item state, so an Activity Entry is the difference across a run.
 * What a command does beyond its own fields (creation defaults, legacy field names, cascades) comes
 * from the domain's Canvas Item rules, the same ones storage applies.
 */

type RelationshipKind = 'member_of' | 'depends_on';
type AttemptChange = Extract<ActivityChange, { kind: 'attempt' }>;
type RelationshipChange = Extract<ActivityChange, { kind: 'relationship' }>;
type CreatedInput = Extract<ProjectCommand, { kind: 'create_node' }>['input'];

type Link = { relationship: RelationshipKind; otherId: string; present: boolean };
type Ends = { subjectId: string; objectId: string; relationship: RelationshipKind };
/** The fields an update set, in today's terms; `undefined` means left alone. */
type Fields = {
  title: string | undefined;
  status: NodeStatus | undefined;
  placement: PlanningPlacement | null | undefined;
  text: string | undefined;
};
/**
 * What the feed knows about one Canvas Item at a point in the replay. `undefined` means not known:
 * storage cannot prove what an item older than every receipt held before a receipt set it.
 */
export type ItemState = {
  exists: boolean;
  title: string | undefined;
  status: NodeStatus | undefined;
  placement: PlanningPlacement | null | undefined;
  /** A Work Node's description or a Note's content. */
  text: string | undefined;
  agentsEnabled: boolean | undefined;
  /** Memberships and dependencies held by this item, keyed by relationship kind and other item. */
  links: ReadonlyMap<string, Link>;
};

/** What one receipt did to one Canvas Item. */
type Effect =
  | { kind: 'created'; input: CreatedInput }
  | { kind: 'deleted' }
  | { kind: 'updated'; fields: Fields }
  | { kind: 'linked'; link: Link }
  | { kind: 'agents'; enabled: boolean }
  | { kind: 'attempt'; change: AttemptChange };
type Touch = { subjectId: string; effect: Effect };
export type ReadReceipt = { receipt: StoredCommandReceipt; touches: Touch[] };
/** What storage proves about items whatever their receipts say, including after deletion. */
export type ItemOrigins = {
  references: ReadonlyMap<string, string>;
  kinds: ReadonlyMap<string, NodeKind>;
  /** Tasks with an Enablement no receipt accounts for, so enabled before the receipts began. */
  enabledBeforeReceipts: ReadonlySet<string>;
};

const parseCommand = (fingerprint: string): ProjectCommand | null => {
  try {
    const parsed = ProjectCommandTransportSchema.safeParse(JSON.parse(fingerprint));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const linkKey = ({ relationship, otherId }: Link): string => `${relationship}:${otherId}`;

const endsOf = (relationship: CreateRelationshipInput): Ends =>
  relationship.kind === 'member_of'
    ? {
        subjectId: relationship.memberId,
        objectId: relationship.groupId,
        relationship: 'member_of'
      }
    : {
        subjectId: relationship.dependentId,
        objectId: relationship.dependencyId,
        relationship: 'depends_on'
      };

const linkTouch = ({ subjectId, objectId, relationship }: Ends, present: boolean): Touch => ({
  subjectId,
  effect: { kind: 'linked', link: { relationship, otherId: objectId, present } }
});

/**
 * Reads each receipt's command into the items it touched. Live relationships, item kinds and
 * Attempt owners are remembered from earlier receipts, because later commands name only the
 * relationship, item or Attempt.
 */
export const readReceipts = (
  project: Project,
  { receipts, enablements }: ActivityHistory
): { read: ReadReceipt[]; origins: ItemOrigins } => {
  const relationships = new Map(
    project.relationships.map((relationship) => [relationship.id, endsOf(relationship)])
  );
  const kinds = new Map<string, NodeKind>(project.nodes.map(({ id, kind }) => [id, kind]));
  const attemptTasks = new Map<string, string>();
  const receiptedEnablements = new Set<string>();

  const touchesOf = (command: ProjectCommand): Touch[] => {
    switch (command.kind) {
      case 'create_node':
        kinds.set(command.nodeId, command.input.kind);
        return [{ subjectId: command.nodeId, effect: { kind: 'created', input: command.input } }];
      case 'update_node': {
        const { patch } = command;
        // An item of unknown kind is read as a Note, whose text either field name can carry.
        const kind = kinds.get(command.nodeId) ?? 'note';
        const fields: Fields = {
          title: patch.title,
          status: patch.requestedStatus,
          placement: patch.planningPlacement,
          text: patchedText(kind, patch)
        };
        // Position is layout, not change worth reading about.
        return Object.values(fields).some((value) => value !== undefined)
          ? [{ subjectId: command.nodeId, effect: { kind: 'updated', fields } }]
          : [];
      }
      case 'move_nodes':
      case 'heartbeat_attempt':
        return [];
      case 'delete_node': {
        // Its own relationships go with it; items that pointed at it lose theirs.
        const cascaded = [...relationships].flatMap(([id, ends]) => {
          if (!isDeletedWithItem(ends, command.nodeId)) return [];
          relationships.delete(id);
          return ends.subjectId === command.nodeId ? [] : [linkTouch(ends, false)];
        });
        return [{ subjectId: command.nodeId, effect: { kind: 'deleted' } }, ...cascaded];
      }
      case 'create_relationship': {
        const ends = endsOf(command.input);
        relationships.set(command.relationshipId, ends);
        return [linkTouch(ends, true)];
      }
      case 'delete_relationship': {
        const ends = relationships.get(command.relationshipId);
        // A relationship older than every receipt and already gone cannot be described.
        if (!ends) return [];
        relationships.delete(command.relationshipId);
        return [linkTouch(ends, false)];
      }
      case 'enable_task_for_agents':
        receiptedEnablements.add(command.enablementId);
        return [{ subjectId: command.taskId, effect: { kind: 'agents', enabled: true } }];
      case 'disable_task_for_agents':
        return [
          {
            subjectId: command.taskId,
            effect: { kind: 'agents', enabled: false }
          }
        ];
      case 'enable_group_for_agents':
        return command.taskEnablements.map(({ taskId, enablementId }) => {
          receiptedEnablements.add(enablementId);
          return { subjectId: taskId, effect: { kind: 'agents', enabled: true } };
        });
      case 'claim_task':
        attemptTasks.set(command.attemptId, command.taskId);
        return [
          {
            subjectId: command.taskId,
            effect: { kind: 'attempt', change: { kind: 'attempt', event: 'claimed', note: null } }
          }
        ];
      case 'record_attempt_progress':
      case 'complete_attempt':
      case 'fail_attempt':
      case 'release_attempt':
      case 'confirm_attempt_stopped': {
        const taskId = attemptTasks.get(command.attemptId);
        if (taskId === undefined) return [];
        const event = (
          {
            record_attempt_progress: 'progress',
            complete_attempt: 'completed',
            fail_attempt: 'failed',
            release_attempt: 'released',
            confirm_attempt_stopped: 'stopped'
          } as const
        )[command.kind];
        const note =
          command.kind === 'record_attempt_progress'
            ? command.progress
            : command.kind === 'fail_attempt'
              ? (command.error ?? null)
              : null;
        return [
          {
            subjectId: taskId,
            effect: { kind: 'attempt', change: { kind: 'attempt', event, note } }
          }
        ];
      }
    }
  };

  const references = new Map<string, string>();
  const read = receipts.map((receipt) => {
    const command = parseCommand(receipt.fingerprint);
    if (command && 'nodeId' in command) {
      // The ID reservation's kind and Reference outlive the item, so a deleted one keeps them.
      if (receipt.itemReference !== null) references.set(command.nodeId, receipt.itemReference);
      if (receipt.itemKind !== null) kinds.set(command.nodeId, receipt.itemKind);
    }
    return { receipt, touches: command ? touchesOf(command) : [] };
  });
  const enabledBeforeReceipts = new Set(
    enablements
      .filter(({ enablementId }) => !receiptedEnablements.has(enablementId))
      .map(({ taskId }) => taskId)
  );
  return { read, origins: { references, kinds, enabledBeforeReceipts } };
};

/**
 * Where an item's replay starts: just before its first receipt. If that receipt created it, it
 * did not exist. Otherwise it is older than every receipt, and starts from what storage proves:
 * the kind reserved with its ID, and, for a Task none of whose Enablements predates the receipts,
 * the eligibility it was created with. Its other fields stay unknown until a receipt sets them.
 * A field no receipt sets cannot differ across a run, so its starting value is never read.
 */
const startOf = (origins: ItemOrigins, subjectId: string, first: Effect): ItemState => {
  const kind = origins.kinds.get(subjectId);
  const neverEnabled = kind !== undefined && !origins.enabledBeforeReceipts.has(subjectId);
  return {
    exists: first.kind !== 'created',
    title: undefined,
    status: undefined,
    placement: undefined,
    text: undefined,
    agentsEnabled: neverEnabled ? (initialAgentEligibility(kind) ?? undefined) : undefined,
    links: new Map()
  };
};

// Adding a relationship means it was absent just before, and removing one means it was present.
const learnPrior = (state: ItemState, effect: Effect): ItemState => {
  if (effect.kind !== 'linked' || state.links.has(linkKey(effect.link))) return state;
  const prior = { ...effect.link, present: !effect.link.present };
  return { ...state, links: new Map(state.links).set(linkKey(prior), prior) };
};

const apply = (state: ItemState, effect: Effect): ItemState => {
  switch (effect.kind) {
    case 'created': {
      const { input } = effect;
      return {
        ...state,
        exists: true,
        title: input.title,
        status: initialRequestedStatus(input.kind) ?? undefined,
        placement: input.kind === 'note' ? undefined : (input.planningPlacement ?? null),
        text: input.kind === 'note' ? input.content : input.description,
        agentsEnabled: initialAgentEligibility(input.kind) ?? undefined
      };
    }
    case 'deleted':
      return { ...state, exists: false };
    case 'updated': {
      const { fields } = effect;
      return {
        ...state,
        title: fields.title ?? state.title,
        status: fields.status ?? state.status,
        placement: fields.placement === undefined ? state.placement : fields.placement,
        text: fields.text ?? state.text
      };
    }
    case 'linked':
      return { ...state, links: new Map(state.links).set(linkKey(effect.link), effect.link) };
    case 'agents':
      return { ...state, agentsEnabled: effect.enabled };
    case 'attempt':
      return state;
  }
};

/*
 * A field that goes from unknown to known may or may not have changed. Free text is reported,
 * because a command rarely rewrites it to what it already was, and its new value says something.
 * Statuses, placements and eligibility are often set again to what they were, so they are not.
 */
type FromUnknown = 'reported' | 'suppressed';

const changed = <T>(
  before: T | undefined,
  after: T | undefined,
  fromUnknown: FromUnknown
): after is T =>
  after !== undefined &&
  (before === undefined
    ? fromUnknown === 'reported'
    : JSON.stringify(after) !== JSON.stringify(before));

type EntryDraft = {
  before: ItemState;
  after: ItemState;
  commandCount: number;
  textEdits: number;
  attempt: AttemptChange | null;
  last: StoredCommandReceipt;
};

/**
 * An Activity Entry is the difference between an item's state where its run started and where it
 * ended, so anything that ended where it started, including an item created and deleted inside the
 * run, says nothing. A new item starts from what its creation made it, so only what differs from
 * its defaults says more. Attempt events are history rather than state, so the latest one is kept.
 */
const changesOf = ({ before, after, textEdits, attempt }: EntryDraft): PendingChange[] => {
  if (!after.exists) return before.exists ? [{ kind: 'deleted' }] : [];
  const created = !before.exists;
  const changes: PendingChange[] = created ? [{ kind: 'created' }] : [];
  // A new item's title, text and placement are part of its creation, even when edited after.
  if (!created && changed(before.title, after.title, 'reported')) {
    changes.push({ kind: 'renamed', from: before.title ?? null, to: after.title });
  }
  if (changed(before.status, after.status, 'suppressed')) {
    changes.push({ kind: 'status_requested', from: before.status ?? null, to: after.status });
  }
  if (!created && changed(before.placement, after.placement, 'suppressed')) {
    changes.push({ kind: 'placement_changed', to: after.placement });
  }
  if (!created && changed(before.text, after.text, 'reported')) {
    changes.push({ kind: 'text_edited', edits: textEdits });
  }
  for (const [key, link] of after.links) {
    if (before.links.get(key)?.present === link.present) continue;
    changes.push({
      kind: 'relationship',
      change: link.present ? 'added' : 'removed',
      relationship: link.relationship,
      otherId: link.otherId
    });
  }
  if (changed(before.agentsEnabled, after.agentsEnabled, 'suppressed')) {
    changes.push({ kind: 'agent_eligibility', enabled: after.agentsEnabled });
  }
  if (attempt) changes.push(attempt);
  return changes;
};

/**
 * An entry as replay leaves it. A relationship change names its other item only by ID: who that
 * item is gets decided once, at assembly, as of the response's snapshot.
 */
export type PendingChange =
  | Exclude<ActivityChange, { kind: 'relationship' }>
  | (Omit<RelationshipChange, 'other'> & { otherId: string });
export type PendingEntry = {
  subjectId: string;
  /** The run's last receipt that touched the item. */
  lastSequence: number;
  at: string;
  commandCount: number;
  changes: PendingChange[];
};

/** Replays one run over the shared item states and returns its non-empty entries. */
export const replayRun = (
  receipts: readonly ReadReceipt[],
  states: Map<string, ItemState>,
  origins: ItemOrigins
): PendingEntry[] => {
  const drafts = new Map<string, EntryDraft>();
  for (const { receipt, touches } of receipts) {
    const counted = new Set<string>();
    for (const { subjectId, effect } of touches) {
      const state = learnPrior(
        states.get(subjectId) ?? startOf(origins, subjectId, effect),
        effect
      );
      const draft = drafts.get(subjectId) ?? {
        before: state,
        after: state,
        commandCount: 0,
        textEdits: 0,
        attempt: null,
        last: receipt
      };
      draft.after = apply(state, effect);
      // A new item is measured from the state its creation gave it, not from nothing.
      draft.before =
        effect.kind === 'created'
          ? { ...draft.after, exists: false }
          : learnPrior(draft.before, effect);
      draft.last = receipt;
      if (!counted.has(subjectId)) draft.commandCount += 1;
      counted.add(subjectId);
      if (effect.kind === 'updated' && effect.fields.text !== undefined) draft.textEdits += 1;
      if (effect.kind === 'attempt') {
        draft.attempt = {
          ...effect.change,
          note: effect.change.note ?? draft.attempt?.note ?? null
        };
      }
      states.set(subjectId, draft.after);
      drafts.set(subjectId, draft);
    }
  }
  return [...drafts].flatMap(([subjectId, draft]) => {
    const changes = changesOf(draft);
    if (changes.length === 0) return [];
    const { last, commandCount } = draft;
    return [{ subjectId, lastSequence: last.sequence, at: last.createdAt, commandCount, changes }];
  });
};
