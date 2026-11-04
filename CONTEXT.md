# N² Workspace

N² is a personal visual workspace for organizing work as relationships between nodes. Its language
distinguishes hierarchy from prerequisites so status can be derived without obscuring why.

## Language

**Public personal software**:
Openly licensed software maintained primarily around its owner's needs, without support,
compatibility, or roadmap commitments to outside users. Outside use and contributions are welcome
but do not make N² a community-governed product.
_Avoid_: Community project, supported product, source-visible software

**Canvas item**:
Anything placed on a project's canvas. A canvas item is either a work node or a note.
_Avoid_: Node when the distinction from work node matters

**Work node**:
A task or group that participates in work relationships and has requested and effective status.
_Avoid_: Canvas item when referring specifically to planned work

**Task**:
A leaf work node whose progress follows its requested status.

**Project**:
A durable planning boundary that owns one isolated graph and its authoritative freeform layout.
Canvas Items and relationships never cross Project boundaries. A local N² installation may contain
multiple Projects.
_Avoid_: Workspace when referring to one project

**Project name**:
The human-facing display label of a Project. It may be renamed at any time without changing the
Project's identity, Project Reference Key, or Canvas Item References.
_Avoid_: Project reference key, project ID

**Project library**:
The local collection through which a person creates, opens, and switches between Projects. Opening
a Project establishes the active boundary for canvas state and Project Commands. The Library lists
unarchived Projects by default and keeps Archived Projects in a separate section.
_Avoid_: Canvas, project

**Archived project**:
A Project deliberately put away from the Project Library's default list. Its graph, layout,
references, settings, command receipts, and Execution Attempt history are retained unchanged but
accept no further changes until the Project is restored. Archiving is explicit and reversible;
completing work never archives a Project.
_Avoid_: Deleted project, completed project, closed project, Archived work

**Project restore**:
The explicit return of an Archived Project to the Project Library's default list, after which it
accepts changes again exactly as before it was archived.
_Avoid_: Undelete, reopen

**Application preference**:
A durable personal choice that affects the behavior or presentation of the local N² installation
across Projects. Application Preferences are outside every Project graph and its command stream.
The human-facing Application Settings surface edits these preferences.
_Avoid_: Project setting, canvas view state

**Project setting**:
A durable configuration choice scoped to one Project but outside that Project's work graph and
Project Command stream. Project Settings may be presented alongside Application Settings when their
different scopes remain explicit.
_Avoid_: Application preference, project command

**Project setting override**:
An explicit Project-scoped value for a designated setting that would otherwise inherit its
Application Preference. Removing the override restores inheritance rather than copying the current
Application Preference into the Project.
_Avoid_: Project default, duplicated preference

**Effective setting**:
The value applied within a Project after resolving a designated Project Setting Override against
its Application Preference. An explicit Project override wins; otherwise the current Application
Preference applies.
_Avoid_: Stored setting when referring only to the resolved value

**Handle orientation**:
The Effective Setting that places semantic relationship handles on Work Nodes outside Roadmap.
Horizontal places the relationship subject on the left and object on the right; Vertical places the
subject on the top and object on the bottom; Roadmap always presents relationships left to right.
_Avoid_: Handle position, React Flow position

**Theme**:
A named, built-in visual presentation of N². The Theme Application Preference applies to the Project
Library and to every Project that does not override it; a Project Setting Override pins a Theme to
that one Project. A Theme changes appearance only; status, kind, and relationship distinctions stay
readable in every Theme. The System choice follows the operating system in either scope: Paper in
light appearance and Midnight in dark appearance.
_Avoid_: Skin, color scheme

**Canvas view state**:
The ephemeral state of the current lens over a Project, including its active View Composition,
filters, viewport, selection, and which Notes are expanded. It may change without changing
Application Preferences, Project Settings, or the Project graph.
_Avoid_: Application preference, project setting, project data

**Project reference key**:
The short, stable uppercase key that namespaces a Project's Canvas Item References. It is unique
within a Project Library and does not change after the Project has issued references.
_Avoid_: Project ID, mutable abbreviation

**Canvas item reference**:
An immutable, human-readable identity such as `N2-42`, allocated monotonically within one Project.
It survives title changes and is never reused after deletion. The UUID remains the canonical
internal identity for Project Commands; imported external identifiers are aliases, not N² identity.
_Avoid_: Node reference, short ID, title

**Group**:
A non-exclusive scope of work whose progress and status are derived from its direct members. A work
node may participate in more than one group.
_Avoid_: Container, owner

**Note**:
A standalone canvas annotation for durable free-form context. A note has no work status, progress,
membership, or dependency relationships.
_Avoid_: Work node, task description

**Folded note**:
The Freeform view's presentation of a long Note at a bounded size, showing the start of its content
and a cue that it continues. Only its own Expand or Fold control, clicked or pressed with Space,
toggles it; any other press on the Note acts as on any card. Expanding shows the whole Note on the
canvas until it is folded again or the Project is closed; Notes short enough to fit are never
folded. Folding is Canvas view state and never changes the Note, and the Inspector always shows the
full content.
_Avoid_: Collapsed note, truncated note, hidden content

