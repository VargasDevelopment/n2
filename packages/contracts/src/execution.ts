import { z } from 'zod';
import { CanvasItemReferenceSchema, NodeStatusSchema, NodeTitleSchema } from './canvasItems.js';

export const ExecutionFingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export type ExecutionFingerprint = z.infer<typeof ExecutionFingerprintSchema>;

export const ExecutionAttemptStateSchema = z.enum([
  'active',
  'stop_requested',
  'completed',
  'failed',
  'released',
  'stopped'
]);
export type ExecutionAttemptState = z.infer<typeof ExecutionAttemptStateSchema>;

const SnapshotRelatedNodeSchema = z
  .object({
    id: z.string().min(1),
    reference: CanvasItemReferenceSchema,
    title: NodeTitleSchema,
    requestedStatus: NodeStatusSchema,
    effectiveStatus: NodeStatusSchema
  })
  .strict();

export const ExecutionInputSnapshotSchema = z
  .object({
    taskId: z.string().min(1),
    reference: CanvasItemReferenceSchema,
    title: NodeTitleSchema,
    description: z.string().max(20_000),
    dependencies: z.array(SnapshotRelatedNodeSchema),
    dependents: z.array(SnapshotRelatedNodeSchema)
  })
  .strict();
export type ExecutionInputSnapshot = z.infer<typeof ExecutionInputSnapshotSchema>;

export const ExecutionAttemptSchema = z
  .object({
    attemptId: z.string().uuid(),
    taskId: z.string().min(1),
    workerId: z.string().trim().min(1).max(240),
    claimedFingerprint: ExecutionFingerprintSchema,
    enablementId: z.string().uuid(),
    inputSnapshot: ExecutionInputSnapshotSchema,
    state: ExecutionAttemptStateSchema,
    progress: z.string().max(20_000).nullable(),
    claimedAt: z.string().datetime(),
    heartbeatAt: z.string().datetime(),
    stopRequestedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
    newerInstructionsExist: z.boolean(),
    stopRequested: z.boolean()
  })
  .strict();
export type ExecutionAttempt = z.infer<typeof ExecutionAttemptSchema>;

export const ExecutionEligibilityStateSchema = z.enum(['off', 'enabled', 'instructions_changed']);
export type ExecutionEligibilityState = z.infer<typeof ExecutionEligibilityStateSchema>;

export const ExecutionClaimBlockerCodeSchema = z.enum([
  'disabled',
  'instructions_changed',
  'paused',
  'done',
  'unfinished_dependencies',
  'active_attempt',
  'project_archived'
]);
export type ExecutionClaimBlockerCode = z.infer<typeof ExecutionClaimBlockerCodeSchema>;

export const TaskExecutionSchema = z
  .object({
    taskId: z.string().min(1),
    reference: CanvasItemReferenceSchema,
    title: NodeTitleSchema,
    eligibility: ExecutionEligibilityStateSchema,
    currentFingerprint: ExecutionFingerprintSchema,
    enabledFingerprint: ExecutionFingerprintSchema.nullable(),
    enablementId: z.string().uuid().nullable(),
    enabledAt: z.string().datetime().nullable(),
    disabledAt: z.string().datetime().nullable(),
    dispatchable: z.boolean(),
    claimBlockers: z.array(
      z
        .object({
          code: ExecutionClaimBlockerCodeSchema,
          taskIds: z.array(z.string().min(1)).default([])
        })
        .strict()
    ),
    activeAttempt: ExecutionAttemptSchema.nullable(),
    latestAttempt: ExecutionAttemptSchema.nullable()
  })
  .strict();
export type TaskExecution = z.infer<typeof TaskExecutionSchema>;

export const ProjectExecutionSchema = z
  .object({
    projectId: z.string().min(1),
    tasks: z.array(TaskExecutionSchema),
    attempts: z.array(ExecutionAttemptSchema)
  })
  .strict();
export type ProjectExecution = z.infer<typeof ProjectExecutionSchema>;

