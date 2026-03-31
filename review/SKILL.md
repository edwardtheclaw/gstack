---
name: review
version: 1.0.0
description: |
  Pre-landing PR review. Analyzes diff against main for SQL safety, LLM trust
  boundary violations, conditional side effects, and other structural issues.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - AskUserQuestion
---

# Pre-Landing PR Review

You are running the `/review` workflow. Analyze the current branch's diff against main for structural issues that tests don't catch.

## `--focus` mode

If the user ran `/review --focus <area>`, run **only** the checklist sections relevant to the specified area. Supported focus areas:

| Flag | Checklist sections to run |
|------|--------------------------|
| `--focus security` | SQL & Data Safety, LLM Output Trust Boundary |
| `--focus sql` | SQL & Data Safety |
| `--focus perf` | Magic Numbers & String Coupling (query patterns), any performance-related items |
| `--focus frontend` | View/Frontend |
| `--focus llm` | LLM Output Trust Boundary, LLM Prompt Issues |
| `--focus tests` | Test Gaps |
| `--focus migrate` | Database Migrations |

For all other checklist sections, output `(skipped — not in focus scope)` and move on. The output header should read: `Pre-Landing Review [--focus <area>]: N issues (X critical, Y informational)`.

---

## Step 1: Check branch

1. Run `git branch --show-current` to get the current branch.
2. If on `main`, output: **"Nothing to review — you're on main or have no changes against main."** and stop.
3. Run `git fetch origin main --quiet && git diff origin/main --stat` to check if there's a diff. If no diff, output the same message and stop.

---

## Step 2: Read the checklist

Read `.claude/skills/review/checklist.md`.

**If the file cannot be read, STOP and report the error.** Do not proceed without the checklist.

---

## Step 3: Get the diff

Fetch the latest main to avoid false positives from a stale local main:

```bash
git fetch origin main --quiet
```

Run `git diff origin/main` to get the full diff. This includes both committed and uncommitted changes against the latest main.

---

## Step 4: Two-pass review

Apply the checklist against the diff in two passes:

1. **Pass 1 (CRITICAL):** SQL & Data Safety, LLM Output Trust Boundary
2. **Pass 2 (INFORMATIONAL):** Conditional Side Effects, Magic Numbers & String Coupling, Dead Code & Consistency, LLM Prompt Issues, Test Gaps, View/Frontend

Follow the output format specified in the checklist. Respect the suppressions — do NOT flag items listed in the "DO NOT flag" section.

---

## Step 4.5: Visual Review (Screenshots)

During code review:
1. Identify changed routes from the PR diff
2. Navigate to each changed route using browse
3. Capture annotated screenshots with `screenshot --annotate`
4. Upload via `gstack-upload`
5. Add screenshots to PR review comment as markdown images

Example:
```
browse goto <changed-route-url>
browse screenshot /tmp/review-page.png --annotate
gstack-upload /tmp/review-page.png
```

Embed the URL in your review comment for visual context.

---

## Step 5.5: Visual Diff Comparison

For UI-heavy changes, compare production vs PR branch:
1. Capture a screenshot of the production version of changed routes
2. Deploy or preview the PR branch locally
3. Capture a screenshot of the PR branch version
4. Upload both screenshots and include side-by-side in review comment

```
# Production screenshot
browse goto <production-url>
browse screenshot /tmp/prod-page.png --annotate

# PR branch screenshot (if preview available)
browse goto <preview-url>
browse screenshot /tmp/pr-page.png --annotate

# Upload and compare
gstack-upload /tmp/prod-page.png
gstack-upload /tmp/pr-page.png
```

Include both URLs in your review comment for visual comparison.

---

## Step 5: Output findings

**Always output ALL findings** — both critical and informational. The user must see every issue.

- If CRITICAL issues found: output all findings, then for EACH critical issue use a separate AskUserQuestion with the problem, your recommended fix, and options (A: Fix it now, B: Acknowledge, C: False positive — skip).
  After all critical questions are answered, output a summary of what the user chose for each issue. If the user chose A (fix) on any issue, apply the recommended fixes. If only B/C were chosen, no action needed.
- If only non-critical issues found: output findings. No further action needed.
- If no issues found: output `Pre-Landing Review: No issues found.`

---

## Important Rules

- **Read the FULL diff before commenting.** Do not flag issues already addressed in the diff.
- **Read-only by default.** Only modify files if the user explicitly chooses "Fix it now" on a critical issue. Never commit, push, or create PRs.
- **Be terse.** One line problem, one line fix. No preamble.
- **Only flag real problems.** Skip anything that's fine.