**Member of**:
A non-exclusive directional relationship read “this member participates in that group.” Its
subject is the member and its object is the group; a member may have multiple such relationships.
_Avoid_: Contains, owned by, parent edge, hierarchy edge

**Membership graph**:
The acyclic graph formed by Member of relationships. It permits a work node to participate in
multiple groups without duplicating that work.
_Avoid_: Tree, hierarchy

**Group region**:
The Freeform view's presentation of Member of: one shaded area holding a Group and every canvas
item that is part of it, directly or through member Groups. It follows the authoritative layout and
never holds an item that is not part of its Group; overlapping membership shows as overlapping
regions.
_Avoid_: Territory, cluster, container, Notes region or other Structured view regions

**Collapsed group**:
A reversible canvas presentation of a group without its member topology. The underlying work and
relationships remain unchanged.
_Avoid_: Archived group, deleted group

**Archived work**:
Work retained in project history but excluded from active planning by default. It is distinct from
an Archived Project, which puts away an entire Project rather than work inside one.
_Avoid_: Done work, deleted work, collapsed work, Archived project

**Canvas filter**:
A non-mutating criterion that controls which canvas items appear in a canvas view without changing
the project graph or authoritative layout.
_Avoid_: Delete, archive

**Canvas view**:
A presentation of a project's graph on the canvas. A canvas view may use the authoritative freeform
layout or a layout derived for a particular planning purpose.
_Avoid_: Project, graph

**Freeform view**:
The default canvas view in which canvas-item positions are authoritative and directly editable.
_Avoid_: Base view, normal view

**Structured view**:
A non-mutating canvas view that derives temporary layout and presentation from one or more View
Transformations.
_Avoid_: Saved layout, alternate graph

**View transformation**:
Composable rules that contribute temporary structure or presentation to a Canvas View without
issuing Project Commands or changing authoritative freeform positions.
_Avoid_: Graph mutation, layout migration

**View composition**:
A configuration that produces one Canvas View. A Freeform composition applies Canvas Filters to the
authoritative layout; a Structured composition adds a non-empty, order-independent set of enabled
View Transformations.
_Avoid_: View mode when it implies that transformations are mutually exclusive

**Kanban transformation**:
A View Transformation that arranges visible Work Nodes by Effective Status.
_Avoid_: Board when referring to the N² view

**Planning date**:
A calendar day without a time of day or time zone.
_Avoid_: Timestamp, date-time

**Planning placement**:
An optional, discriminated statement of when a Work Node is intended to occur, expressed as either
a Planning Window or a Milestone. A same-day Planning Window remains distinct from a Milestone. A
Work Node without a Planning Placement is Unscheduled Work; Notes never have one.
_Avoid_: Due date, deadline

**Planning window**:
An inclusive period from one Planning Date through another during which a Work Node is intended to
occur. Its last day is a planned end, not a Due Date.
_Avoid_: Duration, due date

**Milestone**:
A zero-duration checkpoint planned for one Planning Date, such as an intended delivery or review.
It is a Planning Placement for a Work Node, not a kind of Canvas Item, and not a Due Date.
_Avoid_: Task kind, deadline, Planning Point

**Due date**:
The last Planning Date by which a Work Node is required to be complete, independent of when its work
is planned. N2 does not represent Due Dates yet; never infer one from a Milestone or a Planning
Window's end.
_Avoid_: Deadline as a second concept (it is a synonym), Milestone

**Unscheduled work**:
A Work Node without a Planning Placement.
_Avoid_: Backlog when no backlog semantics are intended

**Roadmap transformation**:
A View Transformation that presents explicitly placed Work Nodes across calendar time while
retaining separate regions for Unscheduled Work and Notes.
_Avoid_: Timeline transformation, Timeline view

**Roadmap range**:
The calendar interval currently shown by the Roadmap Transformation. Its automatic form fits
visible scheduled work; an explicit range can be edited or scrubbed backward and forward. It is
presentation and filter state only and never changes a Work Node's Planning Placement.
_Avoid_: Planning Window, date filter

**Swimlane transformation**:
A View Transformation that arranges visible work into lanes by a chosen planning dimension.
_Avoid_: Assignee view when the lane dimension is not specifically assignee

**Lane scope**:
The Group whose direct member Groups define the lanes in a Group-membership Swimlane composition.
_Avoid_: Work stream, parent Group

**Group lane**:
A presentation partition representing one direct member Group of the Lane Scope. Descendant work
may participate through any membership path, including more than one Group Lane.
_Avoid_: Work stream, container

**Lane reference**:
A read-only presentation of a Work Node in an additional Group Lane when overlapping membership
places that work in more than one lane. It refers to the same Work Node rather than duplicating it.
_Avoid_: Duplicate task, clone

**Visible Work lane**:
A filter-local Swimlane fallback that accounts for Work Nodes when no Group remains visible to act
as Lane Scope. It is presentation state and does not imply or create membership.
_Avoid_: Outside Scope lane, implicit Group

