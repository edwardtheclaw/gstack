# Mega Resiliency Audit — gstack

**Date:** 2026-03-26
**Auditor:** Claude (Sonnet 4.6)
**Scope:** Full repo — code quality, reliability, hardening, correctness, observability, security, testing, performance, deployment, data integrity, developer experience, documentation
**Version audited:** 0.3.1 (commit f7b9532)

---

## Summary

gstack is a Claude Code skill suite built around a persistent headless Chromium daemon (`browse`) plus 7 workflow skills (ship, review, plan-ceo-review, plan-eng-review, qa, retro, setup-browser-cookies). The architecture is a thin CLI client that speaks HTTP to a Bun server process, which drives Playwright/Chromium. The project is intentionally single-user, localhost-only, and developer-tooling focused.

The codebase is compact (~1,500 lines TypeScript), well-documented, and shows intentional design decisions throughout. The main resiliency gaps are: sparse error-path test coverage, macOS-only cookie import, no structured logging/observability, a few hardening gaps in the HTTP server, and operational brittleness around the binary build lifecycle.

---

## Health Score: 6.5 / 10

| Dimension            | Score | Notes |
|----------------------|-------|-------|
| Code quality         | 7/10  | Clean TS, good naming, some complexity in snapshot.ts |
| Reliability          | 6/10  | Crash → exit(1) is correct; restart path needs hardening |
| Security             | 7/10  | Auth token, path validation, pre-commit hooks; cookie picker unauthed |
| Observability        | 4/10  | Circular buffers exist but no structured logging; no health metrics |
| Testing              | 5/10  | Integration tests present; error paths and edge cases sparse |
| Documentation        | 8/10  | Excellent README, BROWSER.md, SKILL.md; missing API contract docs |
| Performance          | 7/10  | Good lazy-load, idle shutdown, ref caching; binary is 58MB |
| Deployment/Ops       | 5/10  | Manual deploy steps; no rollback; no version pinning of binary |
| Developer experience | 7/10  | One-command setup; clear CLAUDE.md; skip CI on skill changes |
| Data integrity       | 6/10  | Cookie decryption robust; no checksums on compiled binary |

---

## Risks (ranked by severity)

### Critical

**R1 — `process.exit(1)` on Chromium crash leaves Claude session silently broken**
`browser-manager.ts`: On `browser.on('disconnected')`, the server exits immediately. The CLI will attempt to restart it, but if the crash loop is fast (e.g., GPU fault), the CLI's 8-second startup window and 30-second total timeout may be exhausted, leaving Claude with no browse capability and no actionable error. There is no backoff, no crash-loop detection, and no persistent log of crash events.

**R2 — State file at `/tmp` is world-readable on some Linux configurations**
`cli.ts` writes `/tmp/browse-server.json` with `mode: 0o600`, which is correct. However, `/tmp` itself may be on a shared tmpfs. If another local user can read the file before permissions are set (TOCTOU), or if the process starts as one user and the file is read as another (e.g., in containerized CI), the auth token can be stolen. The fix is to use a user-owned directory (e.g., `$XDG_RUNTIME_DIR` or `~/.cache/browse/`).

### High

**R3 — No input sanitization on `js` and `eval` commands**
`read-commands.ts`: `js` executes arbitrary JavaScript in the page context via `page.evaluate()`. `eval` reads a file from disk (path-restricted to `/tmp` or cwd) and runs it. While the path restriction prevents traversal, if Claude (or a compromised prompt chain) passes malicious JS, it executes with full page privileges. There is no sandboxing beyond Chromium's renderer process isolation.

**R4 — Cookie picker endpoints have no authentication**
`server.ts` / `cookie-picker-routes.ts`: `/cookie-picker/*` routes are explicitly excluded from Bearer token validation with the comment "localhost-only, accepted risk." However, any process running as the same user (or via DNS rebinding on a misconfigured network) can trigger cookie imports. An attacker script running locally could call `POST /cookie-picker/import` to inject attacker-controlled cookies into the active browser session.

