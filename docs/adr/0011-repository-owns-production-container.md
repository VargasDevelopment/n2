---
status: accepted
---

# The server owns its production adapters

The production entrypoint, owner identity wrapper and backup command live in `apps/server` and use
its existing build and HTTP adapters. SQLite file guards, readiness queries and online backup live
in `packages/db`, keeping storage mechanics out of the HTTP boundary. A separate deployment package
would duplicate dependencies and build configuration without adding a domain boundary.

The repository builds directly into a pinned, non-root production image. The maintainer's
deployment Compose definition, kept outside this repository, requires persistent external
data/backup directories and an explicit image tag. Production opens
only an existing non-empty regular N2 library, verified read-only for a supported schema version and
core tables/columns before migrations; it never bootstraps a replacement. Development keeps
its convenience creation behavior. Owner-authenticated browser and trusted host-local native API
listeners retain their existing ports and CLI layout. Trust in the Serve-injected identity header
requires loopback publication and a trusted host/network; the header itself is forgeable.

Backup uses SQLite's online API and publishes a verified DELETE-mode snapshot plus checksummed
metadata. Retention remains on the host. Health queries the live connection and reports the schema
and build commit. Deploy workflow wiring, host configuration, production cutover and schema-aware
rollback orchestration remain separate from this repository preparation.