**Relationship subject**:
The work node from which a directional relationship is read.

**Relationship object**:
The work node that completes a directional relationship.

**Depends on**:
A directional relationship read “this dependent requires that dependency.” Its subject is the
dependent and its object is the dependency.
_Avoid_: Prerequisite edge, blocks edge

**Dependent**:
The work node that requires another work node through a Depends on relationship.

**Dependency**:
The work node required by a dependent. A blocked dependency actively blocks its dependent.
_Avoid_: Dependent, prerequisite when referring to the relationship

**Relationship bundle**:
A zoomed-out Freeform presentation that stands for two or more Depends on relationships running
from one direct Group's work to another's, shown with their count. Work in no Group counts as its
own; blocking relationships are never bundled.
_Avoid_: Aggregate, ribbon, trunk

**Requested status**:
The status explicitly chosen for a work node.
_Avoid_: Manual status

**Effective status**:
The status N² derives for a work node after membership and dependency relationships are applied.
_Avoid_: Current status, actual status

**Work node explanation**:
A read-only account of a work node's projected state, the basis for its status and progress, and
its named relationship context.
_Avoid_: Debug trace, agent context

**Project command**:
One explicit mutation of a project. Every project command has a caller-generated command ID and is
shared by human and agent adapters.
_Avoid_: API action, CLI command when referring to the domain operation

**Command receipt**:
The durable record of a project command's ID, intent fingerprint, Actor, place in its Project's
order, and outcome. It is committed atomically with the mutation so an identical retry replays
instead of reapplying, and it is the record Project activity is read from.
_Avoid_: Request log, audit log

**Actor**:
Who issued a project command: the Person, or a named Agent, as declared by the adapter that sent
it. A command whose Actor was never recorded is Unattributed; N² does not guess.
_Avoid_: Owner (the holder of an Execution attempt), user, author, source

**Project activity**:
What changed in one Project, newest first, read from its command receipts. Reading it changes
nothing. Layout moves and Attempt heartbeats are not activity.
_Avoid_: Audit log, history, timeline, changelog, notifications

**Library activity**:
Project activity from every unarchived Project in the Project library, read in one feed, newest
first. It shows where things changed and who changed them; each Project's own activity stays the
detail. Archived Projects are left out until restored.
_Avoid_: Global activity, inbox, notifications, all activity

**Activity run**:
Consecutive Project activity by one Actor with no pause longer than 20 minutes. A run never spans
the Seen marker, so activity is new or seen a whole run at a time.
_Avoid_: Session, batch, changeset

**Activity entry**:
The net change to one Canvas item within one Activity run: how the item differs at the end of the
run from how it was at the start. Changes that end where they started are left out, and an item
created and deleted within the run has no entry.
_Avoid_: Event, update, notification

**Seen marker**:
The latest command receipt in a Project that the Person has looked at, and when. It only moves
forward. An Activity run after it is new, unless it is the Person's own: their own changes are never
new to them, however recent. Looking through Library activity moves each Project's own marker.
_Avoid_: Read receipt, unread count, last visit, watermark

**Command effect**:
A consequence of applying one project command beyond its outcome, judged against the exact project
state that command was applied to. A replayed command applies nothing, so it reports no command
effects.
_Avoid_: Side effect, notification

**Group completion**:
The command effect of a Group's effective status becoming done because a project command was
applied. Changes made by other commands are never this command's Group completions, even when one
response shows them together.
_Avoid_: Celebration; completed group when the Group was already done

**Agent execution eligibility**:
An explicit, Task-level authorization for an agent to execute the Task content that was current
when enabled. Eligibility is never inherited from a Group or implied by planning status.
_Avoid_: Ready status, Group permission, dispatch status

**Execution fingerprint**:
A stable identity for the execution-relevant content of a Task: its title, description, and Depends
on relationships in both named endpoint roles. The description is where instructions, acceptance
criteria, and scope currently live. Planning placement, status, membership, layout, standalone
Notes, and Attempt progress are not execution content.
_Avoid_: Canvas Item version, command fingerprint

**Enablement**:
One explicit authorization of a Task's current Execution Fingerprint. Re-enabling creates a new
Enablement even when the execution content is unchanged.
_Avoid_: Group setting, inherited permission

**Execution attempt**:
One worker's durable, exclusive claim on an eligible Task, including the frozen instructions it
claimed and its execution lifecycle.
_Avoid_: Requested status, command receipt

**Stop request**:
A durable instruction for the owner of an active Execution Attempt to stop at a safe boundary. It
is not confirmation that execution has stopped.
_Avoid_: Stopped, cancelled

**Entity ID reservation**:
The permanent claim of a canvas-item or relationship ID. Deleting an entity removes it from the
project but never makes its ID available to a later entity of the same kind. Canvas-item
reservations retain the item's kind and Canvas item reference, so command intent remains
interpretable and the item can still be named after deletion.
_Avoid_: Live entity, command receipt

**Blocked part**:
A member whose effective status is blocked and therefore blocks its group.

**Blocked by**:
The active state of a Depends on relationship when the dependency is blocked and therefore blocks
the dependent.
