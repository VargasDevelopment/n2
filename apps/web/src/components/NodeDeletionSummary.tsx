import type { NodeDeletion } from '../graphInteraction.js';
import './NodeDeletionSummary.css';

const MAX_LISTED = 5;

/** The confirmation body for a node delete: exactly what goes, and what goes with it. */
export function NodeDeletionSummary({
  deletion: { nodes, consequences }
}: {
  deletion: NodeDeletion;
}) {
  const listed = nodes.slice(0, MAX_LISTED);
  const unlisted = nodes.length - listed.length;
  return (
    <>
      <ul className="node-deletion__items" aria-label="Deleting">
        {listed.map((node) => (
          <li key={node.id}>
            <span className="node-deletion__reference">{node.reference}</span>
            <span className="node-deletion__title">{node.title}</span>
          </li>
        ))}
        {unlisted > 0 ? <li className="node-deletion__more">and {unlisted} more</li> : null}
      </ul>
      {consequences.map((consequence) => (
        <p key={consequence}>{consequence}</p>
      ))}
      <p className="node-deletion__permanent">This can’t be undone.</p>
    </>
  );
}
