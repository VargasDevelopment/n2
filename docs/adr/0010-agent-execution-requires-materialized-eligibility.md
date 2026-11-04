---
status: accepted
---

# Agent execution requires materialized task eligibility

N² separates planning state from permission to execute. A Task is eligible only after an explicit
enable action materializes the Task's current execution fingerprint and a new enablement ID;
Requested Status, Effective Status, Group membership, and previous agent activity never imply
eligibility. Enabling a Group is a preview-and-confirm convenience that materializes eligibility on
the exact reachable leaf Tasks named by the preview. It does not add inheritable Group state.

## Execution content and fingerprints

The versioned execution fingerprint is a deterministic SHA-256 digest of a Task's title,
description, and every active Depends on relationship incident to that Task, represented with the
named dependent and dependency endpoint identities and sorted canonically. Relationship-row
identity is excluded because recreating the same semantic relationship does not change the
instructions. Today the description is the only Task field that holds instructions, acceptance
criteria, and scope. Requested Status, Effective Status, planning placement, freeform position,
membership, Canvas Item version and timestamps, standalone Notes used as evidence or context, and
Attempt heartbeat/progress are excluded. Adding separately stored acceptance, scope, evidence, or
progress fields later requires an explicit decision about whether each field joins the fingerprint.

An enable action stores both the fingerprint and an enablement ID. Re-enabling unchanged content
creates a new, permanently reserved enablement ID so a queued claim tied to an older authorization
cannot run, even after later disable/re-enable cycles. A Group
preview token binds the Project, Group, and sorted reachable Task IDs. Confirmation recomputes the
set transactionally and rejects a changed preview rather than silently enabling different work.
Traversal deduplicates shared descendants and treats already-visited Groups as closed, so malformed
legacy cycles cannot hang or multiply the result.

## Attempts and atomic claims

Execution eligibility and Attempts live in Project-scoped SQLite tables beside the graph. The
eligibility row stores enabled/disabled state, enablement ID, enabled fingerprint, and timestamps.
An append-only reservation row prevents an enablement ID from ever being reused.
An Attempt stores its caller-supplied ID, Task, worker identity, claimed fingerprint and enablement
ID, a frozen JSON input snapshot, lifecycle state, timestamps, and latest progress. At most one
Attempt in `active` or `stop_requested` may exist for a Task.

A claim and its command receipt run in one immediate SQLite transaction. It succeeds only for an
enabled Task whose current, enabled, and caller-expected fingerprints match; whose caller-expected
enablement ID is current; whose Depends on dependencies are all Done; whose Requested Status is
neither Blocked (the existing explicit pause state) nor Done; and which has no active Attempt.
`ready` or `in_progress` never grants permission by itself. The snapshot contains the title,
description, and named dependency context at claim time. Later edits never rewrite it. Queries
expose both `newerInstructionsExist` and `stopRequested` so a worker can reconcile at a safe
boundary.

Attempt states are `active`, `stop_requested`, `completed`, `failed`, `released`, and `stopped`.
Heartbeat and progress preserve the state and fingerprint. Complete, fail, release, and
stop-confirmed require the owning Attempt ID and worker identity; commands against terminal or
superseded Attempts fail visibly. Disabling an eligible Task, or changing its Requested Status to
Blocked, immediately rejects new claims and changes an active Attempt only to `stop_requested`.
Only the worker's stop-confirmed command records `stopped`; a requested stop is never presented as
completed. Attempt terminal commands do not rewrite the Task's Requested Status, keeping planning
state under the existing Project Command contract. A Task with an `active` or `stop_requested`
Attempt cannot be deleted. Terminal Attempts remain durable if their Task is later deleted.

## Migration and rollback

The forward-only migration creates empty eligibility, enablement-reservation, and Attempt tables.
Existing rows receive no
eligibility record and therefore remain OFF; it does not inspect Ready, In progress, parent Groups,
or historical activity. This is safe for the current database because the migration does not
rebuild or rewrite the existing node and relationship tables. Rolling an application image back
does not reverse SQLite schema changes: the older image will leave the additive tables untouched,
but operators must restore a pre-migration SQLite-aware backup if physical schema rollback is ever
required. A future destructive migration must preserve or deliberately retire these records.
