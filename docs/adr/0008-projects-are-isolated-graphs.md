---
status: accepted
---

# Projects are isolated graphs

Each Project owns one graph, one authoritative freeform layout, one monotonically allocated Canvas
Item Reference sequence, and its own Project-scoped command stream. The Project Library lists these
durable boundaries and creates new blank Projects. Opening or switching Projects changes the active
boundary rather than combining graphs in one canvas.

## Consequences

Canvas Items and relationships cannot cross Project boundaries. The web interface gives each
Project a direct local URL and resets ephemeral canvas state when the active Project changes. The
API, typed client, and CLI require a Project identity for graph queries and Project Commands;
Project Library queries and creation sit beside that command surface rather than masquerading as
graph mutations.

Project creation requires a caller-generated UUID, a name, and a Project Reference Key. Retrying
the same identity and metadata is idempotent. Reusing either the UUID with different metadata or
the key for another Project is a conflict. A new Project has no template content, and its first
Canvas Item receives sequence number one.

This boundary deliberately excludes cross-Project relationships, portfolio rollups, deletion,
archiving, and template selection. Those capabilities can be designed later without weakening the
meaning of an active Project or silently coupling otherwise independent graphs.

ADR 0012 later adds reversible Project archiving and display-name renaming; deletion remains
excluded.