export const GroupEnablePreviewSchema = z
  .object({
    projectId: z.string().min(1),
    groupId: z.string().min(1),
    previewToken: ExecutionFingerprintSchema,
    tasks: z.array(
      z
        .object({
          taskId: z.string().min(1),
          reference: CanvasItemReferenceSchema,
          title: NodeTitleSchema
        })
        .strict()
    )
  })
  .strict();
export type GroupEnablePreview = z.infer<typeof GroupEnablePreviewSchema>;

const CommandIdSchema = z.string().uuid();
const AttemptIdSchema = z.string().uuid();
const EnablementIdSchema = z.string().uuid();
const WorkerIdSchema = z.string().trim().min(1).max(240);

export const EnableTaskForAgentsCommandSchema = z
  .object({
    kind: z.literal('enable_task_for_agents'),
    commandId: CommandIdSchema,
    taskId: z.string().min(1),
    enablementId: EnablementIdSchema
  })
  .strict();

export const DisableTaskForAgentsCommandSchema = z
  .object({
    kind: z.literal('disable_task_for_agents'),
    commandId: CommandIdSchema,
    taskId: z.string().min(1)
  })
  .strict();

export const EnableGroupForAgentsCommandSchema = z
  .object({
    kind: z.literal('enable_group_for_agents'),
    commandId: CommandIdSchema,
    groupId: z.string().min(1),
    previewToken: ExecutionFingerprintSchema,
    taskEnablements: z
      .array(z.object({ taskId: z.string().min(1), enablementId: EnablementIdSchema }).strict())
      .refine(
        (items) => new Set(items.map(({ taskId }) => taskId)).size === items.length,
        'Each Task can appear only once.'
      )
      .refine(
        (items) => new Set(items.map(({ enablementId }) => enablementId)).size === items.length,
        'Each Enablement ID can appear only once.'
      )
  })
  .strict();

export const ClaimTaskCommandSchema = z
  .object({
    kind: z.literal('claim_task'),
    commandId: CommandIdSchema,
    taskId: z.string().min(1),
    attemptId: AttemptIdSchema,
    workerId: WorkerIdSchema,
    expectedFingerprint: ExecutionFingerprintSchema,
    expectedEnablementId: EnablementIdSchema
  })
  .strict();

const AttemptOwnerFields = {
  commandId: CommandIdSchema,
  attemptId: AttemptIdSchema,
  workerId: WorkerIdSchema
};

export const HeartbeatAttemptCommandSchema = z
  .object({ kind: z.literal('heartbeat_attempt'), ...AttemptOwnerFields })
  .strict();
export const RecordAttemptProgressCommandSchema = z
  .object({
    kind: z.literal('record_attempt_progress'),
    ...AttemptOwnerFields,
    progress: z.string().max(20_000)
  })
  .strict();
export const CompleteAttemptCommandSchema = z
  .object({ kind: z.literal('complete_attempt'), ...AttemptOwnerFields })
  .strict();
export const FailAttemptCommandSchema = z
  .object({
    kind: z.literal('fail_attempt'),
    ...AttemptOwnerFields,
    error: z.string().max(20_000).optional()
  })
  .strict();
export const ReleaseAttemptCommandSchema = z
  .object({ kind: z.literal('release_attempt'), ...AttemptOwnerFields })
  .strict();
export const ConfirmAttemptStoppedCommandSchema = z
  .object({ kind: z.literal('confirm_attempt_stopped'), ...AttemptOwnerFields })
  .strict();

export const ExecutionConflictReasonSchema = z.enum([
  'task_required',
  'group_required',
  'preview_changed',
  'eligibility_disabled',
  'instructions_changed',
  'stale_fingerprint',
  'stale_enablement',
  'prerequisite_incomplete',
  'task_paused',
  'task_done',
  'attempt_active',
  'attempt_id_conflict',
  'enablement_id_conflict',
  'task_has_active_attempt',
  'project_has_active_attempt',
  'attempt_not_active',
  'attempt_owner_mismatch',
  'attempt_superseded',
  'stop_not_requested'
]);
export type ExecutionConflictReason = z.infer<typeof ExecutionConflictReasonSchema>;

