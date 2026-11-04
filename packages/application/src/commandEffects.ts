import type { ProjectCommand } from '@n2/contracts';

/**
 * Whether applying a command can change any Work Node's effective status, and so complete a Group.
 * Only these commands pay for deriving Command Effects under the write lock. A wrong "no" only
 * misses a Group Completion, never credits one, and every kind is classified here explicitly: a
 * new kind leaves this switch non-exhaustive and fails typecheck until it is classified.
 */
export const canChangeEffectiveStatus = (command: ProjectCommand): boolean => {
  switch (command.kind) {
    case 'update_node':
      return command.patch.requestedStatus !== undefined;
    case 'delete_node':
    case 'delete_relationship':
      // Removing an unfinished member or a blocked dependency can leave work done.
      return true;
    case 'create_relationship':
      // A new dependency can only add blocking, which never completes work; a new member can.
      return command.input.kind === 'member_of';
    // A new node joins no Group and was not there before to be credited; layout never affects
    // status; execution commands read requested status but never write it.
    case 'create_node':
    case 'move_nodes':
    case 'enable_task_for_agents':
    case 'disable_task_for_agents':
    case 'enable_group_for_agents':
    case 'claim_task':
    case 'heartbeat_attempt':
    case 'record_attempt_progress':
    case 'complete_attempt':
    case 'fail_attempt':
    case 'release_attempt':
    case 'confirm_attempt_stopped':
      return false;
  }
};
