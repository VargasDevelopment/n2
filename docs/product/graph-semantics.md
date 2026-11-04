# Graph semantics

N2 has two relationship kinds. They are intentionally not interchangeable, and both connect Work
Nodes only. Notes are standalone Canvas Items and never participate in relationships.

## Membership: `member_of`

A membership says a Work Node is **part of** a group.

- Canonical direction is member → group (`memberId` is part of `groupId`).
- Only a group can be the relationship object.
- A Work Node can participate directly in multiple groups.
- Memberships form an acyclic graph: groups can be nested and overlapping, but cannot form cycles.
- Each group derives progress and blocking from its direct members. Shared work therefore influences
  every group in which it participates; progress remains an orientation aid rather than additive
  accounting.
- Member progress and completion bubble upward into the group.
- A blocked member blocks its parent group; that blocked state can continue upward.
- The canvas labels the relationship **Part of**. If the member is actively blocking the group, the
  membership edge receives the blocking visual treatment.

The canvas may normalize a drag made from group → member into canonical member → group direction.
This convenience does not change the domain model.

## Dependency: `depends_on`

A dependency says one Work Node requires another Work Node's work.

- Canonical direction is dependent → dependency (`dependentId` depends on `dependencyId`).
- An unfinished dependency does not automatically block its dependent.
- A dependency whose effective status is `blocked` blocks its dependent.
- Nested membership can produce that blocked prerequisite: a blocked member blocks its group, and
  that group can then block nodes that depend on it.
- The canvas labels an inactive relationship **Depends on** and an actively blocking relationship
  **Blocked by** with a red treatment. Both labels read from dependent to dependency.

## Shared invariants

- Self-relationships, duplicates, dangling endpoints, Note endpoints, and metric cycles are
  invalid.
- Relationship validation is defined in the domain package and enforced atomically by the project
  repository, so HTTP, human, and future agent commands cannot bypass it.
- Effective status, progress, `blockedBy`, and relationship `isBlocking` are pure projections.
  Reading the graph never writes derived state.
- The UI consumes projected blocking state; it must not independently recreate propagation rules.

## Project boundary

- `Project` is the graph aggregate in contracts, domain code, persistence, API routes, and client
  cache identity.
- Every API route and client command is scoped by project ID, even while the UI opens only the
  default project.
- The existing SQLite `workspaces` table and `workspace_id` columns are legacy storage names kept
  private to the adapter so old local databases remain readable. They are not domain vocabulary.
- Legacy relationship rows are migrated losslessly. If an old row violates today's graph rules,
  domain canonicalization quarantines it from status/progress calculations and future command
  validation, and emits an `invalid_relationship` warning with a stable violation code; it is not
  silently deleted or treated as valid.
