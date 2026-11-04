---
status: accepted
---

# Structured views preserve freeform layout

N² treats a Structured View as a non-mutating composition over one Project rather than as an
alternate graph, exclusive mode, or saved rearrangement. Canvas Filters first determine visibility;
an order-independent keyed set of enabled View Transformations then contributes semantic layout for
a resolver to combine. Changing this composition never issues Project Commands or writes derived
positions back to the authoritative Freeform View. This preserves spatial memory and allows filters
and compatible planning transformations to work together without letting a planning aid silently
destroy a hand-arranged canvas.

## Consequences

Project edits such as changing title, description, relationships, or Requested Status remain real
commands in every view and cause the active composition to be recomputed. A Structured View may give
a spatial gesture an explicit domain meaning—moving a Kanban card between status columns changes its
Requested Status—but arbitrary spatial dragging remains disabled and derived coordinates never leak
into any position-bearing Project Command. Structured View capabilities therefore cannot express an
authoritative position write, whether through `move_nodes`, `update_node.position`, or a future
command. View selection, active transformations, settings, pan, and zoom are presentation state
outside the project command log. Implementations represent active transformations as a composition,
not one `viewMode`, and transformation application order cannot decide layout conflicts. Every new
transformation defines its supported compositions with the transformations already shipped; the
resolver implements only those deliberate combinations rather than a universal merge engine. Canvas
Filters compose with every transformation. Kanban is first because Effective Status already supplies
its organizing dimension. Roadmap and Kanban are mutually exclusive because each defines the primary
organization and spatial interaction of work, as recorded in ADR 0005. Swimlane must later define
its compatibility with each transformation independently. A Structured View always has at least one
enabled transformation; disabling the last one returns to Freeform and restores its authoritative
geometry and movement capabilities.
