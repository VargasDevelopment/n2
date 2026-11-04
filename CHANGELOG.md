# Changelog

## 0.1.0

First public release. N2 is a personal tool shared as-is; see the README for what that means.

### Planning

- A local library of Projects. Each Project is a separate graph with its own layout. Projects can
  be created, renamed, archived and restored.
- Tasks, Groups and Notes on a freeform canvas. Each item gets a stable reference such as `N2-3`.
- Membership: a Task or Group can be part of several Groups, with no cycles. Group regions show
  membership on the canvas.
- Dependencies between Tasks and Groups. Status and progress are derived from membership and
  dependencies. `node explain` reports why an item is blocked.
- Completing work keeps it in the graph.
- Canvas filters and folded long Notes.
- Kanban, Roadmap and Swimlane views. They rearrange the graph for reading without changing the
  saved layout. The Roadmap uses explicit planning dates and Milestones.

### Agents

- A JSON command-line tool that uses the same typed commands as the web interface, with a
  published JSON Schema (`n2 command schema`).
- Task-level agent eligibility and Execution Attempts, so an agent can claim a Task, report
  progress and be asked to stop.
- Project and library activity, built from command receipts. Each change records who made it, and
  a seen marker shows what is new.

### Settings

- Application preferences and per-Project setting overrides, stored in SQLite.
- Built-in themes, set for the whole app or pinned to one Project.

### Running it

- SQLite storage with forward-only schema migrations on startup.
- An online backup command that writes a verified snapshot with a checksummed manifest.
- A container image and `compose.yaml` for running N2 on your own machine. On first start
  it creates a new library.
- An open tab offers a reload after the server is upgraded.
