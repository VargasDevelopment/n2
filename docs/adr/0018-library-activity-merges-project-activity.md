---
status: accepted
---

# Library Activity merges Project Activity and is seen per Project

The Project Library shows which Projects changed since the Person last looked, and offers one feed
across them. Library Activity is not a second read model. The server reads each unarchived Project
exactly as its own Activity sheet reads it (ADR 0014, ADR 0015), then merges the runs newest first
by time, because receipt sequences are only ordered within one Project. Every new run is kept, and
only runs that are not new are cut, to the same few for context across the whole Library. There is
one `GET /api/activity` response. The digest strip, the Project card counts and the Library feed
all read it, and the feed opens onto the response the digest is showing, so they agree on what is new. The client works out who changed each Project
from the runs the server marked new. It never compares sequences.

## Seen semantics

There is no Library-level Seen Marker. Each Project keeps its own, under the per-Project rule.
One rule decides what the feed acknowledges: **closing it acknowledges exactly the reading
session's snapshot.**

- **The snapshot is the response the feed opened onto.** The digest showed the same response. The
  30-second poll keeps the digest and the cards current, but it never changes the open sheet. A
  run that lands while the Person reads stays new, so the digest and the next open show it.
- **The snapshot only shrinks.** A Project the Library lists as archived drops out of the open
  sheet, and out of what closing acknowledges with it. It stays out for the rest of that reading
  session, even if it is restored before the feed closes.
- **Closing acknowledges each Project the sheet shows news for**, meaning the server counted new
  items there. The marker goes to the sequence the snapshot read for that Project. A Project moved
  on only by the Person's own changes is never written. One `POST /api/activity/seen` request does
  this in one immediate transaction.
- **The server skips an archived Project in that request.** It reads the archive state under the
  write lock, so an archive racing a close is never acknowledged, and the rest of the close still
  applies. An unknown Project rejects the whole request, so a close is never half-applied for any
  other reason. The response lists the markers that moved.
- **Leaving the feed any other way acknowledges nothing.** This includes following a link into a
  Project, as with a Project's own sheet. The Project's sheet then still shows those runs as new.
  While a new-Project draft is open, the feed's links stay in the Library, like the Project cards.
- **A digest row is not reading.** It names where and by whom, never what, so it opens the
  Project's own sheet and moves no marker. That arrival, like a feed link's focus on one item,
  belongs to its one navigation and is consumed once the workspace reads it. A remount, such as
  an archive and restore, or a history traversal opens the Project plainly.

## Archived Projects

Archived Projects are left out of the digest and the feed. This follows the Library, which puts
them away, and ADR 0015, which leaves them out of Library counts. Their markers stay where they
were, even when the archive lands while the feed is open. Whatever they hold that is new shows
again once the Project is restored.

## Considered options

- **One Library Seen Marker.** Rejected: it would disagree with each Project's own sheet about what
  is new.
- **Marking every Project seen on close, or acknowledging the latest poll.** Rejected: either
  could acknowledge a run the Person never saw.
- **Rejecting a batch that names an archived Project.** Rejected: archiving is the newer intent,
  and rejecting the batch would leave every other Project's news unacknowledged.
- **A separate feed endpoint fetched only while the feed is open.** Rejected: the digest and the feed
  could disagree when the feed opens. The cost of one response is small, because only new runs are unbounded, and
  reading them is what the digest is for.
- **Client fan-out over each Project's endpoint.** Rejected: one request per Project on every poll.

## Consequences

Each poll of the Library reads every unarchived Project's receipts once. That is the same cost as
the per-Project counts it replaces. The cache that ADR 0014 allows would serve both.
