/**
 * WebSocket message types for live browse streaming
 *
 * Design: The browse server exposes a /ws endpoint that streams
 * page state (screenshots, DOM snapshots) to connected clients.
 * This enables pair browsing where AI agent and human see the
 * same browser in real-time.
 *
 * Architecture:
 *   - Server pushes updates on navigation, DOM mutation, or timer
 *   - Client can send control messages (navigate, click, etc.)
 *   - Binary frames for screenshots, text frames for snapshots/events
 */

// ─── Server → Client Messages ──────────────────────────────

/** Screenshot update (sent as binary frame, prefixed with metadata) */
export interface ScreenshotMessage {
  type: 'screenshot';
  timestamp: number;
  width: number;
  height: number;
  format: 'png' | 'jpeg';
  /** Base64-encoded image data (text frame) or raw bytes (binary frame) */
  data?: string;
}

/** DOM snapshot update */
export interface SnapshotMessage {
  type: 'snapshot';
  timestamp: number;
  url: string;
  title: string;
  /** Accessibility tree or simplified DOM */
  content: string;
  /** Format of the content field */
  format: 'accessibility' | 'html' | 'text';
}

/** Navigation event */
export interface NavigationMessage {
  type: 'navigation';
  timestamp: number;
  url: string;
  status: number;
}

/** Console log from page */
export interface ConsoleMessage {
  type: 'console';
  timestamp: number;
  level: 'log' | 'warn' | 'error' | 'info';
  text: string;
}

/** Dialog appeared (alert/confirm/prompt) */
export interface DialogMessage {
  type: 'dialog';
  timestamp: number;
  dialogType: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
}

/** Server status/error */
export interface StatusMessage {
  type: 'status';
  timestamp: number;
  state: 'connected' | 'disconnected' | 'error' | 'idle';
  message?: string;
}

export type ServerMessage =
  | ScreenshotMessage
  | SnapshotMessage
  | NavigationMessage
  | ConsoleMessage
  | DialogMessage
  | StatusMessage;

// ─── Client → Server Messages ──────────────────────────────

/** Execute a browse command remotely */
export interface CommandRequest {
  type: 'command';
  id: string;
  command: string;
  args: string[];
}

/** Response to a command request */
export interface CommandResponse {
  type: 'command_response';
  id: string;
  success: boolean;
  result?: string;
  error?: string;
}

/** Request a screenshot on demand */
export interface ScreenshotRequest {
  type: 'screenshot_request';
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
}

/** Request a snapshot on demand */
export interface SnapshotRequest {
  type: 'snapshot_request';
  format?: 'accessibility' | 'html' | 'text';
}

/** Configure streaming settings */
export interface StreamConfig {
  type: 'stream_config';
  /** Auto-send screenshots on navigation (default: true) */
  screenshotOnNav?: boolean;
  /** Auto-send snapshots on navigation (default: true) */
  snapshotOnNav?: boolean;
  /** Periodic screenshot interval in ms (0 = disabled, default: 0) */
  screenshotInterval?: number;
  /** Screenshot format (default: jpeg for bandwidth) */
  screenshotFormat?: 'png' | 'jpeg';
  /** JPEG quality 1-100 (default: 60) */
  screenshotQuality?: number;
}

export type ClientMessage =
  | CommandRequest
  | ScreenshotRequest
  | SnapshotRequest
  | StreamConfig;

// ─── WebSocket Server Integration Notes ─────────────────────
//
// Integration with server.ts:
//
// 1. Add WebSocket upgrade handler to Bun.serve:
//    ```
//    websocket: {
//      open(ws) { clients.add(ws); sendStatus(ws, 'connected'); },
//      close(ws) { clients.delete(ws); },
//      message(ws, msg) { handleClientMessage(ws, JSON.parse(msg)); },
//    }
//    ```
//
// 2. In the fetch handler, check for upgrade:
//    ```
//    if (url.pathname === '/ws') {
//      if (server.upgrade(req)) return;
//      return new Response('WebSocket upgrade failed', { status: 400 });
//    }
//    ```
//
// 3. Hook into BrowserManager events:
//    - page.on('framenavigated') → broadcast NavigationMessage
//    - page.on('console') → broadcast ConsoleMessage
//    - page.on('dialog') → broadcast DialogMessage
//    - After each write command → optionally broadcast screenshot + snapshot
//
// 4. Auth: Require the same Bearer token as HTTP API.
//    Pass token as query param: /ws?token=<auth-token>
//
// 5. Binary frames for screenshots (efficient), text frames for everything else.
