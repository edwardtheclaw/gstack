# Wave 2.3 — Crash-Loop Detection with Backoff (R1)

**Date:** 2026-03-26
**Status:** ✅ Done
**Risk items:** R1

## Problem

On Chromium crash, the server exits with code 1. The CLI detects the connection error and
immediately restarts the server with no delay. If the crash loop is fast (e.g., GPU fault,
bad Chromium binary), the server respawns repeatedly until the CLI gives up with a confusing
"crashed twice in a row" message after only 1 retry. No crash history was persisted.

## Fix

Added crash-loop tracking to `cli.ts`:
- `CRASH_LOG_FILE` persists crash timestamps to `$STATE_DIR/browse-crashes.json` (mode 0o600)
- `recordCrash()` prunes events outside a 60-second window, appends a new timestamp, and
  returns the count + exponential backoff delay (1s, 2s, 4s… capped at 8s)
- `clearCrashLog()` removes the crash log after a successful restart
- After 3 crashes in 60 seconds, the CLI aborts with an actionable message pointing to
  GPU/memory diagnostics and `browse status`

## Constants

| Constant | Value | Purpose |
|---|---|---|
| `CRASH_WINDOW_MS` | 60 000 ms | Window for counting repeated crashes |
| `CRASH_MAX_IN_WINDOW` | 3 | Max crashes before aborting |
| Backoff | 1s × 2^(n-1), max 8s | Delay before each restart attempt |

## Files Changed

- `browse/src/cli.ts`
