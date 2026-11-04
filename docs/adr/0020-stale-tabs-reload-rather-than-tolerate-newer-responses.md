---
status: accepted
---

# Stale tabs reload rather than tolerate newer responses

The server and the web bundle always ship together in one image, so they disagree only when a tab
stays open across a deploy. Such a tab runs the old bundle, whose strict response schemas reject
fields the new server adds. Retrying cannot fix that; reloading does.

A deployed server names its build commit in the `n2-build-commit` header on every response its
API app answers (the owner gate's own 403 rejections do not carry it). The bundle is built with
the same `N2_BUILD_COMMIT`. The web client reads the header from every response before it parses
the body, so the response that fails to parse also reveals the newer build. The check rides on
traffic the tab already makes, including refetch on focus and Activity polling, and needs no new
polling. A build without a commit, on either side, never reports an update, so development is
quiet.

While an update is known, exactly one Reload is offered, in one place: a small banner above every
panel and modal, that cannot be dismissed while the tab runs old code. Failures elsewhere
keep their own messages and retries and never need to know about updates, so no failure can hide
the way out, and no retry site can forget it. Earlier designs added Reload to each retry site and
kept missing sites. Only a confirmation dialog, which needs an answer first, covers the banner.

N² never reloads by itself. The banner's Reload is a plain browser reload, exactly like F5: an edit
in progress that has not been saved yet can be lost, just as it can with F5 or closing the tab. An
unsaved New Project draft still gets the browser's leave-page prompt, as it does for F5. Protecting
all unsaved work, with one leave guard for F5, closing the tab and this Reload, is a separate
follow-up. Making only this Reload wait for pending writes was tried and dropped: edits typed during
the wait, writes outside the project command queue, and paused writes each escaped it.

The owner app serves `index.html` with `Cache-Control: no-cache` and the content-hashed
`/assets/*` as immutable, so a reload always fetches the new bundle.

Relaxing response schemas from `.strict()` to stripping unknown keys was rejected as the fix. It
would handle only additive changes. Renamed fields, new enum values and changed meanings would
still fail, or would be silently misread by code that cannot know what it is missing. Strict
parsing keeps every disagreement loud, and a reload resolves all of them. Request validation stays
strict regardless.
