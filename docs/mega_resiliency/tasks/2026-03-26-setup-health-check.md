# Wave 1 Task: Health Check at End of Setup Script (OP1, QW8)

**Date:** 2026-03-26
**Status:** Implemented
**Audit items:** OP1, QW8

## Finding

The `setup` script verified the binary exists and is executable, and that Playwright Chromium
launches, but never verified the full stack end-to-end. A corrupt binary or misconfigured
server would only surface on first actual use, with a confusing error.

## Change

Added a smoke-test step (step 3) in `setup` that runs `browse health` after the build:

```bash
# 3. Smoke-test the binary (ensures it's executable and can speak to the server)
echo "  Verifying browse..."
if "$BROWSE_BIN" health >/dev/null 2>&1; then
  echo "  browse health: OK"
else
  echo "  Warning: 'browse health' failed. Run 'browse health' manually to diagnose." >&2
fi
```

The check is advisory (warning, not fatal) because `browse health` starts a Chromium process
which may fail in headless CI environments where X11/display is unavailable. Setup still
succeeds — only a warning is emitted — so this doesn't break automated environments.

## Risk

Low. Adds ~3-5 seconds to setup on first run (Chromium startup). Non-fatal on failure.
Symlink creation step renumbered from step 3 to step 4 (cosmetic).
