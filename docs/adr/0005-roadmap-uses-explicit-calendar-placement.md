---
status: accepted
---

# Roadmap uses explicit calendar placement

N² models planning time on Work Nodes as an optional Planning Placement: either an inclusive,
date-only Planning Window or a zero-duration Milestone on one Planning Date. A Work Node without a
placement is Unscheduled Work, while Notes remain standalone annotations and cannot be scheduled.
This deliberately keeps due dates and planning horizons out of the initial model: a due date is a
constraint, and Now/Next/Later is prioritization; neither unambiguously says when work is intended
to occur.

## Consequences

Tasks and Groups may each have their own explicit Planning Placement. Group placement is never
derived from or cascaded into member placement, and membership or dependency relationships never
infer or rewrite planning time. This is especially important for overlapping membership: a shared
Work Node has no single Group whose schedule may silently own it.

Planning Dates remain calendar days rather than instants, avoiding time-of-day and time-zone
semantics. They cross system boundaries as valid `YYYY-MM-DD` calendar dates. Planning Placement is
a discriminated choice: a same-day Planning Window remains a window and is not normalized into a
Milestone. A Planning Window's start must not be later than its end; setting or clearing the complete
Planning Placement is one atomic Project Command.

The Roadmap Transformation places scheduled work on a horizontal calendar axis and keeps
Unscheduled Work and Notes in explicit regions without changing authoritative Freeform positions.
Changing a Planning Placement is a Project Command; changing the derived Roadmap layout is not.
The Roadmap Range is presentation and filter state: editing or scrubbing it changes the visible
calendar interval but never rewrites a Work Node's Planning Placement.

Roadmap and Kanban are mutually exclusive transformations because each defines the primary
organization and spatial interaction of work. Effective Status remains visible and filterable in
Roadmap without enabling Kanban. Switching between the transformations is explicit, and the
resolver rejects their unsupported combination rather than applying precedence or silently
discarding one. Future Swimlane compositions must define an independently useful, orthogonal
dimension and declare compatibility with Roadmap and Kanban separately.
