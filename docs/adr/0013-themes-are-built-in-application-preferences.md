---
status: accepted
---

# Themes are built-in Application Preferences

A Theme is an Application Preference stored in SQLite with the other durable configuration (ADR
0009). It applies to the whole installation and follows the user to every device. N² ships a closed
set of built-in Themes; there is no user-authored Theme. ADR 0019 later let a Project override it.

## Consequences

The server is the authority. The browser keeps a small localStorage hint of the last Theme it
painted, which an inline script in `index.html` applies before styles load, so a known device opens
without a flash of the default. The hint is only a cache: the app rewrites it from the preference on
every load. A browser that has never loaded N² paints the default once before the preference
arrives; server-side injection of the Theme into the HTML can remove that later if it matters.

Per-Project Themes were deferred here because a Theme is about the person and the room they work
in, not the work, and a per-Project value makes the same app change color while moving between
Projects. ADR 0019 accepts that trade for Projects that ask for it.

The System choice is stored as `system`. Each browser resolves it from
`prefers-color-scheme`: OS light uses Paper, OS dark uses Midnight, and changes apply live. The
server returns the stored choice rather than resolving it from the server's environment. System
has no separate token block. Its paint hint caches the choice, and the inline script resolves the
current OS appearance before styles load, even after an OS change while N² was closed. ADR 0019
moved the Theme backgrounds for browser chrome into a static map in that script.

Schema 17 widens the SQLite preference constraint transactionally without changing stored values
or timestamps. This is forward-only: older images reject a schema-17 library, even when its stored
Theme is a previously supported value. Health, open, backup, and deploy guards all use the latest
version derived from the migration registry; recovery uses a compatible pre-deploy snapshot.

The set is closed and validated end to end, including a SQLite CHECK constraint, so adding a Theme
needs a contract change and a migration. Older clients with strict schemas reject a Theme value they
do not know; the web app ships with the server, but a lagging CLI can fail on `settings` reads until
it is updated.

Each concrete Theme overrides only the `tokens.semantic` layer, in `apps/web/src/themes.css`, and restates
every color and gradient role; derived roles and components follow without changes. Code-health
enforces that boundary, and `themes.test.ts` enforces role completeness and contrast floors. Status
must stay readable by glyph shape alone, which is what makes a pure monochrome Theme possible.
