# View transformations

Status: model accepted; Kanban, Roadmap, and Group-membership Swimlanes implemented

## Purpose

N² has one Project graph and more than one useful way to read it. The Freeform View preserves the
user's authored spatial layout. Structured Views compose temporary transformations of that same
graph for planning questions without creating a second source of truth.

This boundary is intentionally strict: changing how work is presented must never masquerade as a
change to the work itself.

## Composition pipeline

View Composition has two explicit cases after filtering:

1. Start with the current projected Project graph.
2. Apply all active Canvas Filters to produce the visible graph.
3. If no View Transformation is enabled, produce the Freeform View from authoritative positions and
   Freeform interaction capabilities.
4. Otherwise, collect semantic contributions from a non-empty, order-independent keyed set of
   enabled View Transformations and resolve an explicitly supported combination into temporary
   positions, view furniture, relationship presentation, and Structured interaction capabilities.

Only the visible graph advances past step 2. A Structured resolver cannot consult the unfiltered
graph to reintroduce an item or relationship a filter removed. Disabling the final transformation
returns directly to Freeform; there is no identity transformation or derived-position fallback.

The first implementation boundary produces:

- one derived geometry for every Canvas Item in the visible graph;
- view furniture such as columns, lanes, or time markers;
- view-specific relationship visibility and routing instructions; and
- explicit interaction capabilities contributed by the active transformations.

The resolved result is ephemeral presentation state. It does not replace Canvas Items,
Relationships, stable IDs, domain status, or authoritative positions. User preferences may be
remembered separately, but transformations are deterministic for the same inputs and do not
dispatch Project Commands.

Canvas Filters and View Transformations are independently composable. A user can hide Done work
while using the Kanban Transformation. Enabled transformations are a keyed set, never one mutually
exclusive `viewMode` and never an order-sensitive reducer. Each transformation contributes semantic
constraints or decoration; the resolver handles only combinations with an explicit design. A new
transformation must define and test its composition with every relevant transformation already
shipped before that combination is offered in the interface.

A composition may suppress relationship drawing when its presentation would be misleading or
illegible, but it cannot reinterpret or remove the underlying relationship. A transformation that
suppresses an edge must either disable relationship interaction as a declared capability or provide
an alternate relationship surface; it cannot promise an edit that has no reachable surface. A
selected relationship clears when its edge is suppressed, unless an alternate surface continues to
present that selection.

Every transformation declares which Canvas Items it structures. The compositor gives visible but
unaffected items an explicit deterministic region; it never hides them or falls back to their
Freeform positions. Kanban therefore includes a Notes region beside its status columns. If two
future transformations make genuinely incompatible demands, the conflict must be explicit at the
composition boundary; neither transformation may silently win through application order. The
resolver does not attempt a generic merge.

Roadmap and Kanban are the first explicit incompatibility: each defines the primary organization
and spatial interaction of work. Selecting one while the other is active replaces it in a single
presentation-state transition. The resolver rejects a state containing both rather than choosing a
winner. This does not make all transformations mutually exclusive; a future Swimlane Transformation
may compose with either after each combination defines an orthogonal dimension and its own resolver.

The compatibility matrix is the operational source of truth for offered compositions:

| Pair                      | Support     | Selection behavior                                      |
| ------------------------- | ----------- | ------------------------------------------------------- |
| Canvas Filters + any view | Required    | Preserve the active view and apply filters first        |
| Kanban + Roadmap          | Unsupported | Replace the active transformation with the selected one |
| Kanban + Swimlane         | Supported   | Compose status columns with lane rows                   |
| Roadmap + Swimlane        | Supported   | Compose calendar placement with Scheduled Work lanes    |

Adding a transformation requires updating this matrix, its resolver coverage, and its acceptance
examples together. An undecided pair is unsupported until that work is complete.

## Interaction boundary

