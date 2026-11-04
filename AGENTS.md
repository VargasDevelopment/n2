# Agent instructions

## Required gate

Run `pnpm check` before you finish a change or open a pull request. Formatting, zero-warning lint,
typechecking, tests, code-health checks and builds must all pass.

## Domain language

- Read `CONTEXT.md` before changing graph behavior or vocabulary, and use its terms.
- When a term, relationship or domain boundary changes, update `CONTEXT.md` in the same change.
- Domain relationships use named endpoint roles. Do not reintroduce ambiguous `source`/`target`
  fields outside the React Flow rendering adapter or the SQLite storage adapter.
