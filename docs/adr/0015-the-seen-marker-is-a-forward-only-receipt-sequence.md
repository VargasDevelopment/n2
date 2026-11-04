---
status: accepted
---

# The Seen Marker is a forward-only receipt sequence

"What changed since I last looked" is measured against a Seen Marker: one per Project, stored in
SQLite on the server, holding the latest receipt sequence (ADR 0014) the Person has looked at and
when. An Activity Run after it is new, unless it is the Person's own. It is stored on the server
so every device and tab agrees, and it survives a browser reset.

## Semantics

- **It only moves forward.** A write with a lower sequence is ignored, so a stale tab cannot
  un-see what another tab has seen.
- **It is clamped** to the Project's latest receipt, so a bad value cannot hide activity that has
  not happened yet.
- **Closing the Activity sheet advances it**, to the latest sequence the sheet had loaded, never
  to whatever arrived on the server since. Opening a Project does not advance it: seeing the canvas
  is not reading the changes.
- **The Person's own changes are listed but never new**, however recent. The count answers "what
  did someone else do?". The server decides newness once, per run, and everything else follows from
  that one decision: the count, which runs the sheet lists as new, and which history is cut short.
  The sheet never works it out again from sequences.
- **An Activity Run never spans the marker**, so "new" is always whole runs.
- **Every new run is returned.** Only the runs that are not new are cut short, to a few for
  context, so closing the sheet never acknowledges a new run the sheet did not have, and the
  Person's own busy afternoon never makes the feed unbounded.
- **Looking is not a Project Command.** It writes no receipt and is allowed on Archived Projects,
  which are left out of Library counts.
- **Agents never move it.** The CLI reads activity but has no way to mark it as seen.

Existing Projects start caught up: the migration that introduced the marker set each one to the
Project's latest receipt. Otherwise the first look would show months of Unattributed history as
new. Projects created later have no marker until first looked at, so everything in them is new
except the Person's own changes.

## Considered options

- **Browser-local storage.** Rejected: each device would disagree about what is new.
- **A timestamp instead of a sequence.** Rejected: clocks are not an order, and receipts can share a
  millisecond.
- **Per-item read state.** Rejected: too fine-grained for a glance, and costly to keep consistent.
- **Advance on open, or with an explicit "Mark as seen" button.** On open drops the highlight the
  moment you look. A button adds a chore to every visit.
