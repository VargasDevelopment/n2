# Contributing

N2 is a personal tool shared as-is. Issues and pull requests are welcome, but there is no promise
of a response, a review or a merge. Changes that fit the author's own use are the most likely to
be accepted. For anything large, open an issue first.

By contributing, you agree that your contribution is licensed under the MIT license in [LICENSE](LICENSE).

## Setup

Follow [From source](docs/install.md#from-source) in the install guide.

## Rules

- **`pnpm check` must pass.** It runs formatting, zero-warning lint, typechecking, tests, the
  code-health checks and the builds. CI runs the same gate on every pull request.
- **Read [CONTEXT.md](CONTEXT.md) before changing graph behavior or vocabulary.** Use its terms. If
  a term or relationship changes, update `CONTEXT.md` in the same change.
- **Domain relationships use named endpoint roles** (for example `memberId`/`groupId`,
  `dependentId`/`dependencyId`). Do not use `source`/`target` outside the React Flow rendering
  adapter and the SQLite storage adapter.
- Record significant design decisions as a short ADR in [docs/adr](docs/adr/).
- Add focused tests for behavior you change.

## Code-health checks

`pnpm check` includes a code-health ratchet. It accepts existing, fingerprinted debt while
rejecting new suppressions, unsafe casts, disabled tests, broken local documentation links,
unsanctioned process exits, growth in oversized files, and function-complexity regressions.
The dependency policy checks importer, override, and catalog specifiers in `pnpm-lock.yaml`, pnpm's resolved source of truth. Frozen installs
keep it in sync with the manifests. Specifiers must use bounded semver ranges or allowed workspace,
catalog, local-path, or remote-URL protocols; npm aliases follow the same rule recursively. Override
removals (`-`) are allowed, and pnpm resolves `$foo` references before writing the lockfile. Floating
versions, dist-tags, and malformed ranges fail; baseline updates cannot waive this check.
Only lockfile version 9.x is supported. Package extensions and pnpmfile hooks are rejected because
the lockfile retains only their checksum; the policy must learn to validate the ranges they introduce
before either can be added.
The policy enforces only that ranges are bounded. By convention, and not enforced, keep 0.x
dependencies within their current minor (`~0.y.z`) and pin formatter, compiler, and build tools exactly
when patch releases can change output. Peer ranges are not checked: they declare compatibility rather
than select installs, and no workspace package publishes peers.

Function complexity uses the installed ESLint core rule's **modified** variant with a ceiling of 20.
A switch counts once; branches inside cases, defaults, logical operators and optional chaining still
count. Functions, callbacks, class-field initializers and static blocks are measured independently
across production, tests and tooling, with the same file discovery and generated-directory exclusions
as the other policies. ESLint's global `complexity` rule stays off; there is no warning phase.

Baseline version 2 stores only functions scoring above 20, each with its own numeric ceiling. Small
functions can grow up to 20. Existing debt can improve but cannot exceed its recorded score; there is
no aggregate complexity budget. IDs use the file path and lexical owner/binding chain, with call roles
and argument indices for anonymous callbacks. They contain no line numbers or body hashes, so line
shifts and ordinary body edits preserve identity. Renames and moves of indebted functions require
explicit baseline review. Ambiguous IDs involving debt fail even if the other function is small:
name the callbacks or owners distinctly before checking or updating.

After shrinking oversized files or simplifying complex functions, regenerate the baseline to lower
their ceilings and drop removed debt. Normal checks never rewrite it. For a deliberate increase,
first consider simplifying the function; otherwise use the same explicit update, review the resulting
diff, and explain the justification in the change:

```bash
pnpm code-health:update
pnpm test:code-health
pnpm code-health
```

## README screenshots

The images in [docs/images](docs/images/) are generated. After a visible interface change, run:

```bash
pnpm exec playwright install chromium   # once
pnpm screenshots
```

It builds the web interface and server, starts the self-host server on a new library in a
temporary directory and on a free port, adds a demo Project through the same commands the CLI
uses, and captures each shot with Playwright. Then it stops the server and deletes the library. It
never touches your own library. The demo Project and the list of shots are in
[scripts/screenshots](scripts/screenshots/). Pass `--skip-build` to reuse the current build.
