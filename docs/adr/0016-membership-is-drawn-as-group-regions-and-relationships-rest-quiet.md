---
status: accepted
---

# Membership is drawn as Group regions, and relationships rest quiet

On a real Project most lines on the Freeform canvas were Member of, and together with every
Depends on line and label they formed a web in which nothing could be read. The Freeform view
therefore draws Member of as containment: each Group gets a Group region holding it and everything
that is part of it, so "this is part of that" reads from where the work sits instead of from a
line. Containment fits the overlapping Membership Graph (ADR 0002), because overlapping membership
becomes overlapping regions, and it keeps Freeform positions authoritative (ADR 0004): a region
follows the layout and never moves a card. Bundling or routing lines through channels was tried
and rejected; it reorganised the web without removing it, and routing cost hundreds of
milliseconds per change.

Relationships also rest quiet. At rest a canvas shows only what needs attention without asking:
blocking relationships are always drawn whole with their labels, because Blocked part and Blocked
by are states the person must not miss. Other labels, Part of lines where regions draw membership,
and the middle of long Depends on lines (drawn as stubs at each end) appear when the person hovers
or selects the work they belong to. Zoomed out, Relationship bundles stand in for the Depends on
relationships between Groups.

## Consequences

Relationships without a line at rest are managed from the Inspector, whose relationship rows can
remove them with Undo; hover and selection reveal them on the canvas. There is no "show all lines"
switch. Structured views keep Part of lines and draw no regions, because their columns, lanes and
rows already present structure; they share the quiet labels and stubs. Group regions, stubs and
bundles are presentation only and never change the Project.
