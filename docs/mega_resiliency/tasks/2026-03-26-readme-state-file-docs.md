# Wave 1 Task: Document State File Reset in README (MD3, QW2)

**Date:** 2026-03-26
**Status:** Implemented
**Audit items:** MD3, QW2

## Finding

If `/tmp/browse-server.json` is stale or corrupt (e.g., from an unexpected shutdown, manually
edited, wrong permissions), the CLI fails with a confusing "Unauthorized" or "connect ECONNREFUSED"
error. No documentation existed explaining how to recover.

## Change

Added a troubleshooting entry to `README.md` under the Troubleshooting section:

> **Auth errors ("Unauthorized") or connection refused after an unexpected shutdown?**
> The state file may be stale or corrupt. Delete it and let the next command start a fresh server:
> `rm /tmp/browse-server.json` (or `rm /tmp/browse-server-<port>.json` if using Conductor).

## Risk

None — documentation only.
