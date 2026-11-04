---
status: accepted
---

# Project Activity is read from Command Receipts

Agents now make most graph changes, so the Person needs to see what changed. N² derives Project
Activity on read from the Command Receipts it already commits with every mutation. It keeps no
separate event table and writes no change summaries. To make that possible, three properties of a
receipt become contracts, and receipts gain an order and an Actor.

## The intent fingerprint is the canonical command document

A receipt's fingerprint is the canonical JSON of the whole parsed command, not a digest. Retries
compare it for equality, and Project Activity parses it back with the command transport schema to
learn what was applied. The fingerprint must therefore stay a complete, parseable command document:

- It is never hashed, truncated, or redacted.
- Every shape ever stored (including the legacy update shapes the replay path accepts) stays
  parseable.
- Changing its representation is a contract change for both retries and activity.

This was already relied on once: the version 8 migration recovered deleted items' kinds from
fingerprints. A receipt that does not parse is skipped, never guessed at.

Before-values are not stored. The feed rebuilds them by replaying earlier receipts in order. An
item older than every receipt starts from what storage proves, and the replay builds that start in
one place:

- Its kind and Reference come from its Entity ID reservation, which outlives the item.
- A Task none of whose Enablement reservations predates the receipts was never enabled for agents.
  Reservations are used rather than eligibility rows, because a row is deleted with its Task and
  overwritten by each Enablement.
- Its other fields are unknown until a receipt sets them. A field no receipt sets cannot change
  within a run, so its start is never read.

An unknown start never creates a change by itself. When a field goes from unknown to known, a
title or text is reported, as "Renamed to X" or "Description edited", because a command rarely
rewrites free text to its existing value. A status, placement or agent eligibility is not
reported, because commands often set those again to the value they already had.

A command can do more than its fields say. A new item takes defaults, a Note's text may be stored
under its legacy name, and a deletion removes the relationships at either endpoint. The replay takes
these rules from the domain package, which storage and receipt fingerprints also use, and keeps no
copy of its own. Storage applies the deletion rule as a foreign-key cascade, so a seeded
differential test holds the two together: it runs random commands through the application and
compares the feed with the difference between stored projections. It also starts from items whose
receipts it removed, so the start rules above are checked against real storage too.

## Receipts have a per-Project order

Each receipt gets a `sequence`, unique within its Project. It is assigned as the latest sequence
plus one inside the command's write transaction, so no two writers can take the same number. The
migration numbered existing receipts by `created_at`, then by insertion order. The implicit SQLite
rowid is not stable across VACUUM, and timestamps alone do not guarantee a total order, so neither
can be the order.

The projected graph carries the latest sequence it reflects. A query reads the sequence before the
graph, so the graph reflects at least that much. A command's own response carries its receipt's
sequence. When Activity reports a later sequence than the loaded graph, the web app refreshes the
graph. This holds on Activity's first load as well as on every poll, so an entry never opens onto
a canvas that is missing the change it describes.

## Receipts record a declared Actor

An adapter declares who is issuing a command in the `n2-actor` header: `person`, or
`agent:<url-encoded name>`. The web app sends `person`. The CLI sends the agent named by
`N2_AGENT_NAME`, or `cli` when that is unset. Execution Attempt commands are attributed to their
`workerId`, whatever the header says.

This is attribution, not authentication. N² has one owner and one trust boundary
(ADR 0011), and anything that can reach the API can already change the graph. Per-agent
credentials were rejected as too heavy for that boundary.

A missing or malformed header records no Actor. It never rejects the command: attribution must not
block work. Receipts written before this decision stay Unattributed. A heuristic backfill (such as
guessing that layout moves are human) was rejected, because a wrong name is worse than none.

## Deleted items keep their Reference

A node's Entity ID reservation now also stores its Canvas Item Reference, so activity can still
name a deleted item, for example "WEB-17 Old analytics spike". Reservations already outlive the
item for the same reason: its kind keeps old command intent interpretable. Items deleted before
this decision have no Reference left to keep and show their title only.

## Considered options

- **An activity or event table written beside each mutation.** It would duplicate the receipt and
  need a backfill. It would also create a second source of truth that could drift from what was
  applied.
- **A change summary stored on each receipt.** Same objections. It would also freeze today's
  wording into stored data.

## Consequences

Activity is computed per request from all of a Project's receipts. On the 19 Oct 2026 library
(9,479 receipts, 6,504 in one Project) this takes 5 to 50 ms per Project. If that stops being
true, a cache keyed by the latest sequence can sit in front of it without changing the contract.
Receipts are retained for the Project's lifetime and deleted only with the Project.
