import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { NODES_PLANNING_SHAPE_SQL } from './planningConstraint.js';

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    referenceKey: text('reference_key').notNull(),
    nextCanvasItemNumber: integer('next_canvas_item_number').notNull(),
    initialSettings: text('initial_settings').notNull().default('{}'),
    archivedAt: text('archived_at'),
    lifecycleRevision: integer('lifecycle_revision').notNull().default(0)
  },
  (table) => [
    unique('workspaces_reference_key_unique').on(table.referenceKey),
    check('workspaces_next_canvas_item_number_positive', sql`${table.nextCanvasItemNumber} >= 1`)
  ]
);

export const applicationPreferences = sqliteTable(
  'application_preferences',
  {
    key: text('key', { enum: ['handleOrientation', 'minimapVisible', 'theme'] }).primaryKey(),
    value: text('value').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [
    check(
      'application_preferences_value_shape',
      sql`(${table.key} = 'handleOrientation' AND ${table.value} IN ('"horizontal"', '"vertical"')) OR (${table.key} = 'minimapVisible' AND ${table.value} IN ('true', 'false')) OR (${table.key} = 'theme' AND ${table.value} IN ('"midnight"', '"mono"', '"paper"', '"ember"', '"system"'))`
    )
  ]
);

export const projectSettingOverrides = sqliteTable(
  'project_setting_overrides',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key', { enum: ['handleOrientation', 'minimapVisible', 'theme'] }).notNull(),
    value: text('value').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.key] }),
    index('project_setting_overrides_workspace_id_idx').on(table.workspaceId),
    check(
      'project_setting_overrides_value_shape',
      sql`(${table.key} = 'handleOrientation' AND ${table.value} IN ('"horizontal"', '"vertical"')) OR (${table.key} = 'minimapVisible' AND ${table.value} IN ('true', 'false')) OR (${table.key} = 'theme' AND ${table.value} IN ('"midnight"', '"mono"', '"paper"', '"ember"', '"system"'))`
    )
  ]
);

export const nodes = sqliteTable(
  'nodes',
  {
    id: text('id').primaryKey(),
    reference: text('reference').notNull(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    content: text('content'),
    kind: text('kind', { enum: ['task', 'group', 'note'] }).notNull(),
    requestedStatus: text('requested_status', {
      enum: ['ready', 'in_progress', 'blocked', 'done']
    }),
    planningKind: text('planning_kind', { enum: ['window', 'milestone'] }),
    planningStartDate: text('planning_start_date'),
    planningEndDate: text('planning_end_date'),
    positionX: real('position_x').notNull(),
    positionY: real('position_y').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [
    index('nodes_workspace_id_idx').on(table.workspaceId),
    unique('nodes_reference_unique').on(table.reference),
    check(
      'nodes_kind_status_shape',
      sql`(${table.kind} = 'note' AND ${table.description} IS NULL AND ${table.content} IS NOT NULL AND ${table.requestedStatus} IS NULL) OR (${table.kind} IN ('task', 'group') AND ${table.description} IS NOT NULL AND ${table.content} IS NULL AND ${table.requestedStatus} IN ('ready', 'in_progress', 'blocked', 'done'))`
    ),
    check('nodes_planning_shape', sql.raw(NODES_PLANNING_SHAPE_SQL))
  ]
);

export const edges = sqliteTable(
  'edges',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    source: text('source')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    target: text('target')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['member_of', 'depends_on'] }).notNull(),
    createdAt: text('created_at').notNull()
  },
  (table) => [
    index('edges_workspace_id_idx').on(table.workspaceId),
    unique('edges_project_relationship').on(
      table.workspaceId,
      table.source,
      table.target,
      table.kind
    ),
    check('edges_distinct_nodes', sql`${table.source} <> ${table.target}`)
  ]
);