| Interaction                                      | Freeform View                           | Structured Views                                                |
| ------------------------------------------------ | --------------------------------------- | --------------------------------------------------------------- |
| Edit title, content, or status                   | Dispatch the existing Project Command   | Dispatch the same Project Command and recompute the view        |
| Edit relationships                               | Use visible edges and handles           | Capability requires edges, handles, or an alternate surface     |
| Drag without a view-specific meaning             | Persist its authoritative position      | Disabled                                                        |
| Perform a named spatial action                   | Not applicable                          | Dispatch its explicit domain command; never persist coordinates |
| Write an authoritative position                  | Available through Freeform capabilities | Not expressible by Structured View capabilities                 |
| Create at a pointer-derived position             | Allowed                                 | Disabled until the view defines an honest placement rule        |
| Add or remove a transformation                   | Presentation state only                 | Presentation state only                                         |
| Pan, zoom, select, inspect, filter, or highlight | Presentation state only                 | Presentation state only                                         |

Structured interactions may become richer later. Any drag or reorder must have a named meaning in
that view and an explicit owning state or domain command. Derived coordinates from a Structured View
must never enter any position-bearing Project Command. The typed capability supplied to a Structured
View excludes both bulk movement and position-bearing node patches, making this invariant structural
rather than dependent on individual event handlers.

## Required invariants

1. Entering and leaving a Structured View leaves every authoritative Canvas Item position exactly
   unchanged.
2. The same Canvas Item and Relationship IDs refer to the same domain entities in every view.
3. Domain edits made in a Structured View survive the return to Freeform View; derived placement
   does not.
4. A Structured composition supplies one derived geometry for every Canvas Item in the visible
   graph instead of silently falling back to an authoritative position.
5. Selection survives a view change when its entity remains visible and clears when filtering or
   projection removes that entity from the presentation.
6. Position persistence is a declared Freeform capability, not a conditional hidden inside a drag
   handler. Structured capabilities make every authoritative position write unrepresentable.
7. Adding a filter or transformation preserves every contribution in a combination declared
   compatible. An incompatible pair follows its explicit selection behavior; there is no globally
   exclusive view mode and no silent loss of a compatible contribution.
8. A Structured composition has a non-empty keyed, order-independent transformation set. Every
   offered combination has an explicit resolver and acceptance coverage; the empty set is Freeform.
9. An unsupported transformation combination is rejected by the resolver. The interface may replace
   one incompatible transformation with another explicitly, but never relies on resolver precedence.

## Delivery order

### 1. Kanban Transformation

Use Effective Status as the existing organizing dimension. The implementation should establish the
typed composition and presentation boundaries, visible transformation controls, deterministic
column placement, view-safe editing, composition with existing status filters, and exact restoration
of the Freeform layout. Notes remain visible in a dedicated Notes region because they have no status.

Moving a Work Node between status columns changes only its Requested Status through the existing
command boundary. The recomputed Effective Status always determines its rendered column. A blocked
Task dragged to Done may therefore remain in Blocked while showing Wants Done, and a Group may remain
in the column derived from its members. Drop affordances name the intent as “Set requested status to
…”; the UI explains a divergent result and never forces the requested column by persisting
coordinates or recreating projection rules.

### 2. Roadmap Transformation

Implement the accepted model in ADR 0005: a Work Node has either no Planning Placement, an inclusive
date-only Planning Window, or a zero-duration Milestone. Roadmap is the product concept; timeline is
only its visual mechanism and would be ambiguous beside future activity history. Give Unscheduled
Work and Notes explicit deterministic regions rather than hiding them or borrowing their Freeform
positions. Canvas Filters continue to compose with Roadmap. Roadmap and Kanban do not compose;
switching between them is explicit, and the resolver rejects a state containing both. The eventual
Swimlane design owns its later Roadmap compatibility decision.

Scheduled Work uses Roadmap-specific temporal appliances rather than ordinary fixed-width canvas
cards. A Planning Window's visible body begins at its start boundary and spans through its inclusive
end date; a Milestone uses a zero-duration marker. Titles, status, and date labels are captions whose
space does not imply additional calendar duration. Unscheduled Work retains the ordinary Work Node
card because it has no temporal geometry to encode.