**R5 — Binary in `dist/` is gitignored but not checksummed**
The compiled `browse/dist/browse` binary (~58MB) is what actually runs. It is not tracked in git, not checksummed, and not verified at startup. A supply-chain compromise of the build host (or a local tampered binary) would be invisible. There is no integrity verification step in the setup script or at runtime.

**R6 — `setup` script does not handle partial failures atomically**
`setup`: If `bun run build` succeeds but the Playwright install fails midway, the state is partially broken. Similarly, if symlink creation fails for one skill, the script continues silently. There is no rollback and no "verify everything works" check after setup completes.

### Medium

**R7 — No retry or circuit-breaker on Playwright actions**
`write-commands.ts`, `read-commands.ts`: All Playwright actions use a single attempt with a fixed timeout. Transient flakiness (network blip, slow render, race condition after navigation) causes hard failures returned to Claude with no retry. The `wait` command exists but must be composed manually.

**R8 — `chain` command reads stdin as JSON with no size limit**
`cli.ts`: `chain` reads all of stdin before parsing. An extremely large chain payload (or accidental piping of a large file) will buffer entirely in memory before any validation occurs.

**R9 — No validation that the Playwright version matches the installed Chromium**
`package.json` pins `playwright ^1.58.2` (semver range, not locked). After `npm update` or `bun update`, Playwright may upgrade, but the Chromium binary in `~/.cache/ms-playwright/` is not re-downloaded until `playwright install chromium` is re-run. This version mismatch causes silent failures or crashes.

**R10 — Cookie decryption is macOS-only with no graceful degradation on Linux**
`cookie-import-browser.ts`: All paths hardcode macOS `~/Library/Application Support/...` paths and macOS Keychain APIs. On Linux (e.g., CI, remote dev), the feature silently fails or errors. The `setup-browser-cookies` skill has no platform check and no user-facing message explaining the limitation.

### Low

**R11 — Port scan (9400–9410) on every CLI invocation**
`server.ts`: If no server is running, the first CLI call scans ports 9400–9410 to find a free one. This is fast but creates unnecessary syscalls on every cold start. More importantly, if ports 9400–9410 are all occupied by unrelated services, the server fails to start with a confusing error.

**R12 — Idle timeout resets on ANY request, including health checks**
`server.ts`: The idle timer is reset on every incoming request including `/health`. If an external monitoring tool pings `/health`, the browser will never idle-shutdown, potentially leaking a Chromium process.

**R13 — No graceful handling of tab-closed page becoming active**
`browser-manager.ts`: `getPage()` returns the current active page. If that page is closed externally (e.g., via `closetab`), the next command that calls `getPage()` may throw an unhandled Playwright "Target closed" error that propagates as a 500 without a helpful message.

---

## Bugs

**B1 — Ref map is never cleared on navigation (`goto`, `back`, `forward`, `reload`)**
`browser-manager.ts`: The `refMap` (Map<string, Locator>) is populated by `snapshot.ts` and cached on the manager. After navigation, old refs pointing to now-gone elements remain in the map. Using `@e1` after navigating to a new page will silently operate on a stale locator, potentially matching a different element or throwing a Playwright detached-node error.

**B2 — `diff` command does not restore original URL after crawling two pages**
`meta-commands.ts`: `diff` navigates to `url1`, captures text, then navigates to `url2`, captures text, then returns the diff. The browser is left on `url2`. If Claude expects to still be on the original page, subsequent commands will silently operate on the wrong page.

**B3 — `responsive` screenshots overwrite without warning**
`meta-commands.ts`: `responsive [prefix]` writes files `<prefix>-mobile.png`, `<prefix>-tablet.png`, `<prefix>-desktop.png` without checking for existing files. Silently overwrites.

**B4 — CircularBuffer `get(i)` uses absolute index but no bounds check**
`buffers.ts`: `get(i)` and `set(i, entry)` take an index `i` in `[0, capacity)` with no guard. Out-of-range `i` returns `undefined` silently (TypeScript types say `T`, not `T | undefined`). Any consumer assuming non-null return can crash.

**B5 — Server startup race: state file written before server is listening**
`cli.ts` / `server.ts`: The server writes the state file early in startup (before `Bun.serve()` is called). If the CLI reads the state file and sends a request before the server is fully listening, the connection will be refused. The CLI retries, but this creates a timing window that causes spurious "server not ready" errors on slow machines.

