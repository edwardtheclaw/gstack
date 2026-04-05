# gstack - Claude Code Work Queue

> **What this is:** Self-contained task list for a Claude Code session. Read CLAUDE.md first.

## Project Context

- **Repo:** `/root/projects/gstack`
- **Stack:** TypeScript, Bun, Playwright
- **Binary:** `browse/dist/browse` (headless browser CLI)
- **Tests:** `bun test` runs integration tests
- **Active skill path:** `~/.claude/skills/gstack/`

## Architecture

The `browse/` directory is the main CLI:
- `browse/src/server.ts` - HTTP + WebSocket server
- `browse/src/commands/` - CLI command handlers
- `browse/src/session-manager.ts` - browser session management
- `browse/src/vault.ts` - encrypted credential vault
- `browse/src/snapshot.ts` - DOM snapshot + screenshot generation

Already completed: sessions, state save/load, vault, iframe support, device emulation, network mocking, CDP mode, WebSocket streaming.

---

## Task 1: T265 - Session Model + Data Structures

**Status:** `browse/src/session-manager.ts` already exists from T266 (session commands). 

**Check:** Is the data model complete? Does it have:
- Named BrowserContext instances with isolated cookies/storage
- Create/get/list/destroy methods
- Proper cleanup on destroy

If already complete, mark as done. If gaps exist, fill them.

---

## Task 2: T268 - State Save Command

**Goal:** `state save <file>` exports current page cookies and localStorage to a JSON file.

**Check:** `browse/src/commands/` for existing state commands. T269 (state load) is done, so state save likely exists too.

If it exists, verify it works. If not, implement:
- Get all cookies via `context.cookies()`
- Get localStorage via `page.evaluate(() => JSON.stringify(localStorage))`
- Write to JSON file with structure: `{cookies: [...], localStorage: {...}, url: "...", savedAt: "..."}`

---

## Task 3: T140 - WebSocket Live Preview (Streaming)

**Context:** T278-T280 (WebSocket server, endpoint, screenshot/snapshot streaming) are already done.

**Goal:** Make the streaming useful for pair browsing: AI agent and human see the same browser.

**Check current state:**
- Does `/ws` endpoint work?
- Does it stream screenshots and DOM snapshots?
- Is there a client-side viewer?

**If basic streaming works but needs polish:**
- Add configurable frame rate (default 2fps for screenshots)
- Add event forwarding (clicks, navigation) from client to server
- Add a simple HTML viewer page that connects to `/ws` and displays the stream

---

## Task 4: T113 / T132 - Video Recording

**Context:** Deferred from earlier phases because `recreateContext` destroys page state. Now that sessions exist (T266), recording should work within a session lifecycle.

**Goal:** Add `record start` and `record stop` commands.

**Implementation:**
- Use Playwright's `context.newPage()` + `page.video()` API
- `record start [filename]` - start recording current page
- `record stop` - stop recording, save to file
- Recording is per-session (tied to the session's BrowserContext)
- Output format: WebM

**Caveat:** Playwright video recording must be enabled at context creation time. This means either:
1. Always enable video (wasteful), or
2. Create a new context with video enabled when `record start` is called (loses current page state)

Document whichever approach you choose and its tradeoffs.

---

## Task 5: T142 - Linux Cookie Decryption

**Goal:** Add Linux cookie decryption support (GNOME Keyring / kwallet).

**Context:** The vault already supports Chrome cookie import on macOS. This extends it to Linux.

**Linux Chrome cookies are encrypted with:**
- GNOME Keyring (most common): AES-CBC with key from `secret-tool lookup xdg:schema chrome_libsecret_os_crypt_password_v2`
- kwallet (KDE): similar but via kwallet API

**Implementation:**
- Detect Linux desktop environment
- Use `secret-tool` CLI to retrieve the decryption key
- Decrypt cookies using the same AES approach as macOS but with Linux-specific key derivation
- Add to existing cookie import flow

---

## General Rules

- `bun install` then `bun test` to verify
- `bun run build` to compile binary
- After changes, rebuild: `bun run build`
- Commit: `feat(T###): description`
