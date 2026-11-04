---
status: accepted
---

# Projects can be archived and renamed, not deleted

This amends ADR 0008, which excluded archiving and deletion from the Project boundary. Finished
Projects clutter the Project Library, so a Project can now be archived: a deliberate, reversible
lifecycle state recorded as a nullable archive timestamp beside the Project's identity. Archiving
never changes the graph, freeform layout, statuses, Canvas Item References, Project Settings,
command receipts, or Execution Attempt history, and completing work never archives a Project
(consistent with ADR 0003). A Project's display name can also be renamed; its UUID and Project
Reference Key never change.

## Archived Projects are read-only

Every write into an archived Project is rejected with a typed `project_archived` error: Project
Commands (including agent enable, claim, and Attempt lifecycle commands), Project Setting writes,
and renames. One repository path owns this rule so new write paths inherit it rather than
re-implementing it: every write to an existing Project, and every lifecycle change (archive,
restore, rename), opens a `BEGIN IMMEDIATE` transaction first and only then reads the Project's
lifecycle state. Holding the write lock across that read and the dependent write means another
connection cannot archive between a passed check and a write, and an archive cannot read
Execution Attempts that a concurrent claim then changes. Project-scoped writes require a
writability proof that only this path issues, so a write cannot skip the check. Reads (project show, node explanation, execution state, settings) keep working.
An identical retry of a command that already committed still replays its receipt, because a replay
reports a past outcome rather than writing.

Archiving is refused with an `execution_conflict` (`project_has_active_attempt`) while any Execution
Attempt in the Project is `active` or `stop_requested`; the owner must let those Attempts reach a
terminal state first. Eligibility that is enabled but idle does not block archiving: claims are
rejected while the Project stays archived and become possible again only after restore. Archive and
restore are idempotent: archiving an archived Project keeps its original timestamp, and restoring an
unarchived Project succeeds without change.

The Project Library lists unarchived Projects by default. The API, typed client, and CLI expose an
explicit option to include Archived Projects, and every Project summary carries `archivedAt`
(`null` when unarchived). The web Library shows Archived Projects in a separate, collapsed section
with a Restore action; a stale link to an Archived Project shows that state instead of the canvas.

## Ordering lifecycle changes across clients

Every summary also carries a `lifecycleRevision`. The service increments it in the same immediate
transaction as each committed rename, archive, or restore; an idempotent no-op leaves it unchanged.
Responses, Library fetches, other tabs, and the CLI can deliver summaries in any order, and a
request can even commit after a later one when a client times out. Clients therefore keep the
higher revision of each Project's name and archive state instead of trusting arrival order. The
web client applies this at its single Library cache boundary, and the Library summary is the only
place the web UI reads lifecycle metadata from.

## Renaming and creation retries

Rename validates the name exactly like creation and changes only the display name. Project
creation retries still compare the requested name with the stored one, so a delayed retry of an
original creation after a rename reports a `projectId` conflict rather than silently succeeding;
that conflict is truthful and nothing is overwritten. A creation retry for an Archived Project
returns the existing, still-archived Project and never restores it.

## Why hard deletion is deferred

Deletion is not reversible and has known traps that archiving avoids:

- the starter Project is reseeded on open whenever its fixed reserved ID is missing, so deleting it
  would silently recreate it;
- releasing a Project Reference Key for reuse would let a new Project mint references that collide
  with references recorded elsewhere, contradicting ADR 0007's never-reused guarantee;
- an idempotent `createProject` retry carrying a deleted UUID would resurrect a blank Project under
  the old identity unless deleted Project IDs were permanently reserved;
- Project-scoped rows cascade, so deletion would also erase command receipts and Execution Attempt
  history that agents and the owner rely on.

A future deletion design must reserve deleted Project IDs and reference keys permanently, decide
what happens to the starter Project, and decide whether receipts and Attempt history are retained.

## Migration

The forward-only migration adds a nullable `archived_at` column and a `lifecycle_revision` column
(default 0) to the existing projects table, so every existing Project starts unarchived at revision 0. An older application image refuses the newer schema
version; physical rollback requires restoring a pre-migration backup, as in ADR 0010.
