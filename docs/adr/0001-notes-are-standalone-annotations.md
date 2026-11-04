# Notes are standalone annotations

N² models a Canvas Item as either a Work Node or a Note. Tasks and Groups are Work Nodes with
status, progress, membership, and dependencies; Notes are durable free-form annotations with none
of those work semantics. This rejects the simpler single-node model because giving annotations
meaningless status and relationship machinery obscures both the UI and the domain, at the cost of
requiring an explicit canvas-item union throughout the system.
