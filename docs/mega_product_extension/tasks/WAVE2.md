# Wave 2 — Task Notes

**Executed:** 2026-03-27
**Status:** COMPLETE
**Items:** PE-01, PE-03, PE-08, PE-10, PE-11, PE-15 (all "Low" effort)

---

## PE-01: `/standup`

**Status:** Done
**File created:** `standup/SKILL.md`

New skill that generates a personal daily standup from the last 24h of commits and open PRs. Reuses `/retro`'s git analysis strategy (parallel git queries, same commit parsing logic) but scoped to 24h and focused on the current user. Outputs "Yesterday / Today / Blockers" format. Supports `--json` for Slack paste, `--person <name>` for another contributor, and custom windows (e.g., `48h` for after weekends). Zero files written — output goes directly to conversation.

---

## PE-03: `/migrate`

**Status:** Done
**Files created/changed:** `migrate/SKILL.md`, `review/checklist.md`, `review/SKILL.md`

New skill for database migration safety review. Three-tier verdict system: NO-GO (critical blocking issues), CONDITIONAL (high-severity conditions), GO (clean). Checks cover: irreversibility (`change` method with destructive ops, no `down`), data loss (NOT NULL without backfill, type narrowing), zero-downtime (large-table column ops, FK validation, column rename before app deploy), missing indexes on FKs, backfill safety (no batching in `execute("UPDATE...")`), and migration hygiene.

Extended `review/checklist.md` with a "Database Migrations" section under Pass 2 — INFORMATIONAL. Added `--focus migrate` to `review/SKILL.md`'s focus table.

---

## PE-08: `browse a11y`

**Status:** Done
**Files changed:** `browse/src/read-commands.ts`, `browse/src/server.ts`, `SKILL.md`, `BROWSER.md`

New `a11y` command added to the READ_COMMANDS set. Performs a DOM-based accessibility audit without CDN dependencies. Eight check categories:
1. Images missing alt text (also flags suspicious empty alts on large images)
2. Form inputs without labels (checks `<label>`, `aria-label`, `aria-labelledby`, `title`)
3. Buttons without accessible names
4. Links with empty text or non-descriptive text ("click here", "here")
5. Missing `lang` attribute on `<html>`
6. Missing page `<title>`
7. Skipped heading levels and missing/duplicate `<h1>`
8. Identical foreground/background color (obvious contrast fails)

Output: structured violation report with impact level (critical/serious/moderate), rule name, element selector, and description. Counts violations by severity in the summary line.

---

## PE-10: `browse form-fill`

**Status:** Done
**Files changed:** `browse/src/write-commands.ts`, `browse/src/server.ts`, `SKILL.md`, `BROWSER.md`

New `form-fill` command added to the WRITE_COMMANDS set. Enumerates all form fields (mirrors the `forms` read command), then generates contextually appropriate fill values based on field type, name, label, and placeholder hints. Fill logic covers: email, phone, URL, number (with age/zip/price sub-cases), date, time, password, search, name (first/last/full), address, city/state/country/zip, company, title/subject, comments/descriptions, coupon codes, and select dropdowns. Supports `form-fill <idx>` to target a specific form (default: form 0), and `--strategy <desc>` for documentation.

Output: summary of filled fields with selector/value pairs, plus skipped fields (checkboxes, radios, files, elements with no usable selector).

Binary rebuilt after both PE-08 and PE-10 changes.

---

## PE-11: `/qa --compare`

**Status:** Done
**File changed:** `qa/SKILL.md`

Added `--compare <url2>` mode section. Runs quick-mode QA against both the primary URL and a second URL (e.g., staging vs production), then produces a side-by-side comparison table showing per-category health scores, deltas, and issues unique to each environment. Identifies issues in URL1 only, URL2 only, and both. Writes separate baseline JSON files for each URL. Does not block/fail on differences — the compare mode is informational.

---

## PE-15: `/qa-gate`

**Status:** Done
**File created:** `qa-gate/SKILL.md`

New skill that runs a quick-mode QA pass (up to 4 pages) and enforces a minimum health score threshold (default: 70). Uses the same rubric as `/qa`. Returns a clear PASS/FAIL verdict. Arguments: `--threshold N` (0-100), `--report` (write JSON to `.gstack/qa-reports/`). Designed to be composable with `/ship`: add a QA gate step before pushing. Produces a concise per-category score breakdown alongside the final verdict.

---

## Wave 3 candidates (next)

| ID | Feature | Effort | Notes |
|----|---------|--------|-------|
| PE-02 | `/debug` | Medium | Compose /review + /browse for production issue investigation |
| PE-04 | `/triage` | Medium | Issue/PR triage using gh CLI + /plan-eng-review patterns |
| PE-05 | `/onboard` | Medium | New dev orientation: /retro contributor map + /plan-eng-review architecture |
| PE-06 | `browse record/replay` | Medium | JSON event log recording; replay = chain with recorded JSON |
| PE-07 | `browse mock` | Medium | Network request interception via page.route() |
