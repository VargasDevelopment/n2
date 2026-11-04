---
status: accepted
---

# Swimlanes derive from Group membership without duplicating work

The first Swimlane dimension uses a selected Group as its Lane Scope: the scope's direct member
Groups define ordered Group Lanes, while membership reachability assigns descendant Work Nodes to
every lane in which they participate. This delivers useful planning structure from N²'s existing
overlapping Membership Graph without prematurely introducing a separate Work Stream domain model.

## Consequences

Every visible Work Node retains one primary interactive presentation. When overlapping membership
assigns it to additional lanes, those lanes show read-only Lane References to the same stable Work
Node. This preserves multi-membership legibility without cloning domain entities or requiring
multiple competing inspector, edge, drag, and selection surfaces. Primary lane choice is
deterministic from lane order and has no domain meaning.

The Lane Scope itself and scoped work that reaches no child lane appear in an explicit Scope lane;
work outside the scope appears in an explicit Outside Scope lane. Notes remain in their own region.
Lane order follows the authoritative Freeform order of the lane-defining Groups, but all Swimlane
geometry and references are presentation state and never rewrite Freeform positions or membership.
If Canvas Filters leave no Group visible, the composition uses a filter-local Visible Work lane plus
Notes instead of consulting hidden work or failing the active view.

Swimlane is orthogonal to Kanban and Roadmap. Kanban composes status columns with lane rows; Roadmap
composes calendar placement with lane rows in Scheduled Work while preserving its separate
Unscheduled Work and Notes regions. Selecting Kanban still replaces Roadmap and vice versa without
removing an enabled Swimlane transformation.
