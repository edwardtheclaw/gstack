# Mega Product Extension Audit — gstack

**Date:** 2026-03-26
**Scope:** Safe, obvious, adjacent feature opportunities
**Method:** Read-only analysis of repo structure, skill definitions, roadmap, and test coverage

---

## Executive Summary

gstack is a specialized AI workflow platform built on top of Claude Code. It provides 8 cognitive-mode skills (plan review, code review, ship, browse, QA, retro, cookie setup) and a 50-command headless browser CLI. The platform has a strong foundation with 148+ tests, structured skill definitions, and a clear phased roadmap.

This audit identifies **17 extension opportunities** across 5 categories, ranked by implementation proximity and value. All opportunities are adjacent to existing capabilities—none require new infrastructure dependencies or paradigm shifts.

---

## Category 1: New Workflow Skills (Cognitive Modes)

These fill clear gaps in the developer loop that existing skills don't cover.

### PE-01: `/standup` — Daily Standup Generator
**Adjacent to:** `/retro` (already does git log analysis + per-person summaries)
**What it does:** Generates a personal daily standup from the last 24h of commits, open PRs, and blocked items.
**Why obvious:** `/retro` already parses `git log`, computes per-person commit breakdowns, and detects session patterns. A standup is just a narrow slice of that logic with a different output format.
**Output format:** "Yesterday: X. Today: Y. Blockers: Z." — one paragraph, optionally JSON for Slack paste.
**Effort:** Low. Reuse `/retro`'s git parsing, scope to 24h, drop the team-wide sections.

---

### PE-02: `/debug` — Production Issue Investigator
**Adjacent to:** `/review` (code analysis), `/browse` (live app inspection)
**What it does:** Given an error message or bug description, orchestrates a structured investigation: read relevant logs, trace call paths, inspect live app state via browse, propose hypotheses ranked by likelihood.
**Why obvious:** `/review` already does two-pass code analysis. `/browse` can inspect live app state. A `/debug` skill composes these with a triage-first workflow.
**Workflow:** Symptom intake → log scan → code path trace → live browser inspect → hypothesis report
**Effort:** Medium. New SKILL.md; calls existing browse commands + grep patterns.

---

### PE-03: `/migrate` — Database Migration Reviewer
**Adjacent to:** `/review` (already has SQL & Data Safety as Pass 1 critical)
**What it does:** Focused review of database migration files. Checks for: reversibility, data loss risk, zero-downtime compatibility, missing indexes on large tables, constraint timing (DEFERRABLE), backfill safety.
**Why obvious:** `/review`'s checklist.md already calls out SQL string interpolation, TOCTOU races, N+1 queries. Migration review is that same logic applied earlier in the lifecycle.
**Output:** Migration safety report with go/no-go recommendation and required rollback steps.
**Effort:** Low. SKILL.md + extend review/checklist.md with a migration-specific section.

---

### PE-04: `/triage` — Issue & PR Triage Assistant
**Adjacent to:** `/review` (PR analysis), `/plan-eng-review` (scope assessment)
**What it does:** Given a list of open issues/PRs, classifies each by: severity, estimated effort, blocking status, staleness. Produces a prioritized work queue.
**Why obvious:** `/plan-eng-review` already assesses scope and effort. `/review` already classifies issues as CRITICAL vs INFORMATIONAL. Triage is both at queue scale.
**Effort:** Medium. New SKILL.md; uses `gh` CLI (already used in `/ship`) to fetch issue/PR lists.

---

### PE-05: `/onboard` — New Developer Context Builder
**Adjacent to:** `/retro` (team/contributor analysis), `/plan-eng-review` (architecture review)
**What it does:** Generates a project orientation doc for new contributors: key files, main data flows, team norms from commit history, "gotchas" from recent bug fixes, recommended first issues.
**Why obvious:** `/retro` already maps contributors and hotspots. `/plan-eng-review` already produces architecture diagrams. `/onboard` combines both into a "welcome packet."
**Output:** `.gstack/onboard-{date}.md` with architecture overview, team map, and suggested starting points.
**Effort:** Medium. New SKILL.md; mostly composes existing analysis patterns.

---

## Category 2: Browse CLI Extensions

These extend the headless browser with commands that are clearly adjacent to what exists.

### PE-06: `browse record` / `browse replay` — Session Recording
**Adjacent to:** Existing browse state persistence, screenshot, chain commands
**What it does:**
- `record`: captures every user interaction (click, fill, navigate) as a JSON event log
- `replay`: replays a recorded session, useful for regression checks
**Why obvious:** The `chain` command already accepts JSON event sequences from stdin. Recording is the inverse: emit that same JSON format. The state file already tracks session context.
**Effort:** Medium. New command in write-commands.ts using Playwright's CDP event subscription. Replay = `chain` with the recorded JSON.
**Already in roadmap:** Phase 6 mentions "video recording" — this is a lightweight precursor without the video complexity.