**B6 — `useragent` context recreation may silently drop in-flight navigation**
`browser-manager.ts`: `recreateContext()` is called when user agent changes. It saves cookies and redirects, then creates a new context. If a navigation was in progress when the context switch happened, the `goto` on the new context may throw or complete to the wrong URL without any error to the caller.

**B7 — `stop` command does not wait for buffer flush to complete**
`server.ts` / `meta-commands.ts`: `stop` calls `process.exit(0)` after scheduling a flush. If the async flush has not completed (disk write pending), logs since last flush are lost. The `SIGTERM` handler does the same.

---

## Missing Tests

**MT1 — No test for path traversal prevention**
`read-commands.ts` validates file paths but there is no test verifying that `../etc/passwd`, `../../secret`, or URL-encoded variants are rejected. This is a security-critical behavior with zero test coverage.

**MT2 — No test for auth token enforcement**
The Bearer token is the primary access control mechanism. There is no test sending requests without a token, with a wrong token, or with a replayed token to verify 401 responses.

**MT3 — No test for crash-restart lifecycle**
The crash detection and server restart flow (browser disconnect → exit → CLI restart) has no integration test. This is the highest-reliability path and is entirely untested.

**MT4 — No test for ref-map staleness after navigation**
Bug B1 above (stale refs after navigation) has no test. A test navigating to page A, snapshotting (building refs), navigating to page B, and then using an old ref should demonstrate the failure.

**MT5 — No test for `chain` command with invalid JSON**
The `chain` command parses stdin as JSON. There is no test for malformed JSON, empty input, or excessively large input.

**MT6 — No test for concurrent command execution**
The server handles one request at a time via Playwright's sequential page operations, but there is no test verifying behavior when two requests arrive simultaneously (e.g., two CLI processes running in parallel).

**MT7 — No test for idle timeout shutdown**
The 30-minute idle timer is not tested. A fast test with a short `BROWSE_IDLE_TIMEOUT` override would verify clean shutdown.

**MT8 — No test for `diff` URL restoration behavior**
Bug B2 (browser left on url2 after diff) has no test.

**MT9 — Cookie import tests are unit-only; no integration test importing into live session**
`cookie-import-browser.test.ts` tests decryption in isolation. There is no test that calls the full picker route pipeline against a live server instance.

**MT10 — No test for Linux/non-macOS cookie import failure mode**
The macOS-only cookie paths should produce a clear error on other platforms. No cross-platform error handling is tested.

---

## Missing Documentation

**MD1 — No documented API contract for the HTTP server**
The `/command` endpoint, request/response schema, error codes, and auth format are not documented anywhere outside the source code. A contributor wanting to write a new client (e.g., a VS Code extension) has no spec to follow.

**MD2 — `setup-browser-cookies` SKILL.md does not mention macOS-only limitation**
Users on Linux or Windows will encounter a cryptic failure. The skill description should prominently note the platform requirement.

**MD3 — No documented recovery procedure for corrupt state file**
If `/tmp/browse-server.json` has a bad token (e.g., edited manually, wrong permissions), the CLI fails with a confusing auth error. The README and BROWSER.md don't document how to reset: `rm /tmp/browse-server.json`.

**MD4 — `CONDUCTOR_PORT` env var not documented in README or BROWSER.md**
The multi-workspace isolation feature exists and works but is only mentioned in source comments. Power users who run multiple Claude Code sessions can't discover it.

**MD5 — No documented upgrade path that preserves active sessions**
The deploy section in CLAUDE.md says to `git reset --hard origin/main` in the skills directory. This kills any running browse server (binary replaced on disk, next invocation rebuilds). No guidance on draining or migrating state.

**MD6 — `BROWSE_IDLE_TIMEOUT` env var not documented**
Exists in `server.ts`, useful for users who want shorter or longer idle windows, but not documented.

**MD7 — No architecture diagram showing skill discovery flow**
How Claude Code discovers and loads skills from `~/.claude/skills/` is not documented. New contributors don't understand why the setup creates symlinks vs copies.

---

## Security Findings

