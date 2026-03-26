# Wave 2.2 — Error Message Sanitization (S2)

**Date:** 2026-03-26
**Status:** ✅ Done
**Risk items:** S2

## Problem

`cookie-picker-routes.ts` caught errors and returned `err.message` verbatim in the HTTP response.
Node.js filesystem errors (ENOENT, EPERM, etc.) include full absolute paths in their messages,
e.g. `ENOENT: no such file, open '/Users/alice/Library/Application Support/...'`.
This leaks the user's home directory structure to any caller of the route.

## Fix

Added `sanitizeError(msg)` helper that replaces `$HOME` with `~` in error strings before they are
returned in HTTP responses. Console logging still uses the unsanitised message for debugging.

## Files Changed

- `browse/src/cookie-picker-routes.ts`
