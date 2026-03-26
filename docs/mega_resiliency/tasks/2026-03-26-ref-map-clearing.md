# Wave 1 Task: Ref Map Clearing on Navigation (B1, QW1)

**Date:** 2026-03-26
**Status:** Already implemented — no code change required
**Audit items:** B1, QW1

## Finding

Bug B1 described that the ref map was never cleared on navigation, leaving stale Playwright
Locators in memory after `goto`/`back`/`forward`/`reload`.

## Current state

`browser-manager.ts` `wirePageEvents()` (lines 374–379) already handles this via Playwright's
`framenavigated` event:

```typescript
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) {
    this.clearRefs();
  }
});
```

This is superior to the QW1 suggestion (explicit calls per command in `write-commands.ts`) because
it also catches redirects, JS-triggered navigation, and any other navigation source that
does not go through the write-command handlers.

## Outcome

No change needed. Marked complete.
