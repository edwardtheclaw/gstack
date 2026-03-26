# Wave 2.4 — macOS-Only Platform Check for Cookie Import (R10, MD2)

**Date:** 2026-03-26
**Status:** ✅ Done
**Risk items:** R10, MD2

## Problem

`cookie-import-browser.ts` hardcodes `~/Library/Application Support` paths and macOS Keychain
(`security find-generic-password`) for all cookie decryption. On Linux or Windows it would
crash with an opaque error (file not found, command not found, etc.) with no hint to the user
that the feature is macOS-only.

The `setup-browser-cookies` SKILL.md made no mention of this platform restriction.

## Fix

Added `requireMacOS()` guard function to `cookie-import-browser.ts`:
- Throws `CookieImportError('...', 'platform_unsupported')` when `process.platform !== 'darwin'`
- Called at the top of `findInstalledBrowsers()`, `listDomains()`, and `importCookies()`
- Error message explains the limitation and points users to `browse cookie-import <json-file>`
  as the cross-platform alternative

Updated `setup-browser-cookies/SKILL.md`:
- Added `macOS only` to the skill description frontmatter
- Added a prominent blockquote warning at the top of the skill body

## Files Changed

- `browse/src/cookie-import-browser.ts`
- `setup-browser-cookies/SKILL.md`
