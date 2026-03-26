# Wave 1 Task: Host Header Check on Cookie-Picker Routes (S1, QW3)

**Date:** 2026-03-26
**Status:** Implemented
**Audit items:** S1, QW3, R4

## Finding

The `/cookie-picker/*` routes had no authentication and relied solely on "localhost-only" as
protection. DNS rebinding attacks could trick a browser into making cross-origin requests to
`127.0.0.1:9400`, allowing a malicious web page to inject cookies into the active session.

## Change

Added a `Host` header check at the top of `handleCookiePickerRoute` in
`browse/src/cookie-picker-routes.ts`:

```typescript
// DNS rebinding protection: reject requests whose Host header isn't localhost/127.0.0.1
const host = req.headers.get('host') || '';
if (!host.startsWith('localhost:') && !host.startsWith('127.0.0.1:')) {
  return new Response('Forbidden', { status: 403 });
}
```

This check runs before all routes including CORS preflight, ensuring that requests with a
spoofed `Host` header (as used in DNS rebinding) are rejected immediately.

## Why this is safe for the cookie picker UI

The cookie picker UI is opened by the CLI with `Bun.spawn(['open', pickerUrl])` where `pickerUrl`
is `http://127.0.0.1:<port>/cookie-picker`. The system browser will send `Host: 127.0.0.1:<port>`,
which passes the check. No user-facing behavior changes.

## Risk

Low. Could break curl-based testing that doesn't set a Host header (e.g., `curl localhost:9400/cookie-picker`
without `-H "Host: localhost:9400"`). Standard browser requests are unaffected.