---

### PE-07: `browse mock` — Network Request Interception
**Adjacent to:** `browse network` (already captures network events), `browse js` (JS eval)
**What it does:** Intercept and stub HTTP requests during a test session. `browse mock POST /api/orders '{"id":1}'` — subsequent requests to that route return the stub.
**Why obvious:** Playwright has first-class `page.route()` for network interception. The server already routes commands; adding a `mock` command follows the same pattern as existing commands.
**Effort:** Medium. New handler in meta-commands.ts using `page.route()`. Pairs well with `/qa` regression tests.
**Already in roadmap:** Phase 6 mentions "network mocking" — this makes it concrete.

---

### PE-08: `browse a11y` — Accessibility Audit
**Adjacent to:** `browse accessibility` (already exports ARIA tree), `browse screenshot`
**What it does:** Run axe-core or Playwright's built-in accessibility checks and return a structured violation report with element refs.
**Why obvious:** The snapshot system already builds the ARIA tree. Accessibility scoring is a natural extension — `/qa` already has "accessibility" in its health score rubric but relies on manual inspection.
**Effort:** Low-Medium. Playwright has `page.accessibility.snapshot()` already in use; axe-core can be injected via `browse js`.
**Value:** Closes the accessibility gap in the `/qa` health score (currently theoretical in the rubric).

---

### PE-09: `browse perf --budget` — Performance Budget Enforcement
**Adjacent to:** `browse perf` (already captures LCP, FID, CLS, TTFB, FCP)
**What it does:** Accept a budget config (e.g., `--budget lcp=2500,cls=0.1`) and return PASS/FAIL per metric with the actual value.
**Why obvious:** `browse perf` already returns these exact metrics. Adding a threshold comparison is one extra step.
**Effort:** Very Low. 20-line addition to read-commands.ts. Returns structured pass/fail JSON.
**Value:** Enables `/qa` and `/ship` to gate on performance regressions.

---

### PE-10: `browse form-fill` — AI-Assisted Form Completion
**Adjacent to:** `browse fill`, `browse forms`, `browse accessibility`
**What it does:** Given a form URL and a goal (e.g., "fill with realistic test data for a US user"), auto-detects fields via the accessibility tree and fills them with contextually appropriate values.
**Why obvious:** `browse forms` already enumerates all form fields with labels. `browse fill` fills individual fields. This automates the loop between them.
**Effort:** Low. New command that calls `forms` then generates fill calls. The AI agent calling this can provide the fill strategy.

---

## Category 3: Enhanced Existing Skills

Low-risk additions that expand existing skills without changing their core behavior.

### PE-11: `/qa --compare` Cross-Environment Comparison
**Adjacent to:** `/qa --regression` (already loads baseline.json for comparison)
**What it does:** Run QA against two URLs (staging vs production) simultaneously and diff the health scores and issue lists.
**Why obvious:** The regression mode already diffs against a saved baseline. Cross-env comparison is the same mechanism with two live targets instead of one live + one saved.
**Effort:** Low. Extend qa/SKILL.md to accept a second URL and run both QA passes in sequence.

---

### PE-12: `/ship --dry-run` — Non-Destructive Ship Preview
**Adjacent to:** `/ship` (8-step workflow)
**What it does:** Execute all ship steps up to (but not including) the push/PR creation. Reports what would happen: merge conflicts detected, test results, version bump decision, CHANGELOG preview.
**Why obvious:** `/ship` already has a pre-flight step (Step 1). A dry-run is just an early exit after Step 6 (version bump) before Step 9 (push).
**Effort:** Very Low. Add `--dry-run` flag to ship/SKILL.md that stops before git push.
**Value:** Lets developers verify ship readiness without committing to a push.

---

### PE-13: `/review --focus` — Scoped Review Mode
**Adjacent to:** `/review` (two-pass checklist)
**What it does:** Accept a focus area flag: `--focus security`, `--focus sql`, `--focus perf`, `--focus frontend`. Run only the relevant checklist sections.
**Why obvious:** review/checklist.md already organizes checks into named categories. Scoping to one category is a filter, not a rewrite.
**Effort:** Very Low. Modify review/SKILL.md to accept focus flags that skip irrelevant checklist sections.

---

### PE-14: `/retro --person` — Individual Developer Retro
**Adjacent to:** `/retro` (already has per-person analysis section)
**What it does:** Run retro analysis scoped to a single contributor. Deep dive: their commit patterns, hotspots, PR merge times, collaboration graph (who reviews their PRs).
**Why obvious:** `/retro` already computes per-person stats. `--person` just removes the team aggregation and expands the individual section.
**Effort:** Very Low. Add `--person <name>` flag to retro/SKILL.md.

