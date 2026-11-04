---
status: accepted
---

# Projects can pin a Theme

Theme becomes a designated Project Setting Override (ADR 0009). The Theme Application Preference
stays the default: the Project Library always uses it, and so does every Project without an
override. A Project that pins a Theme shows it everywhere inside that Project's workspace and
nowhere else. Removing the override restores inheritance; it never copies the current Application
Preference into the Project.

ADR 0013 deferred this because a per-Project value makes N² change color as the user moves between
Projects. We accept that cost because pinning is opt-in per Project, and a Project that looks
different is the point for the user who pins it.

## Consequences

A Project may pin any Theme choice, including System. Pinning System is not the same as inheriting
when the application Theme is a fixed Theme: it lets one Project follow the OS appearance while the
rest of N² stays put. Excluding it would need a second Theme set and a second CHECK constraint for
no gain.

Settings show the Theme in the Current Project scope with the same `Use application default`
choice as the other overrides. That choice previews the application Theme it follows, and the
field says in words whether the Project follows the application Theme or pins its own. The
Application Preferences scope, opened from a pinned Project, says that the open window keeps the
pinned Theme. Project creation does not offer a Theme; the API and CLI accept one with the other
initial settings.

Each view shows its last confirmed snapshot of its scope's settings: the application preferences
in the Library, and the Project's effective settings in a Project. Another device's change appears
on the next scope entry, focus, or reconnect, because the settings queries are never fresh for
long. A failed refresh keeps the last snapshot: a view blocks only while it has no data, and
otherwise shows the failure beside the data, as an inline note in Settings or a toast on the canvas
and Library. Every web view reads query state through `queryView`, and lint rejects `isError`,
which is also set when a refresh fails over kept data. Saves run one at a time from the UI. A save cancels
the reads of its scope that overlap it, stores its acknowledgment whole, and then invalidates the
scopes it affects, so no older read can undo it and every later read reflects it. Invalidated
queries a view is showing refetch at once; the others refresh when their scope is next entered. An
application save invalidates the application preferences and every cached Project's settings. A
Project save invalidates that Project, and the application preferences only when its answer shows
them out of date.

The browser's paint hint caches confirmed choices: the application Theme and the pins of Projects
this browser has opened. One pure function takes the current scope's snapshot, or the cached hint
while it loads or after it fails, and derives both the hint and the document Theme. The document
paints what the startup script paints from that hint at the current URL: this Project's pin, else
the application Theme. In a Project with a snapshot, that is its effective Theme. Another Project's
pin never applies. A table test covers every scope, snapshot state, and cached hint, and runs the
real startup script on each resulting hint.

Each Theme's background is fixed by the stylesheets, so the inline script in `index.html` carries a
static Theme-to-background map, which `themes.test.ts` checks against the CSS tokens. It reads the
Project from the URL, so reloading or opening a Project URL paints its pinned Theme and the matching
`<meta name="theme-color">` before styles load, for every Theme including both System appearances.
In-app navigation uses the same cached pin until the Project's settings arrive. A pin set on another
device can paint the application Theme once before the server's value replaces it, the same limit
ADR 0013 accepts for a first visit.

Schema 18 widens the `project_setting_overrides` CHECK constraints in one transaction, keeping
existing overrides and their timestamps. Like schema 17, this is forward-only: older images reject a
schema-18 library.
