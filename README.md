# docs-drift-checker

Flags places where JSDoc comments or README code samples have drifted out of
sync with the actual code — e.g. a function gained a new parameter but the
`@param` list wasn't updated, or a README demos a function that got renamed
or deleted.

**Zero npm dependencies.** Pure Node.js (regex/heuristic based, not a full
AST parser), so there's nothing to `npm install` — just run it.

## Quick start

```bash
node check-drift.js                  # scan current directory
node check-drift.js --dir=src        # scan a specific directory
node check-drift.js --strict         # also flag exported functions with zero JSDoc
node check-drift.js --json           # machine-readable output
node check-drift.js --format=github  # Markdown report (for PR/CI summaries)
```

Exit code is `1` if any drift is found, `0` otherwise — so it plugs straight
into CI as a gate.

## What it catches

| Type | Meaning |
|---|---|
| `param-mismatch` | A function's JSDoc `@param` list doesn't match its real parameters (added, removed, or renamed) |
| `missing-doc` | *(opt-in via `--strict`)* An exported function has no JSDoc at all |
| `stale-md-reference` | A function is demoed in a fenced code block in a Markdown file (and mentioned inline elsewhere as `` `fnName()` ``) but doesn't exist anywhere in the source anymore |

## Using it as a GitHub Action

1. Copy this whole folder into `.github/actions/docs-drift-checker/` in your repo.
2. Add a workflow (see `.github/workflows/docs-drift.yml` for a full example):

```yaml
- uses: ./.github/actions/docs-drift-checker
  with:
    dir: '.'
    strict: 'false'
    fail-on-drift: 'true'
```

It writes a Markdown table to the job's step summary automatically, so
results show up right in the GitHub Actions UI without extra setup — no
`GITHUB_TOKEN` or PR-comment permissions required.

## How the detection works (and its limits)

- Function/JSDoc extraction is regex-based, not a real parser. It handles
  the common shapes (`function foo(...)`, `export function foo(...)`,
  `const foo = (...) => {}`, `export const foo = async (...) => {}`) but
  won't catch every exotic syntax (decorators, complex generics, etc.).
- Param comparison is by **name**, not type — it won't catch a param whose
  type changed but name didn't (e.g. `id: string` → `id: number`).
- The Markdown check is deliberately conservative: it only flags a name if
  it's both demoed in a fenced code block *and* referenced inline as code
  elsewhere in the same file, to avoid flagging incidental variable names
  in example snippets.

Given those trade-offs, treat it as a fast, dependency-free first pass —
good for CI gating on obvious drift — not a substitute for a full
TypeScript-aware doc linter if your project needs more precision.

## Files

- `drift-engine.js` — the detection logic (importable, testable on its own)
- `check-drift.js` — CLI wrapper (arg parsing, report formatting, exit codes)
- `action.yml` — GitHub Action definition
- `test-fixtures/` — a small example repo with intentional drift, useful for
  trying the tool or as a regression check after editing `drift-engine.js`
