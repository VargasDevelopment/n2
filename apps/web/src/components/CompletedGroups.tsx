import type { ProjectedGroup } from '../useProjectCommands.js';

const MAX_ALSO_LISTED = 3;

/** The celebration headline for the Group that leads a completion. */
export function CompletedGroupHeadline({ group }: { group: ProjectedGroup }) {
  return (
    <>
      <span className="toast__reference">{group.reference}</span>
      <strong>{group.title}</strong> — complete
    </>
  );
}

/** The quieter line naming any further Groups the same change completed. */
export function AlsoCompletedGroups({ groups }: { groups: readonly ProjectedGroup[] }) {
  const listed = groups.slice(0, MAX_ALSO_LISTED);
  const unlisted = groups.length - listed.length;
  return (
    <>
      Also complete:{' '}
      {listed.map((group, index) => (
        <span key={group.id}>
          {index > 0 ? ', ' : null}
          <span className="toast__reference">{group.reference}</span>
          {group.title}
        </span>
      ))}
      {unlisted > 0 ? ` and ${unlisted} more` : null}
    </>
  );
}
