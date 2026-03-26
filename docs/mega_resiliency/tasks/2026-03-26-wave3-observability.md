# Wave 3 — Observability (O1, O2, O4, O5, QW4)

**Date:** 2026-03-26
**Status:** Done

## Changes

### buffers.ts
- Added `totalDropped` getter to `CircularBuffer<T>` — returns `max(0, totalAdded - capacity)`, the count of entries silently overwritten due to overflow. Satisfies O3/QW4 prerequisite.

### browser-manager.ts
- Added `public crashLogPath: string = ''` property.
- In `'disconnected'` handler: appends a timestamped crash event to `crashLogPath` (if set) before exiting. Satisfies O5.
- Added `import * as fs from 'fs'` for `appendFileSync`.

### server.ts
- Added `CRASH_LOG_PATH` constant: `${STATE_DIR}/browse-crashes${INSTANCE_SUFFIX}.log`.
- Added `serverLog(level, message)` structured logging helper — all server-level logs now include ISO timestamps and level tags (e.g. `[2026-03-26T…] [browse:INFO] …`). Satisfies O1.
- Sets `browserManager.crashLogPath = CRASH_LOG_PATH` after start. Satisfies O5.
- `/health` endpoint now includes `buffersDropped: { console, network, dialog }`. Satisfies O4 / QW4.
- `/command` route: measures `durationMs`, logs it via `serverLog`, and returns it as `X-Duration-Ms` response header. Satisfies O2.
