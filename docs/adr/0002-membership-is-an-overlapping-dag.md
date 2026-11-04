---
status: accepted
---

# Membership is an overlapping DAG

N² allows a Work Node to be a direct member of multiple Groups because real work can participate in
several meaningful scopes without being duplicated. Membership is therefore non-exclusive and
acyclic rather than an ownership tree: each Group derives progress and blocking from its direct
members, so shared work intentionally influences every scope in which the user placed it. Passive
classification may later use labels or views, but it is not a substitute for membership when the
work should affect each Group's state.

## Consequences

Membership cycles and duplicate member–Group pairs remain invalid. Progress is an orientation aid,
not additive accounting: a shared member can influence more than one path through a larger graph.
Databases created under the former single-membership rule re-evaluate quarantined extra
memberships: valid overlaps become active, while any relationship that would now introduce a cycle
remains quarantined under the cycle invariant.
