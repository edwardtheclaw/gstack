# Wave 3 — Reliability (R12, B7)

**Date:** 2026-03-26
**Status:** Done

## Changes

### server.ts — Idle timer excludes /health (R12)
Moved `resetIdleTimer()` call out of the top of the `fetch` handler and into each branch that represents real user activity (`/cookie-picker` and `/command`). The `/health` route no longer resets the idle timer, so an external monitoring tool pinging `/health` will not prevent the browser from idle-shutting down.

### B7 — stop awaits flush (already resolved)
Verified: `shutdown()` already calls `await flushBuffers()` before `process.exit(0)`. B7 was resolved in the current codebase prior to this wave.
