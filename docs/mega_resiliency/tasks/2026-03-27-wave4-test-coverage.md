# Wave 4 — Test Coverage

**Date:** 2026-03-27
**Status:** Done

## Summary

Wave 4 adds test coverage for the security-critical and reliability-critical behaviors identified
in the Mega Resiliency Audit. Items MT1, MT4 were already covered from prior work; this wave
fills the remaining gaps.

---

## Changes

### browse/src/server.ts
- Added `BROWSE_IDLE_CHECK_MS` env var (default `60000`ms). Controls how often the idle timer
  is checked. Enables the MT7 idle-timeout test to run in seconds rather than minutes.
- Fixed initialization order bug (introduced in Wave 3): `STATE_DIR` was declared after
  `CRASH_LOG_PATH` which referenced it, causing a `ReferenceError` at startup.
- Added 8s shutdown timeout failsafe: if `browserManager.close()` hangs (Playwright WebSocket
  stall), the server now force-exits after 8s. Also cleans up the state file on forced exit.
  This fixes a real-world issue where idle shutdown would trigger but the process would hang
  forever waiting for `browser.close()` to return.

### browse/test/auth.test.ts (new)
- **MT2** — Auth enforcement: spawns a real browse server and makes raw HTTP requests to verify:
  - No token → 401
  - Wrong token → 401
  - Correct token → 200
  - Lowercase `bearer` prefix → 401 (case-sensitive)
  - `/health` needs no auth → 200
  - `/health` response includes `uptime`, `tabs`, `buffersDropped`
  - `X-Duration-Ms` header present on successful command
  - Unknown command with correct token → 400
  - Empty string token → 401
- **MT7** — Idle timeout: spawns a server with `BROWSE_IDLE_TIMEOUT=2000` and
  `BROWSE_IDLE_CHECK_MS=1000`, waits 4 s, verifies the server exits and cleans up its state file.
  Also verifies that `/health` polls alone do NOT prevent idle shutdown.

### browse/test/commands.test.ts
- **MT8** — Diff URL behavior: after `diff(url1, url2)` the browser is left on `url2` (documents
  known Bug B2 behavior — not a regression test, a characterization test).
- **MT5** (additions) — Chain edge cases:
  - Non-array JSON (e.g. `{}`) throws "Expected JSON array"
  - Empty array `[]` returns empty string (not an error)
  - Unknown command in a chain step is reported as `[name] ERROR:` but does not abort the chain

### browse/test/snapshot.test.ts
- **TD1** — Ref assignment algorithm tests (`Ref assignment algorithm` describe block):
  - Duplicate-name buttons each get a distinct `@eN` ref
  - Refs are numbered sequentially from `@e1` with no gaps
  - Clicking the second `@ref` of three same-name buttons clicks only that button (nth() disambiguation verified via `data-clicked` attribute)
  - Duplicate-name links each get a distinct ref
  - Second snapshot resets counter to `@e1`
  - Unique button gets exactly one ref

### browse/test/fixtures/duplicate-refs.html (new)
- Fixture page with three same-name "Add" buttons, two same-name "Details" links,
  and one unique "Unique" button. Used by the TD1 algorithm tests.