export const relationshipQuarantines = sqliteTable(
  'relationship_quarantines',
  {
    relationshipId: text('relationship_id')
      .primaryKey()
      .references(() => edges.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    violation: text('violation', {
      enum: [
        'self_relationship',
        'missing_node',
        'duplicate_relationship',
        'work_node_required',
        'group_required',
        'cycle'
      ]
    }).notNull(),
    message: text('message').notNull()
  },
  (table) => [index('relationship_quarantines_workspace_id_idx').on(table.workspaceId)]
);

export const commandReceipts = sqliteTable(
  'command_receipts',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    commandId: text('command_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    outcome: text('outcome').notNull(),
    createdAt: text('created_at').notNull(),
    sequence: integer('sequence'),
    actorKind: text('actor_kind', { enum: ['person', 'agent'] }),
    actorName: text('actor_name')
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.commandId] }),
    index('command_receipts_workspace_id_idx').on(table.workspaceId),
    uniqueIndex('command_receipts_project_sequence').on(table.workspaceId, table.sequence)
  ]
);

export const activitySeenMarkers = sqliteTable('activity_seen_markers', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  seenAt: text('seen_at').notNull()
});

export const executionEligibilities = sqliteTable(
  'execution_eligibilities',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    enablementId: text('enablement_id').notNull(),
    enabledFingerprint: text('enabled_fingerprint').notNull(),
    enabledAt: text('enabled_at').notNull(),
    disabledAt: text('disabled_at')
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.taskId] }),
    index('execution_eligibilities_workspace_id_idx').on(table.workspaceId)
  ]
);

export const executionEnablementReservations = sqliteTable(
  'execution_enablement_reservations',
  {
    enablementId: text('enablement_id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    createdAt: text('created_at').notNull()
  },
  (table) => [index('execution_enablement_reservations_workspace_id_idx').on(table.workspaceId)]
);

export const executionAttempts = sqliteTable(
  'execution_attempts',
  {
    attemptId: text('attempt_id').primaryKey(),
    createdOrder: integer('created_order').notNull(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    workerId: text('worker_id').notNull(),
    claimedFingerprint: text('claimed_fingerprint').notNull(),
    enablementId: text('enablement_id').notNull(),
    inputSnapshot: text('input_snapshot').notNull(),
    state: text('state', {
      enum: ['active', 'stop_requested', 'completed', 'failed', 'released', 'stopped']
    }).notNull(),
    progress: text('progress'),
    claimedAt: text('claimed_at').notNull(),
    heartbeatAt: text('heartbeat_at').notNull(),
    stopRequestedAt: text('stop_requested_at'),
    finishedAt: text('finished_at')
  },
  (table) => [
    index('execution_attempts_workspace_id_idx').on(table.workspaceId),
    index('execution_attempts_task_id_idx').on(table.taskId),
    uniqueIndex('execution_attempts_one_active_per_task')
      .on(table.workspaceId, table.taskId)
      .where(sql`${table.state} IN ('active', 'stop_requested')`),
    unique('execution_attempts_project_order_unique').on(table.workspaceId, table.createdOrder)
  ]
);

export const entityIdReservations = sqliteTable(
  'entity_id_reservations',
  {
    entityType: text('entity_type', { enum: ['node', 'relationship'] }).notNull(),
    entityId: text('entity_id').notNull(),
    nodeKind: text('node_kind', { enum: ['task', 'group', 'note'] }),
    // A Canvas Item's Reference, kept after deletion so Project Activity can still name it.
    reference: text('reference'),
    createdAt: text('created_at').notNull()
  },
  (table) => [
    primaryKey({ columns: [table.entityType, table.entityId] }),
    check(
      'entity_id_reservations_kind_shape',
      sql`(${table.entityType} = 'node' AND (${table.nodeKind} IS NULL OR ${table.nodeKind} IN ('task', 'group', 'note'))) OR (${table.entityType} = 'relationship' AND ${table.nodeKind} IS NULL)`
    )
  ]
);

export const schema = {
  workspaces,
  applicationPreferences,
  projectSettingOverrides,
  nodes,
  edges,
  relationshipQuarantines,
  commandReceipts,
  activitySeenMarkers,
  executionEligibilities,
  executionEnablementReservations,
  executionAttempts,
  entityIdReservations
};
