import type { NodeKind, NodeStatus } from '@n2/contracts';

/*
 * What applying a Canvas Item command does beyond what the command itself says. Storage applies
 * these rules and Project Activity replays them from Command Receipts, so both take them from here.
 */

/** A new Work Node is requested Ready; a Note has no status. */
export const initialRequestedStatus = (kind: NodeKind): NodeStatus | null =>
  kind === 'note' ? null : 'ready';

/** A new Task is off for agents until someone enables it; other kinds never run. */
export const initialAgentEligibility = (kind: NodeKind): boolean | null =>
  kind === 'task' ? false : null;

/**
 * The text a node patch sets. Notes called their Markdown `description` before they became
 * standalone annotations, and receipts from then still do.
 */
export const patchedText = (
  kind: NodeKind,
  patch: { description?: string | undefined; content?: string | undefined }
): string | undefined =>
  kind === 'note' ? (patch.content ?? patch.description) : patch.description;

/** Deleting a Canvas Item deletes every relationship with it at either endpoint. */
export const isDeletedWithItem = (
  endpoints: { subjectId: string; objectId: string },
  nodeId: string
): boolean => endpoints.subjectId === nodeId || endpoints.objectId === nodeId;
