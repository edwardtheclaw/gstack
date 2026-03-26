# Wave 2.1 — Move State File to User-Owned Directory (R2, HR1)

**Date:** 2026-03-26
**Status:** ✅ Done
**Risk items:** R2, HR1

## Problem

`cli.ts` and `server.ts` wrote the state file (auth token + port) to `/tmp/browse-server.json`.
On Linux with shared tmpfs, other local users could read the file before `mode: 0o600` permissions
were set (TOCTOU window), or in containerised CI with shared UIDs.

## Fix

Added `resolveStateDir()` to both `cli.ts` and `server.ts` that prefers:
1. `$XDG_RUNTIME_DIR` (Linux `/run/user/1000`, mode 0700, owned by user — ideal)
2. `$TMPDIR` (macOS `/var/folders/…/T`, user-specific — good)
3. `/tmp` (legacy fallback — acceptable on single-user machines)

Also moved the log files (`browse-console.log`, `browse-network.log`, `browse-dialog.log`) to
the same directory via `STATE_DIR`.

Updated README troubleshooting section to show all three deletion commands.

## Files Changed

- `browse/src/cli.ts`
- `browse/src/server.ts`
- `README.md`