The Roadmap Range is the calendar interval shown by the transformation. Automatic range fits the
currently filtered scheduled work with modest calendar padding. Editing either endpoint creates an
explicit range; previous and next controls scrub by that range's complete inclusive span. The
explicit range acts as an additional Roadmap-only Canvas Filter for scheduled work while always
retaining Unscheduled Work and Notes. Planning Windows that overlap a boundary remain visible with
their temporal body clipped and their full Planning Placement named in the caption. Restoring Auto
range recomputes from the other visible inputs. None of these actions issues a Project Command or
rewrites Planning Placement.

### 3. Swimlane Transformation

Implement ADR 0006. The first dimension is Group membership, not a new Work Stream or Assignee
model. A selected Lane Scope contributes its direct member Groups as ordered Group Lanes. Membership
reachability counts: nested work belongs to every lane Group it can reach through the Membership
Graph. Work with several assignments has one primary interactive card and read-only Lane References
in the remaining lanes. The Scope, Outside Scope, and Notes regions keep every visible Canvas Item
accounted for without duplicating a Work Node or falling back to Freeform coordinates.

Swimlane alone arranges Work Nodes within horizontal Group Lanes. Kanban + Swimlane forms a status
column by lane-row grid; status-column drops retain their existing Requested Status meaning.
Roadmap + Swimlane groups Scheduled Work calendar appliances into lane rows while Unscheduled Work
and Notes retain their explicit Roadmap regions. Lane Scope selection and every derived lane,
reference, and position are presentation state. A later Work Stream or Assignee dimension must earn
its own domain model and assignment semantics rather than treating Groups as aliases.
When filters leave no Group visible, Swimlane remains active with a filter-local Visible Work lane
and Notes lane; it neither throws nor reaches behind the filtered graph for a hidden Lane Scope.

## Acceptance examples

- A user drags a task to a memorable location in Freeform, enters Kanban, changes its Requested
  Status, and returns. The task has the new request at the original freeform coordinates.
- Hiding Done work removes it before Kanban columns are laid out; revealing Done recomputes the
  presentation without moving the authoritative nodes.
- A dependency-blocked Task dragged to Done records Wants Done, remains in the Blocked column, and
  exposes the existing status explanation; removing the blocker then moves it according to the
  recomputed Effective Status.
- Kanban places Notes in its Notes region even when every Work Node status is filtered out.
- A blocked dependency remains the same Depends On relationship in every composition even if a
  transformation hides or reroutes its edge.
- Adding and removing transformations repeatedly emits no project mutation and produces no
  position-version conflicts.
- Selecting Roadmap while Kanban is active replaces Kanban without issuing a Project Command; an
  attempted resolver call containing both transformations is rejected.
- A same-day Planning Window survives command, persistence, and projection round trips as a window;
  it is not converted into a Milestone merely because its start and end dates match.
- The dominant visible body of a Roadmap Planning Window begins and ends at its calendar boundaries;
  a long title may extend outside that body without changing the represented dates.
- Setting or scrubbing an explicit Roadmap Range retains overlapping scheduled work, Unscheduled
  Work, and Notes; it prunes relationships with hidden endpoints and composes after status and title
  filters. Returning to Auto fits whatever scheduled work those filters leave visible.
- A Planning Window that crosses an explicit Roadmap Range boundary is visibly clipped at that
  boundary while its caption continues to name the complete authored Planning Placement.
- Selecting a Lane Scope creates one lane for each direct member Group and assigns nested Work Nodes
  by membership reachability; a Work Node reachable through two lane Groups has one interactive card
  and a Lane Reference in the other lane.
- Kanban + Swimlane retains status-column drop behavior within lane rows. Roadmap + Swimlane retains
  exact temporal geometry within Scheduled Work lane rows. Neither composition writes Freeform
  positions or membership.
- Hiding a lane-defining Group through a Canvas Filter removes that lane before Swimlane resolution;
  the transformation never consults the unfiltered Project graph to reconstruct it.
- Filtering out every Group leaves standalone Swimlane, Kanban + Swimlane, and Roadmap + Swimlane
  valid through a filter-local Visible Work lane rather than breaking or disabling the active view.
- Disabling the final transformation returns directly to filtered Freeform with authoritative
  positions and movement restored.