**S1 — DNS rebinding attack on `/cookie-picker` endpoints (High)**
The cookie picker routes have no auth and rely solely on "localhost-only" as protection. DNS rebinding attacks can trick the browser into making cross-origin requests to `127.0.0.1:9400`. While requiring a running browse server, this could allow a malicious web page to inject arbitrary cookies into the active session. Mitigation: add a `Host: localhost` or `Origin: null` check on all `/cookie-picker` routes, or add an optional CSRF token.

**S2 — Error responses may leak internal paths (Low)**
`cookie-picker-routes.ts` catches errors and returns `{ error: err.message }`. `err.message` from Node.js file system errors often includes full absolute paths (e.g., `ENOENT: no such file or directory, open '/Users/garry/Library/...'`). This is a low risk for a local tool but leaks home directory structure.

**S3 — Pre-commit hook bypass is trivial (Low)**
`git commit --no-verify` bypasses the secret-scanning hook. The hook provides a good first-line defense, but the README doesn't discourage `--no-verify`. A developer in a hurry may bypass it and accidentally commit credentials.

**S4 — `eval` command can read any file accessible to the server process (Medium)**
While path validation restricts to `/tmp` and `process.cwd()`, `process.cwd()` is the gstack project directory. Any file in the project (including CLAUDE.md, any `.env` in the project root) can be read and executed as JavaScript via `eval`. This is intentional but should be documented as a security boundary.

**S5 — Auth token not rotated between sessions (Low)**
The token is generated once at server start and persists until the server restarts. A token captured from the state file (even momentarily) remains valid for the entire server lifetime. Rotating the token periodically (e.g., every hour) would limit the window for a captured token.

**S6 — Compiled binary has no signature or checksum (Medium)**
See R5. The 58MB binary is the actual execution artifact. It should be signed (macOS codesign) or at minimum have a SHA-256 checksum committed to the repo so the setup script can verify integrity.

---

## Observability Weaknesses

**O1 — No structured logging**
All server output is `console.log`/`console.error` to stdout. There is no log level, no timestamp, no correlation ID per request. Debugging production issues requires reading raw terminal output.

**O2 — No request timing metrics**
The server tracks command success/failure but not latency. It's impossible to know if `snapshot` takes 200ms or 2000ms without manual timing. This matters for AI agent loop performance tuning.

**O3 — CircularBuffer flush counter never exposed**
`buffers.ts` tracks `totalAdded` but this metric is never surfaced in any `/status` or `/health` endpoint. Overflow (silent message dropping) is invisible.

**O4 — `/health` endpoint returns only `{"ok":true}`**
The health endpoint could return server uptime, active tab count, browser connected status, and memory usage with minimal additional code. As-is, it only confirms the server is running.

**O5 — No crash/restart log**
When Chromium crashes and the server exits, the event is lost. There is no append-only crash log, no counter, and no way to know how often crashes occur over a session.

**O6 — Idle shutdown is silent**
When the server shuts down due to idle timeout, it logs to stdout (not visible unless the user is watching). Claude receives a connection error on next command with no indication that this was an expected idle shutdown.

---

## Ops Weaknesses

**OP1 — Manual multi-step deploy with no verification**
The CLAUDE.md deploy procedure is 3 manual steps with no verification that the deployed binary matches the source. A missed `git fetch` or stale build will silently run old code.

**OP2 — No rollback mechanism**
If a bad build is deployed to `~/.claude/skills/gstack/`, there is no documented rollback. The developer must manually `git reset --hard <prev-sha>` and rebuild.

**OP3 — Binary rebuild required for any source change**
Even a one-line change to a skill SKILL.md requires a full `bun run build` cycle (which compiles the TypeScript browse binary, not actually needed for skill markdown changes). The setup script conflates "rebuild browse" with "update skills."

**OP4 — No process supervisor or auto-restart policy**
The browse server is a daemon but has no supervisor (systemd, launchd, etc.). If it crashes repeatedly, it stays dead until Claude triggers another command. There is no restart limit, no cooldown, and no alerting.

**OP5 — Port collision with no user-facing diagnostic**
If ports 9400–9410 are all busy, the server fails to bind with a cryptic error. There is no diagnostic that lists what is using those ports.

