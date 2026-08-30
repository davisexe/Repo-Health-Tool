# dependency-health-dashboard

One glance at whether your `package.json` dependencies are outdated,
vulnerable, deprecated, or effectively abandoned.

**Zero npm dependencies.** Uses Node's built-in `fetch` (Node 18+) to talk to
the npm registry and [OSV.dev](https://osv.dev) — both free, public, no API
key needed. Nothing to install.

## Quick start

```bash
node check-deps.js                          # scan current directory, print a text report
node check-deps.js --html=report.html       # also write a standalone HTML dashboard
node check-deps.js --json                   # machine-readable output
node check-deps.js --format=github          # Markdown summary (for CI)
node check-deps.js --fail-on=none           # never fail the process, just report
```

Open the generated `report.html` in any browser — it's a single
self-contained file (data is inlined), so you can attach it to a CI artifact
or email it around. Click a status card to filter the table by that status;
type in the search box to filter by name.

## Status levels

Checked in this priority order (a package only gets one status — the worst
one that applies):

| Status | Meaning |
|---|---|
| `vulnerable` | Has a known vulnerability per [OSV.dev](https://osv.dev) for the installed/declared version |
| `deprecated` | The latest published version is marked deprecated on npm |
| `abandoned` | No publish in the last N months (default 18, `--abandoned-months` to change) |
| `outdated` | A newer version exists on npm than what you have installed/declared |
| `ok` | None of the above |

## `--fail-on`

Controls the exit code, for CI gating:

```
--fail-on=vulnerable   (default) fail only if something is actually vulnerable
--fail-on=deprecated   fail on deprecated or vulnerable
--fail-on=abandoned    fail on abandoned, deprecated, or vulnerable
--fail-on=outdated     fail on any non-ok status
--fail-on=none         always exit 0, just report
```

## Using it as a GitHub Action

1. Copy this whole folder into `.github/actions/dependency-health-dashboard/`.
2. Add a workflow (see `.github/workflows/dep-health.yml` for a full example
   — a good pattern is running it both on PRs that touch `package.json` and
   on a weekly schedule, since "abandoned" and "vulnerable" status can
   change without your code changing at all):

```yaml
- uses: ./.github/actions/dependency-health-dashboard
  with:
    fail-on: 'vulnerable'
```

The action uploads the HTML dashboard as a workflow artifact and writes a
Markdown summary to the job's step summary automatically.

## Notes / limitations

- Version comparison against `package-lock.json` only supports the npm
  lockfile format (`packages` key, npm v7+ lockfiles). If there's no
  lockfile, it falls back to a best-effort read of the declared semver
  range, which is less precise (e.g. `^1.2.0` is treated as `1.2.0`).
- "Abandoned" is a heuristic (time since last publish) — a genuinely stable,
  finished package (e.g. something that reached 1.0 and just doesn't need
  changes) will get flagged too. Treat it as "worth a second look," not
  "definitely dead."
- OSV.dev covers a huge range of advisories but isn't guaranteed complete;
  for anything security-critical, also run `npm audit` and check GitHub's
  Dependabot alerts.
- Built and syntax/logic-tested in a sandboxed environment without network
  access — the scoring logic (`health-engine.js`'s `scorePackage`) was unit
  tested directly, and the full pipeline was integration-tested against a
  mocked `fetch`, but the live registry/OSV calls themselves haven't been
  exercised against the real internet. Run it locally against a real
  project and let me know if anything about the actual API responses trips
  it up.

## Files

- `health-engine.js` — fetch + scoring logic (importable, testable on its own)
- `render-html.js` — the single-file HTML dashboard generator
- `check-deps.js` — CLI wrapper (arg parsing, report formatting, exit codes)
- `action.yml` — GitHub Action definition
