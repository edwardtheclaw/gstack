# Wave 1 — Task Notes

**Executed:** 2026-03-26
**Status:** COMPLETE
**Items:** PE-09, PE-12, PE-13, PE-14, PE-16, PE-17 (all "Very Low" / "Trivial" effort)

---

## PE-12: `/ship --dry-run`

**Status:** Done
**Commit:** `14870ed` (grouped with PE-13, PE-14)
**File changed:** `ship/SKILL.md`

Added a `--dry-run` section immediately after the intro. When `--dry-run` is passed, the skill runs Steps 1–5 (pre-flight, merge, tests, evals, review, version bump, CHANGELOG) then stops before any commit/push, printing a readiness summary with branch, merge status, test results, review findings, proposed version, and CHANGELOG preview.

---

## PE-13: `/review --focus`

**Status:** Done
**Commit:** `14870ed` (grouped with PE-12, PE-14)
**File changed:** `review/SKILL.md`

Added a `--focus` section before Step 1. Supports: `security`, `sql`, `perf`, `frontend`, `llm`, `tests`. Out-of-scope sections are marked `(skipped — not in focus scope)`. Output header includes the focus area.

---

## PE-14: `/retro --person`

**Status:** Done
**Commit:** `14870ed` (grouped with PE-12, PE-13)
**File changed:** `retro/SKILL.md`

Added `--person <name>` argument to the Arguments section, with a full `--person mode` block describing: git query filtering by author, which sections to include/skip, expanded session breakdown and collaboration graph, no `.context/retros/` snapshot for person runs.

---

## PE-16: `/plan` router

**Status:** Done
**Commit:** `2f477f3`
**File created:** `plan/SKILL.md`

New skill that presents a mode selector (CEO vs eng) and delegates to `/plan-ceo-review` or `/plan-eng-review`. Supports `/plan ceo` and `/plan eng` shorthand to skip the selector. Infers mode from the plan content if provided.

---

## PE-09: `browse perf --budget`

**Status:** Done
**Commit:** `9b889ef`
**Files changed:** `browse/src/read-commands.ts`, `BROWSER.md`

Added `--budget key=ms,...` flag parsing to the `perf` case. When budget is provided, each budgeted metric gets a `PASS`/`FAIL` line with actual vs threshold. A summary line at the end reports overall `PASS` / `FAIL`. Non-budgeted metrics still print normally. Binary rebuilt and verified.

---

## PE-17: `gstack doctor`

**Status:** Done
**Commit:** `9abcb33`
**File created:** `doctor` (executable shell script)

Non-destructive health check covering 8 checks: bun version, browse binary exists, browse binary freshness (source staleness), Playwright Chromium launchable, browse server health, gh CLI auth, skill symlinks, git repo. Resolves bun from PATH and known install locations (`$HOME/.bun/bin/bun`, `/root/.bun/bin/bun`, `/usr/local/bin/bun`). Exits 0 (warnings only) or 1 (failures). Tested locally — output confirmed clean.

---

## Wave 2 candidates (next)

Ordered by effort + value:

| ID | Feature | Effort | Notes |
|----|---------|--------|-------|
| PE-01 | `/standup` | Low | Reuse retro git parsing, scope to 24h |
| PE-15 | `/qa-gate` | Low | Extend /ship to call browse health check |
| PE-03 | `/migrate` | Low | New SKILL.md + extend review/checklist.md |
| PE-11 | `/qa --compare` | Low | Two-URL QA pass, diff health scores |
| PE-10 | `browse form-fill` | Low | Loop `forms` → `fill` |