**OP6 — Symlinks in `~/.claude/skills/` break if gstack is moved**
The setup script creates symlinks pointing to the gstack clone location. If the user moves the gstack directory, all skill symlinks break silently with no guidance on how to re-run setup.

---

## Tech Debt

**TD1 — `snapshot.ts` is the most complex file with no dedicated tests for its internals**
The two-pass ref assignment algorithm (count role+name pairs, then assign `@eN`) is non-trivial. It is tested via integration tests but not unit-tested at the function level. Refactoring risk is high.

**TD2 — `browser-manager.ts` is doing too many things (God Object)**
Manages browser lifecycle, tab management, ref map, dialog handling, network/console buffers, context recreation, and user agent. This makes it hard to test individual behaviors in isolation and increases the change blast radius.

**TD3 — `cookie-import-browser.ts` has hardcoded PBKDF2 parameters**
`1003 iterations, AES-128-CBC, SHA-1` is the current Chromium v10 format. These are magic numbers with comments but not constants. When Chromium changes its encryption scheme (as it has in the past), the update will be error-prone.

**TD4 — `server.ts` mixes HTTP routing, buffer management, and idle timer logic**
These concerns should be separated to improve testability and readability.

**TD5 — No `bun.lock` committed**
`.gitignore` includes `bun.lock`. Without a lockfile, `bun install` can pick up different transitive dependency versions on different machines, making builds non-reproducible.

**TD6 — Skills have no versioning or compatibility matrix**
SKILL.md files specify `version: 1.1.0` but there is no enforcement of which gstack version a skill requires. A user with an old binary and new skill SKILL.md (or vice versa) will get confusing errors.

---

## Simplification Opportunities

**SI1 — `find-browse` shell script can be replaced with a one-liner in setup**
`browse/bin/find-browse` is a shell script that searches for the browse binary in multiple locations. This logic could be inlined into `setup` without needing a separate file.

**SI2 — Port scan loop can use a single `Bun.listen` call with port:0**
Instead of scanning 9400–9410, use OS port assignment (`port: 0`) and write the assigned port to the state file. This is simpler, more reliable, and eliminates the 11-port scan.

**SI3 — `cookie-picker-ui.ts` is a large string template; could be a static HTML file**
The HTML picker UI is an inline string in a TypeScript file (~200 lines). It would be simpler to maintain as a static `cookie-picker.html` file served from disk, hot-reloadable during development.

**SI4 — `CircularBuffer.get(i)` / `set(i, entry)` methods are unused externally**
These public methods are never called outside `buffers.ts`. They can be removed or made private, reducing surface area.

---

## Quick Wins

**QW1 — Fix ref map clearing on navigation (Bug B1)**
In `write-commands.ts` `goto`/`back`/`forward`/`reload` handlers, call `browserManager.clearRefMap()` after successful navigation. ~5 lines of code.

**QW2 — Document `/tmp/browse-server.json` reset in README troubleshooting**
Add a 2-line troubleshooting entry: "If you see auth errors, run `rm /tmp/browse-server.json`." ~2 lines.

**QW3 — Add `Host` header check to cookie-picker routes (Security S1)**
In `cookie-picker-routes.ts`, add: `if (req.headers.get('host') !== 'localhost:PORT') return 403`. ~5 lines.

**QW4 — Surface buffer overflow in `/health` response**
Add `buffersDropped: { console: consoleBuffer.totalDropped, ... }` to `/health`. Requires adding a `totalDropped` counter to CircularBuffer. ~10 lines.

**QW5 — Add `--no-verify` warning to README**
Add a note discouraging `git commit --no-verify` near the contributing section. ~3 lines.

**QW6 — Document `CONDUCTOR_PORT` and `BROWSE_IDLE_TIMEOUT` in BROWSER.md**
Two short paragraphs in the existing Configuration section. ~10 lines.

**QW7 — Add `bun.lock` to version control**
Remove `bun.lock` from `.gitignore`. Run `bun install` and commit. ~1 command.

**QW8 — Verify setup succeeded with a health check at end of `setup` script**
Add `browse/dist/browse health` at the end of `setup` to confirm the binary works. ~3 lines.

---

