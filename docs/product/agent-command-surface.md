# Agent command surface

Status: first local CLI slice implemented

## Shape

N² has one typed project-command language and multiple adapters. The web interface translates
gestures into those commands; the CLI accepts the same command documents; a future MCP server can
adapt the same contracts without inventing parallel behavior.

The CLI is deliberately not the domain boundary. It is the first headless adapter because it is
local, scriptable, portable between agent harnesses, and useful before any MCP host is configured.

## Running it

Run the local service without opening the web interface:

```bash
pnpm --filter @n2/server dev
```

List the local Project Library, create a Project, or inspect an existing Project:

```bash
pnpm --silent n2 project list --pretty
pnpm --silent n2 project create \
  --id 4a31ed94-8778-4f01-9b58-1203d55c8f00 \
  --name "Garden decision" \
  --key GARDEN \
  --pretty
```

```bash
pnpm --silent n2 project show --pretty
```

The defaults are `http://127.0.0.1:4317` and project `default`. Override them with `--api-url` and
`--project`, or with `N2_API_URL` and `N2_PROJECT_ID`. Local requests time out after ten seconds by
default; `--timeout-ms` or `N2_TIMEOUT_MS` can change that bound.

Every change the CLI makes is attributed in Project Activity to a named Agent. Set
`N2_AGENT_NAME` (for example `N2_AGENT_NAME=codex-review`) so the person can tell agents apart;
without it the name is `cli`. Execution Attempt commands are attributed to their `workerId`. Read a
Project's activity, newest first, with:

```bash
pnpm --silent n2 activity show --pretty
```

Reading activity never marks it as seen; only the person's own look does.

Project creation requires a caller-generated UUID so an ambiguous timeout can be retried with the
same identity. It creates a blank isolated graph. The required reference key is unique in the local
Project Library and will prefix every Canvas Item Reference in that Project.

Rename a Project's display name, or put a finished Project away and bring it back:

```bash
pnpm --silent n2 project rename --project <id> --name "Electricity Renewal 2026" --pretty
pnpm --silent n2 project archive --project <id> --pretty
pnpm --silent n2 project restore --project <id> --pretty
pnpm --silent n2 project list --all --pretty
```

These lifecycle commands require an explicit `--project`; they never fall back to `N2_PROJECT_ID`
or the starter Project. Each is idempotent and reports `updated` or `unchanged`. Rename changes only
the display name, never the ID or reference key. `project list` omits Archived Projects unless
`--all` is given, and every summary reports `archivedAt` (`null` when unarchived) and a
`lifecycleRevision` that rises with each committed rename, archive, or restore. An Archived
Project still answers `project show`, `node explain`, and `execution show`, but rejects every change
with `project_archived` until restored, and its Tasks report a `project_archived` claim blocker.
Archiving is refused with `project_has_active_attempt` while any Execution Attempt is active or
stop-requested.

## Discovering commands

The command schema is generated from the runtime validator rather than copied into CLI help:

```bash
pnpm --silent n2 command schema --pretty
```

That schema covers node creation, node updates, atomic multi-node movement, node deletion,
relationship creation, and relationship deletion. Node updates and deletions require the
`expectedVersion` returned by the project query so concurrent edits fail visibly instead of being
silently overwritten. Every mutation requires a caller-generated UUID as its `commandId`.
Creation commands also require a UUID that has never previously identified that kind of entity.
Deletion does not release node or relationship identity for reuse.

N² records the command ID, its intent fingerprint (the canonical command document, which Project
Activity reads back; ADR 0014), the declared Actor, and its outcome in the same SQLite transaction as
the mutation. Retrying the same document replays that outcome without applying the
mutation again; reusing a command ID for different intent returns a conflict. This protects creates,
updates, and deletes—including delayed retries after an ambiguous timeout—with one invariant.

## Running a command

`command run` reads a JSON document from stdin by default:

```bash
printf '%s\n' '{
  "kind": "update_node",
  "commandId": "4a31ed94-8778-4f01-9b58-1203d55c8f00",
  "nodeId": "agent",
  "expectedVersion": 0,
  "patch": { "requestedStatus": "in_progress" }
}' | pnpm --silent n2 command run --pretty
```

For larger commands use `--file`; `--data` is available for small single-line calls. Successful
queries and commands write only JSON to stdout. Validation and service errors are structured JSON
on stderr and return a non-zero exit code. A successful mutation returns its `commandId`, an
`applied` or `replayed` disposition, the projected project, and an operation-specific `outcome`
containing the affected IDs.

Creating a canvas item currently requires an explicit permanently unique UUID and canvas position.
Task and Group inputs use `description`; Note inputs use `content`. Only Tasks and Groups accept
`requestedStatus` updates or relationship endpoints. That distinction is structural in the command
contract rather than a convention adapters must remember. Deterministic identity and placement
keep the primitive honest; a later semantic placement command can be added above it without
changing it. The advertised schema accepts only this canonical shape. The HTTP adapter alone
decodes the old Note `description` create and update shapes (and the former implicit Task kind) so
delayed durable retries from older installations can still replay. Canvas-item reservations retain
their kind after deletion, keeping Note aliases compatible without collapsing Work Node
`description` and invalid `content` intent.

## Explaining projected state

```bash
pnpm --silent n2 node explain agent --pretty
```

A work-node explanation names the basis of effective status and progress, active blockers,
membership context, dependencies, and dependents. Notes have no derived work state to explain;
their title and Markdown content are available in `project show`. Asking for an explanation never
changes the SQLite record.

## Next adapter

MCP is the natural next adapter after the command language has been dogfooded. It should expose
small discoverable tools over the existing project query, command, and node-explanation operations;
it should not bypass the application layer or make agents drive React Flow through browser events.
