---
name: standup
version: 1.0.0
description: |
  Daily standup generator. Analyzes the last 24h of commits and open PRs to
  produce a concise "Yesterday / Today / Blockers" summary for standups or
  Slack paste. Scoped version of /retro — same git analysis, 24h window,
  personal focus.
allowed-tools:
  - Bash
  - Read
---

# /standup — Daily Standup Generator

Generates a personal daily standup summary from your last 24h of activity on `origin/main`.

## User-invocable
When the user types `/standup`, run this skill.

## Arguments

- `/standup` — last 24 hours, for the current git user
- `/standup 48h` — extend window (useful after weekends/holidays)
- `/standup --json` — output JSON suitable for Slack paste
- `/standup --person <name>` — generate standup for another contributor

**Argument validation:** If the argument doesn't match a window (`24h`, `48h`, `72h`, `Nh`), `--json`, `--person <name>`, or combinations of these, show usage and stop:
```
Usage: /standup [window] [--json] [--person <name>]
  /standup               — last 24h, current user
  /standup 48h           — last 48h (after long weekend)
  /standup --json        — output JSON for Slack paste
  /standup --person bob  — standup for another contributor
```

---

## Step 1: Identify current user and window

```bash
git config user.name
git config user.email
```

Parse window from arguments (default: `24h`). The `<person>` in `--person` overrides the git user.

---

## Step 2: Gather activity in parallel

```bash
# Personal commits to main in the window
git log origin/main --since="<window> ago" --author="<user_name>" \
  --format="%H|%aN|%ai|%s" --shortstat --no-merges

# Open PRs by the user (skip if gh not available)
gh pr list --author="@me" --state=open \
  --json number,title,url,isDraft,updatedAt 2>/dev/null || true

# Uncommitted changes (work in progress)
git status --short

# Stashed work
git stash list 2>/dev/null
```

---

## Step 3: Build each standup section

### Yesterday
List what **actually landed to origin/main** in the window:
- Extract commit subjects from Step 2, deduplicate, group by feature area
- If multiple commits land the same feature, collapse to one bullet: "Shipped X (3 commits)"
- Use active voice: "Shipped X", "Fixed Y", "Refactored Z"

### Today
Infer **what's actively in-flight**:
- Open non-draft PRs → "Land PR #N: <title>"
- Open draft PRs → "WIP: <title>"
- Uncommitted changes (from `git status`) → "In progress: [describe files touched]"
- Stashed work → "Stashed: [stash description]"
- If nothing in-flight and commits landed → "Reviewing and merging feedback / starting next task"

### Blockers
Scan for blocker signals — only report a real blocker if found:
- Commit messages with `WIP`, `blocked`, `do not merge`, `skip ci` (check recent commits in the window)
- Draft PRs marked `isDraft: true` with no recent commits (stalled drafts)
- Merge conflict markers in `git status` (`UU`, `AA`, `DD`)
- If no signals found: **"None"** — do not invent blockers

---

## Step 4: Output the standup

```
**Yesterday:**
- Shipped <X>
- Fixed <Y>

**Today:**
- Land PR #42: <title>
- Start <next task>

**Blockers:** None
```

**Formatting rules:**
- 1-4 bullets per section maximum — this is a standup, not a retro
- Each bullet: one sentence, active voice, concrete
- If zero personal commits and no open PRs: output "No commits in the last <window>. Try `/standup 48h` or check the date."
- Do NOT include: LOC counts, session analysis, team breakdown, health scores

---

## Step 5: Optional JSON output

If `--json` was passed, output a JSON block after the standup text:

```json
{
  "date": "2026-03-27",
  "window": "24h",
  "author": "Garry Tan",
  "yesterday": ["Shipped browse a11y command (PE-08)", "Fixed form-fill edge case"],
  "today": ["Land PR #44: Wave 2 implementation", "Write WAVE2.md notes"],
  "blockers": []
}
```

---

## Tone

- Terse. One sentence per bullet.
- Active voice: "Shipped X", "Fixed Y", "Investigating Z"
- No padding ("I worked on", "I was able to")
- This is a standup, not a status report — be the person who gets it done in 30 seconds

## Important Rules

- Use `origin/main` for all git queries (not local main which may be stale)
- If `gh` CLI is not available or not authenticated, skip the PR step gracefully without error
- Do NOT write any files — output goes directly to conversation
- Do NOT read CLAUDE.md or other docs — this skill is self-contained
