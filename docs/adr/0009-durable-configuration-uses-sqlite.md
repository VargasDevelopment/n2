---
status: accepted
---

# Durable configuration uses SQLite outside Project Commands

N² stores durable Application Preferences and Project Settings in its authoritative local SQLite
persistence layer and exposes them through a typed configuration surface shared by the UI, CLI, and
agents. Application Preferences provide defaults; designated Project Settings may explicitly
override them, and removing an override restores inheritance. Configuration does not enter the
Project work graph or its Project Command stream, while ephemeral Canvas View State remains outside
durable configuration entirely.

## Consequences

SQLite was chosen over browser storage or JSON because N² already depends on it and needs validated,
migratable, transactional configuration that every adapter can access consistently. This does not
claim SQLite is the universal convention for desktop preferences; JSON remains preferable when
direct text editing or version-control workflows are product requirements, which they are not here.

Settings changes apply and persist immediately. The Settings interface must expose scope and
inheritance explicitly, including a `Use application default` state that clears a Project override
instead of copying the current default. Project export and whole-library backup must preserve the
configuration within their respective boundaries, and backups of an open SQLite database must use
a safe SQLite-aware mechanism rather than copying only its main file.

Typed configuration reads return each effective value together with its source and any stored
Project override. Project creation may include validated initial Project Setting Overrides in the
same atomic operation, so callers never observe a partially configured new Project. Configuration
contracts expose named, validated settings rather than an arbitrary key/value store.
