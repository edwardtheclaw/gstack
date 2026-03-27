/**
 * gstack browse server — persistent Chromium daemon
 *
 * Architecture:
 *   Bun.serve HTTP on localhost → routes commands to Playwright
 *   Console/network/dialog buffers: CircularBuffer in-memory + async disk flush
 *   Chromium crash → server EXITS with clear error (CLI auto-restarts)
 *   Auto-shutdown after BROWSE_IDLE_TIMEOUT (default 30 min)
 */

import { BrowserManager } from './browser-manager';
import { handleReadCommand } from './read-commands';
import { handleWriteCommand } from './write-commands';
import { handleMetaCommand } from './meta-commands';
import { handleCookiePickerRoute } from './cookie-picker-routes';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── Auth (inline) ─────────────────────────────────────────────
const AUTH_TOKEN = crypto.randomUUID();
const PORT_OFFSET = 45600;
const BROWSE_PORT = process.env.CONDUCTOR_PORT
  ? parseInt(process.env.CONDUCTOR_PORT, 10) - PORT_OFFSET
  : parseInt(process.env.BROWSE_PORT || '0', 10); // 0 = auto-scan
const INSTANCE_SUFFIX = BROWSE_PORT ? `-${BROWSE_PORT}` : '';

/**
 * Resolve the state file directory in order of preference:
 *   1. $XDG_RUNTIME_DIR  (Linux: /run/user/1000, mode 0700, owned by user)
 *   2. $TMPDIR           (macOS: /var/folders/…/T, user-specific)
 *   3. /tmp              (legacy fallback)
 *
 * Using a user-owned directory prevents other local users from reading
 * the auth token via /tmp on shared-tmpfs configurations (R2).
 */
function resolveStateDir(): string {
  if (process.env.XDG_RUNTIME_DIR) return process.env.XDG_RUNTIME_DIR;
  if (process.env.TMPDIR) return process.env.TMPDIR;
  return '/tmp';
}

const STATE_DIR = resolveStateDir();
const STATE_FILE = process.env.BROWSE_STATE_FILE || `${STATE_DIR}/browse-server${INSTANCE_SUFFIX}.json`;
const CRASH_LOG_PATH = `${STATE_DIR}/browse-crashes${INSTANCE_SUFFIX}.log`;
const IDLE_TIMEOUT_MS = parseInt(process.env.BROWSE_IDLE_TIMEOUT || '1800000', 10); // 30 min
const IDLE_CHECK_MS = parseInt(process.env.BROWSE_IDLE_CHECK_MS || '60000', 10); // check interval

// ─── Structured Logging (O1) ────────────────────────────────
function serverLog(level: 'INFO' | 'WARN' | 'ERROR', message: string) {
  const ts = new Date().toISOString();
  const out = level === 'ERROR' ? console.error : console.log;
  out(`[${ts}] [browse:${level}] ${message}`);
}

function validateAuth(req: Request): boolean {
  const header = req.headers.get('authorization');
  return header === `Bearer ${AUTH_TOKEN}`;
}

// ─── Buffer (from buffers.ts) ────────────────────────────────────
import { consoleBuffer, networkBuffer, dialogBuffer, addConsoleEntry, addNetworkEntry, addDialogEntry, type LogEntry, type NetworkEntry, type DialogEntry } from './buffers';
export { consoleBuffer, networkBuffer, dialogBuffer, addConsoleEntry, addNetworkEntry, addDialogEntry, type LogEntry, type NetworkEntry, type DialogEntry };

const CONSOLE_LOG_PATH = `${STATE_DIR}/browse-console${INSTANCE_SUFFIX}.log`;
const NETWORK_LOG_PATH = `${STATE_DIR}/browse-network${INSTANCE_SUFFIX}.log`;
const DIALOG_LOG_PATH = `${STATE_DIR}/browse-dialog${INSTANCE_SUFFIX}.log`;
let lastConsoleFlushed = 0;
let lastNetworkFlushed = 0;
let lastDialogFlushed = 0;
let flushInProgress = false;

