import type { NodeKind, ProjectCommand } from '@n2/contracts';
import { patchedText } from '@n2/domain';
import type { CommandFingerprints } from './index.js';

/*
 * A receipt's fingerprint is the canonical JSON of the command itself, not a hash of it. Retries
 * compare it for equality, and Project Activity reads it back as the record of what was applied,
 * so changing this representation changes both (ADR 0014).
 */
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const fingerprintSet = (primary: string, ...compatible: string[]): CommandFingerprints => ({
  primary,
  accepted: [...new Set([primary, ...compatible])]
});

export const commandFingerprints = (
  command: ProjectCommand,
  reservedNodeKind: NodeKind | null
): CommandFingerprints => {
  if (command.kind === 'update_node' && reservedNodeKind === 'note') {
    const { content, description, ...patch } = command.patch;
    const text = patchedText('note', command.patch);
    // A Note's text may arrive under either name, so a retry matches across the rename.
    if (text !== undefined && (content === undefined || description === undefined)) {
      return fingerprintSet(
        canonicalJson(command),
        canonicalJson({ ...command, patch: { ...patch, content: text } }),
        canonicalJson({ ...command, patch: { ...patch, description: text } })
      );
    }
  }
  if (command.kind !== 'create_node' || command.input.kind !== 'note') {
    return fingerprintSet(canonicalJson(command));
  }
  // Note commands used `description` before Notes became standalone annotations. Keeping that
  // semantic fingerprint representation makes delayed retries replay across the migration.
  return fingerprintSet(
    canonicalJson({
      ...command,
      input: {
        title: command.input.title,
        description: command.input.content,
        kind: command.input.kind,
        position: command.input.position
      }
    })
  );
};
