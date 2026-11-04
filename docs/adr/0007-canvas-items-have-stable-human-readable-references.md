---
status: accepted
---

# Canvas items have stable human-readable references

Every Canvas Item receives an immutable, human-readable Canvas Item Reference such as `N2-42`.
The reference combines its Project's stable Project Reference Key with a positive sequence number.
The existing UUID remains the canonical internal identity used by Project Commands, command
fingerprints, relationships, and persistence joins.

## Consequences

Canvas Item References are allocated transactionally and monotonically within a Project. Deleting
an item does not release its number, so a reference never comes to identify different work. Title
changes do not affect identity. Duplicating or importing an item allocates a new local reference;
external identifiers such as Jira ticket keys remain aliases or integration metadata rather than
becoming N² identity.

A Project Reference Key is unique within the local Project Library and becomes immutable once the
Project has issued a reference. This makes a full reference unambiguous across Projects while still
allowing a future active-project shorthand such as `#42`. Existing databases receive deterministic
references ordered by creation time and canonical ID. Agent and query adapters may resolve either a
UUID or a Canvas Item Reference, but they resolve to the UUID before executing domain behavior.
Migration skips sequence numbers whose resulting reference would collide with any preserved legacy
internal ID—whether its item is live or deleted—and advances beyond all such reserved numbers before
permitting new allocation. Exact canonical-ID lookup takes precedence as a final compatibility
safeguard.

The reference is shown quietly on canvas appliances, prominently in the Inspector, and participates
in Canvas text search. Persisting the full reference on each Canvas Item intentionally makes the
identity self-contained at projection and adapter boundaries; the immutable Project Reference Key
prevents that denormalization from drifting.