async function flushBuffers() {
  if (flushInProgress) return; // Guard against concurrent flush
  flushInProgress = true;

  try {
    // Console buffer
    const newConsoleCount = consoleBuffer.totalAdded - lastConsoleFlushed;
    if (newConsoleCount > 0) {
      const entries = consoleBuffer.last(Math.min(newConsoleCount, consoleBuffer.length));
      const lines = entries.map(e =>
        `[${new Date(e.timestamp).toISOString()}] [${e.level}] ${e.text}`
      ).join('\n') + '\n';
      await Bun.write(CONSOLE_LOG_PATH, (await Bun.file(CONSOLE_LOG_PATH).text().catch(() => '')) + lines);
      lastConsoleFlushed = consoleBuffer.totalAdded;
    }

    // Network buffer
    const newNetworkCount = networkBuffer.totalAdded - lastNetworkFlushed;
    if (newNetworkCount > 0) {
      const entries = networkBuffer.last(Math.min(newNetworkCount, networkBuffer.length));
      const lines = entries.map(e =>
        `[${new Date(e.timestamp).toISOString()}] ${e.method} ${e.url} → ${e.status || 'pending'} (${e.duration || '?'}ms, ${e.size || '?'}B)`
      ).join('\n') + '\n';
      await Bun.write(NETWORK_LOG_PATH, (await Bun.file(NETWORK_LOG_PATH).text().catch(() => '')) + lines);
      lastNetworkFlushed = networkBuffer.totalAdded;
    }

    // Dialog buffer
    const newDialogCount = dialogBuffer.totalAdded - lastDialogFlushed;
    if (newDialogCount > 0) {
      const entries = dialogBuffer.last(Math.min(newDialogCount, dialogBuffer.length));
      const lines = entries.map(e =>
        `[${new Date(e.timestamp).toISOString()}] [${e.type}] "${e.message}" → ${e.action}${e.response ? ` "${e.response}"` : ''}`
      ).join('\n') + '\n';
      await Bun.write(DIALOG_LOG_PATH, (await Bun.file(DIALOG_LOG_PATH).text().catch(() => '')) + lines);
      lastDialogFlushed = dialogBuffer.totalAdded;
    }
  } catch {
    // Flush failures are non-fatal — buffers are in memory
  } finally {
    flushInProgress = false;
  }
}

// Flush every 1 second
const flushInterval = setInterval(flushBuffers, 1000);

// ─── Idle Timer ────────────────────────────────────────────────
let lastActivity = Date.now();

function resetIdleTimer() {
  lastActivity = Date.now();
}

const idleCheckInterval = setInterval(() => {
  if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
    serverLog('INFO', `Idle for ${IDLE_TIMEOUT_MS / 1000}s, shutting down`);
    shutdown();
  }
}, IDLE_CHECK_MS);

// ─── Command Sets (exported for chain command) ──────────────────
export const READ_COMMANDS = new Set([
  'text', 'html', 'links', 'forms', 'accessibility', 'a11y',
  'js', 'eval', 'css', 'attrs',
  'console', 'network', 'cookies', 'storage', 'perf',
  'dialog', 'is',
]);

export const WRITE_COMMANDS = new Set([
  'goto', 'back', 'forward', 'reload',
  'click', 'fill', 'select', 'hover', 'type', 'press', 'scroll', 'wait',
  'viewport', 'cookie', 'cookie-import', 'cookie-import-browser', 'header', 'useragent',
  'upload', 'dialog-accept', 'dialog-dismiss',
  'form-fill',
]);

export const META_COMMANDS = new Set([
  'tabs', 'tab', 'newtab', 'closetab',
  'status', 'stop', 'restart',
  'screenshot', 'pdf', 'responsive',
  'chain', 'diff',
  'url', 'snapshot',
]);

// ─── Server ────────────────────────────────────────────────────
const browserManager = new BrowserManager();
let isShuttingDown = false;

// Find port: deterministic from CONDUCTOR_PORT, or scan range
async function findPort(): Promise<number> {
  // Deterministic port from CONDUCTOR_PORT (e.g., 55040 - 45600 = 9440)
  if (BROWSE_PORT) {
    try {
      const testServer = Bun.serve({ port: BROWSE_PORT, fetch: () => new Response('ok') });
      testServer.stop();
      return BROWSE_PORT;
    } catch {
      throw new Error(`[browse] Port ${BROWSE_PORT} (from CONDUCTOR_PORT ${process.env.CONDUCTOR_PORT}) is in use`);
    }
  }

  // Fallback: scan range
  const start = parseInt(process.env.BROWSE_PORT_START || '9400', 10);
  for (let port = start; port < start + 10; port++) {
    try {
      const testServer = Bun.serve({ port, fetch: () => new Response('ok') });
      testServer.stop();
      return port;
    } catch {
      continue;
    }
  }
  throw new Error(`[browse] No available port in range ${start}-${start + 9}`);
}

/**
 * Translate Playwright errors into actionable messages for AI agents.
 */
function wrapError(err: any): string {
  const msg = err.message || String(err);
  // Timeout errors
  if (err.name === 'TimeoutError' || msg.includes('Timeout') || msg.includes('timeout')) {
    if (msg.includes('locator.click') || msg.includes('locator.fill') || msg.includes('locator.hover')) {
      return `Element not found or not interactable within timeout. Check your selector or run 'snapshot' for fresh refs.`;
    }
    if (msg.includes('page.goto') || msg.includes('Navigation')) {
      return `Page navigation timed out. The URL may be unreachable or the page may be loading slowly.`;
    }
    return `Operation timed out: ${msg.split('\n')[0]}`;
  }
  // Multiple elements matched
  if (msg.includes('resolved to') && msg.includes('elements')) {
    return `Selector matched multiple elements. Be more specific or use @refs from 'snapshot'.`;
  }
  // Pass through other errors
  return msg;
}

