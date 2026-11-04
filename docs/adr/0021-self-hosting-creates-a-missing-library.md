---
status: accepted
---

# Self-hosting creates a missing library

ADR 0011's production entrypoint opens only an existing library and trusts an identity header from
an authenticating proxy. Neither holds for someone running N2 from a fresh clone: there is no
library yet and no proxy.

A separate self-host entrypoint (`dist/selfhost.js`, used by `compose.yaml`) serves the
web bundle and the API on one port with no login. It opens the library with the `create-if-missing`
policy, which lives in `packages/db` beside production's `existing` policy (ADR 0011 keeps file
guards in storage). When nothing is at the path, the policy creates a new library with the starter
Project, exclusively and with owner-only permissions. When anything is at the path, including a
symlink, it applies the same checks as `existing`: a non-empty regular file that is an N2 library
with a supported schema. So a wrong path still cannot silently replace an existing library with a
new one, but a first run works.

Without a login, the port is the trust boundary. Compose publishes it on host loopback only. A
browser can still carry a hostile page's requests to that port, so every request must be addressed
to a local host name (`localhost`, `127.0.0.1`, `[::1]`) or one listed in `N2_ALLOWED_HOSTS`, which
defeats DNS rebinding. Writes that carry an `Origin` must come from the same host and port.

The production entrypoint is unchanged. Its deployment configuration lives outside this repository.