## High-Risk Changes

**HR1 — Replacing state file location (`/tmp` → `$XDG_RUNTIME_DIR`)**
Security improvement (R2) but will break existing running servers. Requires migration logic or a version bump with clear upgrade instructions.

**HR2 — Adding authentication to `/cookie-picker` routes**
Fixes S1 but breaks the existing in-browser UI flow (the UI is opened in the headless browser, which doesn't have the auth token). Requires either embedding the token in the UI URL or adding a session cookie mechanism.

**HR3 — Using `port: 0` for automatic port assignment (SI2)**
Simplifies port management but changes the predictable port range (9400–9410) that some users may have firewalled or documented. Needs careful migration.

**HR4 — Separating `browser-manager.ts` into focused modules (TD2)**
High-value refactor but touches every command handler. Needs comprehensive test coverage first.

---

## Deferred Items

**D1 — Linux/Windows cookie import support**
`cookie-import-browser.ts` is macOS-only. Linux (Snap/Flatpak paths, GNOME Keyring/KWallet) and Windows (DPAPI) support is tracked in TODO.md Phase 5 but is a significant effort.

**D2 — Playwright version auto-sync**
Automatically running `playwright install chromium` when the Playwright package version changes (R9) requires a version file comparison in setup. Deferred pending Playwright's own tooling improvements.

**D3 — Binary signing (macOS codesign)**
Signing the 58MB Bun-compiled binary requires an Apple Developer certificate and entitlements. Deferred to a later release when distribution is formalized.

**D4 — Eval sandbox hardening**
Running `eval` in a Worker or vm.Context with restricted globals would harden S4. Deferred because Bun's Worker API is still maturing and the current user base is trusted developers.

**D5 — Rate limiting on `/cookie-picker`**
Low priority for localhost-only tool. Deferred indefinitely unless the tool is ever exposed on a network.

---

## Cross-Repo Items

These findings affect the skill deployment environment (`~/.claude/skills/`) rather than this repo specifically:

**CR1 — Claude Code skill discovery mechanism is undocumented**
How Claude Code loads skills from `~/.claude/skills/` is not documented in this repo or (as far as is visible) in any public Claude Code documentation. The setup script creates symlinks that work in practice, but the contract is implicit.

**CR2 — No standard skill testing framework**
Each skill (ship, review, qa, etc.) is a markdown prompt file. There is no integration test harness that verifies skills produce correct Claude behavior. Testing is entirely manual and ad-hoc.

**CR3 — `openclaw` CLI is an undocumented dependency**
The CLAUDE.md completion step (`openclaw system event`) assumes `openclaw` is installed and on PATH. This is a cross-repo dependency with no documentation of where to get it or what it does.

**CR4 — Multiple gstack instances can conflict on the same machine**
If a user clones gstack to two locations and runs both, they compete for ports 9400–9410 and for `/tmp/browse-server.json`. The `CONDUCTOR_PORT` mechanism addresses this partially but requires manual configuration.

---

## Wave-Based Remediation Plan

### Wave 1 — Critical Bugs & Quick Wins ✅ COMPLETED 2026-03-26

| # | Item | File(s) | Risk | Status |
|---|------|---------|------|--------|
| 1 | Fix ref map clearing on navigation (B1, QW1) | `browser-manager.ts` | Low | ✅ Already implemented via `framenavigated` event |
| 2 | Add `Host` header check to cookie-picker routes (S1, QW3) | `cookie-picker-routes.ts` | Low | ✅ Done |
| 3 | Document state file reset in README (MD3, QW2) | `README.md` | None | ✅ Done |
| 4 | Document `CONDUCTOR_PORT`, `BROWSE_IDLE_TIMEOUT` (MD4, MD6, QW6) | `BROWSER.md` | None | ✅ Already documented |
| 5 | Add `bun.lock` to version control (TD5, QW7) | `.gitignore` | Low | ✅ Done |
| 6 | Add health check at end of setup script (OP1, QW8) | `setup` | Low | ✅ Done |

### Wave 2 — Security Hardening ✅ COMPLETED 2026-03-26

| # | Item | File(s) | Risk | Status |
|---|------|---------|------|--------|
| 1 | Move state file to `$XDG_RUNTIME_DIR` (R2, HR1) | `cli.ts`, `server.ts` | Medium (migration) | ✅ Done |
| 2 | Add error message sanitization (S2) | `cookie-picker-routes.ts` | Low | ✅ Done |
| 3 | Add crash-loop detection with backoff (R1) | `cli.ts` | Medium | ✅ Done |
| 4 | Add macOS-only platform check to cookie skill (R10, MD2) | `setup-browser-cookies/SKILL.md`, `cookie-import-browser.ts` | Low | ✅ Done |
| 5 | Add `--no-verify` warning to README (S3, QW5) | `README.md` | None | ✅ Done |

### Wave 3 — Observability & Reliability ✅ COMPLETED 2026-03-26

| # | Item | File(s) | Risk | Status |
|---|------|---------|------|--------|
| 1 | Enhance `/health` endpoint (O4, QW4) | `server.ts` | Low | ✅ Done — added `buffersDropped` |
| 2 | Add structured logging (O1) | `server.ts` | Low | ✅ Done — `serverLog()` with ISO timestamps + levels |
| 3 | Add request timing to command responses (O2) | `server.ts` | Low | ✅ Done — `X-Duration-Ms` header + server-side log |
| 4 | Fix `stop` command to await flush before exit (B7) | `server.ts`, `meta-commands.ts` | Low | ✅ Already resolved — `shutdown()` awaits `flushBuffers()` |
| 5 | Fix idle timeout to exclude `/health` requests (R12) | `server.ts` | Low | ✅ Done — `/health` no longer resets idle timer |
| 6 | Add crash log file (O5) | `browser-manager.ts`, `server.ts` | Low | ✅ Done — appends to `browse-crashes.log` on disconnect |

### Wave 4 — Test Coverage ✅ COMPLETED 2026-03-27

| # | Item | Files | Status |
|---|------|-------|--------|
| 1 | Path traversal prevention tests (MT1) | `browse/test/commands.test.ts` | ✅ Already done (PR #26) |
| 2 | Auth token enforcement tests (MT2) | `browse/test/auth.test.ts` | ✅ Done — 401/200/case-sensitivity/health |
| 3 | Ref-map staleness after navigation tests (MT4) | `browse/test/snapshot.test.ts` | ✅ Already done (Ref invalidation block) |
| 4 | `chain` malformed input tests (MT5) | `browse/test/commands.test.ts` | ✅ Done — non-array JSON, empty array, per-step errors |
| 5 | Idle timeout test with short `BROWSE_IDLE_TIMEOUT` (MT7) | `browse/test/auth.test.ts` | ✅ Done — BROWSE_IDLE_CHECK_MS added to server.ts |
| 6 | `diff` URL restoration test (MT8) | `browse/test/commands.test.ts` | ✅ Done — documents browser-left-on-url2 behavior |
| 7 | snapshot.ts unit tests for ref assignment algorithm (TD1) | `browse/test/snapshot.test.ts` | ✅ Done — duplicate-refs fixture + 5 algorithm tests |

### Wave 5 — Tech Debt & Architecture (2–4 weeks)

| # | Item | Risk |
|---|------|------|
| 1 | Use `port: 0` for automatic port assignment (SI2, OP5) | Medium |
| 2 | Decompose `browser-manager.ts` into focused modules (TD2, HR4) | High |
| 3 | Separate HTTP routing from server.ts (TD4) | Medium |
| 4 | Make PBKDF2 parameters named constants (TD3) | Low |
| 5 | Add skill version compatibility matrix (TD6) | Medium |
| 6 | Remove unused `CircularBuffer.get/set` public API (SI4) | Low |

### Wave 6 — Long-Horizon (Deferred)

| # | Item |
|---|------|
| 1 | Linux/Windows cookie import support (D1) |
| 2 | Playwright version auto-sync in setup (D2, R9) |
| 3 | Binary signing for distribution (D3) |
| 4 | Eval sandbox via Worker/vm.Context (D4) |
| 5 | Standard skill integration test harness (CR2) |

---

*Generated by Mega Resiliency Audit process — gstack v0.3.1 — 2026-03-26*