async function handleCommand(body: any): Promise<Response> {
  const { command, args = [] } = body;

  if (!command) {
    return new Response(JSON.stringify({ error: 'Missing "command" field' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let result: string;

    if (READ_COMMANDS.has(command)) {
      result = await handleReadCommand(command, args, browserManager);
    } else if (WRITE_COMMANDS.has(command)) {
      result = await handleWriteCommand(command, args, browserManager);
    } else if (META_COMMANDS.has(command)) {
      result = await handleMetaCommand(command, args, browserManager, shutdown);
    } else {
      return new Response(JSON.stringify({
        error: `Unknown command: ${command}`,
        hint: `Available commands: ${[...READ_COMMANDS, ...WRITE_COMMANDS, ...META_COMMANDS].sort().join(', ')}`,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(result, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: wrapError(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  serverLog('INFO', 'Shutting down...');
  clearInterval(flushInterval);
  clearInterval(idleCheckInterval);
  await flushBuffers(); // Final flush (async now)

  // Failsafe: force exit if browser.close() hangs (e.g. Playwright WebSocket stall)
  const forceExit = setTimeout(() => {
    serverLog('WARN', 'Shutdown timed out — forcing exit');
    try { fs.unlinkSync(STATE_FILE); } catch {}
    process.exit(0);
  }, 8000);
  if (typeof (forceExit as any).unref === 'function') (forceExit as any).unref();

  await browserManager.close();
  clearTimeout(forceExit);

  // Clean up state file
  try { fs.unlinkSync(STATE_FILE); } catch {}

  process.exit(0);
}

// Handle signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Start ─────────────────────────────────────────────────────
async function start() {
  // Clear old log files
  try { fs.unlinkSync(CONSOLE_LOG_PATH); } catch {}
  try { fs.unlinkSync(NETWORK_LOG_PATH); } catch {}
  try { fs.unlinkSync(DIALOG_LOG_PATH); } catch {}

  const port = await findPort();

  // Launch browser
  await browserManager.launch();

  const startTime = Date.now();
  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    fetch: async (req) => {
      const url = new URL(req.url);

      // Cookie picker routes — no auth required (localhost-only)
      // Reset idle timer for interactive routes
      if (url.pathname.startsWith('/cookie-picker')) {
        resetIdleTimer();
        return handleCookiePickerRoute(url, req, browserManager);
      }

      // Health check — no auth required, does NOT reset idle timer (R12)
      if (url.pathname === '/health') {
        const healthy = await browserManager.isHealthy();
        return new Response(JSON.stringify({
          status: healthy ? 'healthy' : 'unhealthy',
          uptime: Math.floor((Date.now() - startTime) / 1000),
          tabs: browserManager.getTabCount(),
          currentUrl: browserManager.getCurrentUrl(),
          buffersDropped: {
            console: consoleBuffer.totalDropped,
            network: networkBuffer.totalDropped,
            dialog: dialogBuffer.totalDropped,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // All other endpoints require auth and reset idle timer
      resetIdleTimer();

      if (!validateAuth(req)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/command' && req.method === 'POST') {
        const body = await req.json();
        const t0 = Date.now();
        const response = await handleCommand(body);
        const durationMs = Date.now() - t0;
        serverLog('INFO', `command=${body.command} status=${response.status} duration=${durationMs}ms`);
        // Add timing header without mutating the original Response
        const headers = new Headers(response.headers);
        headers.set('X-Duration-Ms', String(durationMs));
        return new Response(response.body, { status: response.status, headers });
      }

      return new Response('Not found', { status: 404 });
    },
  });

  // Write state file
  const state = {
    pid: process.pid,
    port,
    token: AUTH_TOKEN,
    startedAt: new Date().toISOString(),
    serverPath: path.resolve(import.meta.dir, 'server.ts'),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });

  browserManager.serverPort = port;
  browserManager.crashLogPath = CRASH_LOG_PATH;
  serverLog('INFO', `Server running on http://127.0.0.1:${port} (PID: ${process.pid})`);
  serverLog('INFO', `State file: ${STATE_FILE}`);
  serverLog('INFO', `Crash log: ${CRASH_LOG_PATH}`);
  serverLog('INFO', `Idle timeout: ${IDLE_TIMEOUT_MS / 1000}s`);
}

start().catch((err) => {
  const ts = new Date().toISOString();
  console.error(`[${ts}] [browse:ERROR] Failed to start: ${err.message}`);
  process.exit(1);
});
