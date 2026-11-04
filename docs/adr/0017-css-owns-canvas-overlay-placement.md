---
status: accepted
---

# CSS owns canvas overlay placement

Canvas selection retains the chosen Inspector placement. Opening Project Activity temporarily
renders the Inspector at the left or bottom without changing that selection; closing Activity
restores the chosen placement.

`CanvasOverlays.css` owns the panel geometry, responsive breakpoint, toolbar clearance, and free
canvas region. It applies the effective placement to both the Inspector and the region used by
notifications and canvas focus requests. Component stylesheets own appearance. The Activity session
owns opening, closing, and acknowledging activity, with no viewport subscription or layout policy.

The Inspector and the Activity sheet share one 380px width token. The breakpoint is 1112px: two
panel insets, the two 380px panels, two toast gaps, and the 300px minimum toast lane. CSS custom
properties cannot parameterize a media query, so its single literal lives beside the geometry tokens
and placement rules. Narrower canvases put the Inspector above the toolbar and end it before the
Activity sheet. At and above the breakpoint it moves left. The supported notification floor remains
640 × 480.

A side-placed Inspector is as tall as its content, up to the room between its top and its bottom
clearance. Where the toolbar spans the canvas (900px and narrower), that clearance is the toolbar's,
so the panel ends above the toolbar instead of under it. Placement choice in React reads the same
width (`INSPECTOR_WIDTH`), and a test keeps it equal to the CSS token.

A JavaScript media subscription was rejected because it duplicated stylesheet geometry and made
the Activity query/session layer decide presentation. Keeping the chosen placement in React and
the responsive override in CSS also lets resizing update the panel and its free region together.
