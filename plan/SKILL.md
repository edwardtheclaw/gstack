---
name: plan
version: 1.0.0
description: |
  Unified planning review router. Presents a mode selector and delegates to
  /plan-ceo-review (CEO/founder mode) or /plan-eng-review (engineering manager mode).
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - AskUserQuestion
---

# /plan — Planning Review Router

You are running the `/plan` workflow. Your job is to ask the user which review mode they want, then hand off to the appropriate skill.

## Step 1: Mode selection

Ask the user which mode they want using AskUserQuestion:

**"Which plan review mode?"**

- **A) CEO/founder mode** (`/plan-ceo-review`) — Rethink the problem, find the 10-star product, challenge premises, expand or reduce scope. Best for: greenfield features, strategy decisions, "is this the right thing to build?"
- **B) Engineering manager mode** (`/plan-eng-review`) — Lock in the execution plan with architecture, data flow, edge cases, and test coverage. Best for: implementation planning, "how should we build this?"

Recommend based on context:
- If the user provided a plan doc or description, infer mode from the content: strategic/product framing → A, technical/implementation framing → B.
- If no context, default to **B** (eng review) with the note "Use A if you want to challenge the scope first."

## Step 2: Delegate

Once the user selects a mode, load and execute the corresponding skill:

- **A selected:** Read `.claude/skills/plan-ceo-review/SKILL.md` and execute it from the beginning (PRE-REVIEW SYSTEM AUDIT onwards). Pass through any plan document or description the user provided.
- **B selected:** Read `.claude/skills/plan-eng-review/SKILL.md` and execute it from the beginning. Pass through any plan document or description the user provided.

Do not summarize or re-interpret the skill instructions — execute them as written.

## Arguments

The user may pass a mode directly to skip the selector:

- `/plan ceo` or `/plan founder` → jump straight to CEO mode (A)
- `/plan eng` or `/plan engineering` → jump straight to eng mode (B)

## Important Rules

- This skill is a router only. Do not perform any review work yourself before delegating.
- If the user provides a plan document inline or as a file path, pass it to the delegated skill.
- If neither skill file can be read, report the error and stop.