---

## Category 4: Cross-Skill Workflows

Compositions of existing skills that create new automation pipelines.

### PE-15: `/qa-gate` — QA Health Score Enforcer
**Adjacent to:** `/qa` (health score), `/ship` (pre-landing gates)
**What it does:** Run `/qa --quick`, compute health score, block `/ship` if score is below threshold. Configurable threshold (default: 70).
**Why obvious:** `/ship` already has pre-landing review gates. `/qa` already computes health scores. Connecting them is glue logic.
**Implementation:** Either a new skill or an option in `/ship` to run a quick QA pass before pushing.
**Effort:** Low. `/ship` already calls review checklist; extend to optionally call browse health check.

---

### PE-16: `/plan` — Unified Planning Orchestrator
**Adjacent to:** `/plan-ceo-review` and `/plan-eng-review` (both exist as separate skills)
**What it does:** Single entry point that asks "which mode?" and routes to the appropriate plan review skill. Reduces cognitive overhead of remembering two skill names.
**Why obvious:** The two plan skills already exist. `/plan` is just a router with a mode selector.
**Output:** Same as the underlying skill; `/plan` just handles the dispatch.
**Effort:** Trivial. New SKILL.md that presents the mode choice and delegates.

---

## Category 5: Developer Experience

Improvements to setup, discoverability, and daily use.

### PE-17: `gstack doctor` — Environment Health Check
**Adjacent to:** `setup` script (already checks binary staleness, Playwright, smoke test)
**What it does:** A `gstack doctor` command that verifies: binary built and current, skills symlinked, Playwright Chromium installed, browse server healthy, `gh` CLI authenticated, `bun` version correct.
**Why obvious:** The `setup` script already checks all of these. `doctor` runs them non-destructively and reports status vs fixing.
**Effort:** Very Low. Extract checks from `setup` into a read-only reporting mode.
**Value:** Replaces "why isn't my gstack working" debugging with a single command.

---

## Opportunity Summary

| ID | Opportunity | Category | Effort | Value |
|----|-------------|----------|--------|-------|
| PE-01 | `/standup` skill | New Skill | Low | High |
| PE-02 | `/debug` skill | New Skill | Medium | High |
| PE-03 | `/migrate` skill | New Skill | Low | Medium |
| PE-04 | `/triage` skill | New Skill | Medium | Medium |
| PE-05 | `/onboard` skill | New Skill | Medium | Medium |
| PE-06 | `browse record/replay` | Browser CLI | Medium | High |
| PE-07 | `browse mock` | Browser CLI | Medium | High |
| PE-08 | `browse a11y` | Browser CLI | Low-Med | High |
| PE-09 | `browse perf --budget` | Browser CLI | Very Low | Medium |
| PE-10 | `browse form-fill` | Browser CLI | Low | Medium |
| PE-11 | `/qa --compare` | Enhanced Skill | Low | Medium |
| PE-12 | `/ship --dry-run` | Enhanced Skill | Very Low | High |
| PE-13 | `/review --focus` | Enhanced Skill | Very Low | Medium |
| PE-14 | `/retro --person` | Enhanced Skill | Very Low | Medium |
| PE-15 | `/qa-gate` | Cross-Skill | Low | High |
| PE-16 | `/plan` router | Cross-Skill | Trivial | Medium |
| PE-17 | `gstack doctor` | Dev Experience | Very Low | High |

---

## Top 5 Recommendations (Highest ROI)

1. **PE-12: `/ship --dry-run`** — Trivial effort, high daily use. Developers want confidence before pushing.
2. **PE-17: `gstack doctor`** — Trivial effort, solves the #1 onboarding friction point.
3. **PE-09: `browse perf --budget`** — 20 lines of code, enables CI-style performance gating.
4. **PE-01: `/standup`** — Low effort, high daily value. Reuses all of `/retro`'s git parsing.
5. **PE-15: `/qa-gate`** — Connects two existing skills; makes the ship workflow meaningfully safer.

---

## Non-Opportunities (Explicitly Excluded)

The following were considered and excluded as not "safe, obvious, adjacent":

- **Full CI/CD pipeline integration** — Requires new infrastructure (GitHub Actions YAML, secrets management). Out of scope.
- **Slack/email notifications** — External service credentials. Not adjacent to current skill model.
- **Multi-repo support** — Architectural change to the session model. Phase 6+ territory.
- **LLM-powered code generation** — Different product category; gstack is review/workflow, not generation.
- **Chrome v20 cookie encryption** — Already deferred to Phase 5 in TODO.md; not overlooked.

---

*Audit produced by Claude Sonnet 4.6 on 2026-03-26. Read-only analysis; no code changes made.*
