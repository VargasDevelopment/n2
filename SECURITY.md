# Security

## Reporting a vulnerability

Please report security problems privately through GitHub:
<https://github.com/VargasDevelopment/n2/security/advisories/new>. Do not open a public issue.

N2 is a personal tool shared as-is. Reports are read when time allows, and there is no promised
response time or fix. Only the latest `main` is looked at.

## Threat model

N2 is built for one person on their own machine.

- **There is no login and there are no user accounts.** Anything that can reach N2's port can read
  and change the whole library, including through the agent CLI.
- **Keep it on localhost.** `pnpm dev` binds to `127.0.0.1`. `compose.yaml` publishes the
  port on `127.0.0.1` only. Other users and programs on the same machine can still reach it.
- **Do not expose N2 to the internet or a shared network.** Do not publish the port on `0.0.0.0`,
  forward it through a router, or put it behind a public reverse proxy. If you need to reach it
  from another device, use a connection that authenticates you, such as an SSH tunnel.
- **Web pages in your browser.** A page on another site can try to reach a local port, either
  directly or by pointing its own domain at `127.0.0.1` (DNS rebinding). The self-host server
  (`dist/selfhost.js`, used by Compose) answers only requests addressed to `localhost`,
  `127.0.0.1`, `[::1]` or a name you list in `N2_ALLOWED_HOSTS`. It also rejects a write whose
  `Origin` is not the same host and port. The development servers started by `pnpm dev` do not
  have these checks, so prefer the self-host server for everyday use.
- **Agents are trusted callers.** Agent eligibility and Execution Attempts organize work between
  you and your agents. They are not a permission system. An agent that can reach the API can do
  anything you can.
- **Data at rest is not encrypted.** The library and its backups are plain SQLite files. Protect
  them with file permissions and disk encryption. Backups are written with owner-only permissions.
