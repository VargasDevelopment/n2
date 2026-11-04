---
status: accepted
---

# Completion does not remove work

N² separates execution state from presentation and long-term lifecycle. When a Group becomes Done,
the transition may be celebrated but nothing disappears automatically: a user may collapse its
topology, filter completed work from a canvas view, or eventually archive inactive work while
preserving the project graph and layout. This keeps completion reversible and prevents one Group's
lifecycle from removing a shared member that still participates in another active scope.

## Consequences

Completion celebrations fire only on a genuine transition, not when loading an already-completed
project. Collapse and filters remain non-mutating view choices; shared members can remain visible
through other scopes. Archive is the deliberate escape hatch for long-lived graphs, distinct from
Done, collapse, filtering, and deletion; its detailed interaction is deferred until implemented.
