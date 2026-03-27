---
name: qa-gate
version: 1.0.0
description: |
  QA health score enforcer. Runs a quick QA pass against a URL and returns
  PASS/FAIL based on a configurable health score threshold (default: 70).
  Use in pre-ship workflows or CI-equivalent checks to gate on QA quality.
  Composable with /ship: add QA gating before pushing.
allowed-tools:
  - Bash
  - Read
  - Write
---

# /qa-gate — QA Health Score Enforcer

Runs a focused quick-mode QA check and enforces a minimum health score threshold. PASS or FAIL — no ambiguity.

## User-invocable
When the user types `/qa-gate`, run this skill.

## Arguments

- `/qa-gate <url>` — run against URL, default threshold 70
- `/qa-gate <url> --threshold 85` — require score ≥ 85
- `/qa-gate <url> --threshold 60 --report` — also write a QA report to `.gstack/qa-reports/`

**Argument validation:** If no URL is given, output:
```
Usage: /qa-gate <url> [--threshold N] [--report]
  /qa-gate https://myapp.com                    — gate with default threshold 70
  /qa-gate https://myapp.com --threshold 85     — require score ≥ 85
  /qa-gate https://myapp.com --threshold 60 --report  — also write QA report
```
Then stop.

---

## Step 1: Setup

Parse arguments:
- URL: required, first non-flag argument
- `--threshold N`: integer 0-100, default 70
- `--report`: also write a `.gstack/qa-reports/` report file (otherwise just output to conversation)

Find the browse binary:

```bash
B=$(browse/bin/find-browse 2>/dev/null || ~/.claude/skills/gstack/browse/bin/find-browse 2>/dev/null)
if [ -z "$B" ]; then
  echo "ERROR: browse binary not found. Run the gstack setup script."
  exit 1
fi
```

Create output directory if `--report` was passed:
```bash
mkdir -p .gstack/qa-reports
```

---

## Step 2: Quick QA pass

Run the following checks — this is the same as `--quick` mode in `/qa`, scoped to the homepage and top 3 navigation targets:

```bash
# Load the page
$B goto <url>
$B console --errors          # check for JS errors on load
$B links                     # get navigation links
```

At the homepage and up to 3 top navigation pages:
```bash
$B goto <page>
$B console --errors          # JS errors
$B links                     # any obviously broken links (check 404s)
$B perf                      # load timing
```

Record per-category observations exactly as `/qa` does.

---

## Step 3: Compute health score

Apply the same rubric as `/qa`:

### Console (15%)
- 0 errors → 100
- 1-3 errors → 70
- 4-10 errors → 40
- 10+ errors → 10

### Links (10%)
- 0 broken → 100
- Each broken link: -15 (min 0)

### Per-category (Visual, Functional, UX, Content, Performance, Accessibility — remaining 75%)
Start at 100 per category. Deduct per finding:
- Critical: -25 | High: -15 | Medium: -8 | Low: -3

### Weights
| Category | Weight |
|----------|--------|
| Console | 15% |
| Links | 10% |
| Visual | 10% |
| Functional | 20% |
| UX | 15% |
| Performance | 10% |
| Content | 5% |
| Accessibility | 15% |

Final score = Σ (category_score × weight)

---

## Step 4: Output result

```
QA Gate: <url>
Threshold: <N>  Score: <S>  Result: PASS ✓ / FAIL ✗

Category Scores:
  Console       NN  (N errors)
  Links         NN  (N broken)
  Visual        NN
  Functional    NN
  UX            NN
  Performance   NN
  Content       NN
  Accessibility NN

Issues found:
  [severity] description
  ...

PASS ✓ — Score N meets threshold N.
```

or:

```
FAIL ✗ — Score N is below threshold N. Fix the issues above before shipping.
```

**Exit behavior:**
- PASS: output result, no further action
- FAIL: output result. If this was called from `/ship`, the ship workflow should stop.

---

## Step 5: Optional report

If `--report` was passed, write a baseline JSON to `.gstack/qa-reports/`:

```json
{
  "date": "YYYY-MM-DD",
  "url": "<target>",
  "mode": "qa-gate",
  "threshold": N,
  "healthScore": N,
  "result": "PASS" | "FAIL",
  "issues": [{ "id": "GATE-001", "title": "...", "severity": "...", "category": "..." }],
  "categoryScores": { "console": N, "links": N, "visual": N, ... }
}
```

File: `.gstack/qa-reports/qa-gate-{domain}-{YYYY-MM-DD}.json`

---

## Important Rules

- Run efficiently — this is a gate, not a full QA audit. Visit at most 4 pages.
- Always produce a score even if the page fails to load (score = 0, category = Functional: 0)
- Never block on edge cases — if browse fails, report the failure and score 0 for affected categories
- Do NOT read CLAUDE.md or other docs — this skill is self-contained