export const ExecutionCommandSchemas = [
  EnableTaskForAgentsCommandSchema,
  DisableTaskForAgentsCommandSchema,
  EnableGroupForAgentsCommandSchema,
  ClaimTaskCommandSchema,
  HeartbeatAttemptCommandSchema,
  RecordAttemptProgressCommandSchema,
  CompleteAttemptCommandSchema,
  FailAttemptCommandSchema,
  ReleaseAttemptCommandSchema,
  ConfirmAttemptStoppedCommandSchema
] as const;

export const ExecutionCommandSchema = z.discriminatedUnion('kind', ExecutionCommandSchemas);
export type ExecutionCommand = z.infer<typeof ExecutionCommandSchema>;

export const ExecutionCommandOutcomeSchemas = [
  z.object({
    kind: z.literal('task_agent_eligibility_enabled'),
    taskId: z.string().min(1),
    enablementId: z.string().uuid()
  }),
  z.object({ kind: z.literal('task_agent_eligibility_disabled'), taskId: z.string().min(1) }),
  z.object({
    kind: z.literal('group_work_enabled_for_agents'),
    groupId: z.string().min(1),
    taskEnablements: z.array(
      z.object({ taskId: z.string().min(1), enablementId: z.string().uuid() }).strict()
    )
  }),
  z.object({
    kind: z.literal('attempt_claimed'),
    attemptId: z.string().uuid(),
    taskId: z.string().min(1)
  }),
  z.object({ kind: z.literal('attempt_heartbeat_recorded'), attemptId: z.string().uuid() }),
  z.object({ kind: z.literal('attempt_progress_recorded'), attemptId: z.string().uuid() }),
  z.object({ kind: z.literal('attempt_completed'), attemptId: z.string().uuid() }),
  z.object({ kind: z.literal('attempt_failed'), attemptId: z.string().uuid() }),
  z.object({ kind: z.literal('attempt_released'), attemptId: z.string().uuid() }),
  z.object({ kind: z.literal('attempt_stopped'), attemptId: z.string().uuid() })
] as const;

export type ExecutionCommandOutcome = z.infer<(typeof ExecutionCommandOutcomeSchemas)[number]>;

export const executionCommandOutcome = (command: ExecutionCommand): ExecutionCommandOutcome => {
  switch (command.kind) {
    case 'enable_task_for_agents':
      return {
        kind: 'task_agent_eligibility_enabled',
        taskId: command.taskId,
        enablementId: command.enablementId
      };
    case 'disable_task_for_agents':
      return { kind: 'task_agent_eligibility_disabled', taskId: command.taskId };
    case 'enable_group_for_agents':
      return {
        kind: 'group_work_enabled_for_agents',
        groupId: command.groupId,
        taskEnablements: command.taskEnablements
      };
    case 'claim_task':
      return { kind: 'attempt_claimed', attemptId: command.attemptId, taskId: command.taskId };
    case 'heartbeat_attempt':
      return { kind: 'attempt_heartbeat_recorded', attemptId: command.attemptId };
    case 'record_attempt_progress':
      return { kind: 'attempt_progress_recorded', attemptId: command.attemptId };
    case 'complete_attempt':
      return { kind: 'attempt_completed', attemptId: command.attemptId };
    case 'fail_attempt':
      return { kind: 'attempt_failed', attemptId: command.attemptId };
    case 'release_attempt':
      return { kind: 'attempt_released', attemptId: command.attemptId };
    case 'confirm_attempt_stopped':
      return { kind: 'attempt_stopped', attemptId: command.attemptId };
  }
};

export const ExecutionApiErrorSchema = z.object({
  code: z.literal('execution_conflict'),
  error: z.string().min(1),
  details: z.object({
    reason: ExecutionConflictReasonSchema,
    taskId: z.string().min(1).optional(),
    groupId: z.string().min(1).optional(),
    attemptId: z.string().uuid().optional(),
    taskIds: z.array(z.string().min(1)).optional()
  })
});
