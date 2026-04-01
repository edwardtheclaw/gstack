/**
 * gstack CLI — thin wrapper that talks to the persistent server
 *
 * Flow:
 *   1. Read /tmp/browse-server.json for port + token
 *   2. If missing or stale PID → start server in background
 *   3. Health check
 *   4. Send command via HTTP POST
 *   5. Print response to stdout (or stderr for errors)
 */

import * as fs from 'fs';
import * as path from 'path';

const PORT_OFFSET = 45600;
const BROWSE_PORT = process.env.CONDUCTOR_PORT
  ? parseInt(process.env.CONDUCTOR_PORT, 10) - PORT_OFFSET
  : parseInt(process.env.BROWSE_PORT || '0', 10);
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

const STATE_FILE = process.env.BROWSE_STATE_FILE || `${resolveStateDir()}/browse-server${INSTANCE_SUFFIX}.json`;
const MAX_START_WAIT = 8000; // 8 seconds to start

// ─── Crash-loop Detection ──────────────────────────────────────
// Tracks recent restart timestamps in a temp file to detect fast crash loops.
// If the server has crashed N times within a short window, we add backoff and
// eventually give up rather than hammering a broken binary (R1).

const CRASH_LOG_FILE = process.env.BROWSE_CRASH_LOG || `${resolveStateDir()}/browse-crashes${INSTANCE_SUFFIX}.json`;
const CRASH_WINDOW_MS = 60_000; // 60-second window
const CRASH_MAX_IN_WINDOW = 3;  // Give up after 3 crashes within the window

interface CrashLog {
  timestamps: number[];
}

function readCrashLog(): CrashLog {
  try {
    return JSON.parse(fs.readFileSync(CRASH_LOG_FILE, 'utf-8'));
  } catch {
    return { timestamps: [] };
  }
}

function recordCrash(): { count: number; backoffMs: number } {
  const now = Date.now();
  const log = readCrashLog();
  // Prune entries outside the window
  log.timestamps = log.timestamps.filter(t => now - t < CRASH_WINDOW_MS);
  log.timestamps.push(now);
  try {
    fs.writeFileSync(CRASH_LOG_FILE, JSON.stringify(log), { mode: 0o600 });
  } catch {}
  const count = log.timestamps.length;
  // Exponential backoff: 1s, 2s, 4s…
  const backoffMs = Math.min(1000 * Math.pow(2, count - 1), 8000);
  return { count, backoffMs };
}

function clearCrashLog(): void {
  try { fs.unlinkSync(CRASH_LOG_FILE); } catch {}
}

export function resolveServerScript(
  env: Record<string, string | undefined> = process.env,
  metaDir: string = import.meta.dir,
  execPath: string = process.execPath
): string {
  if (env.BROWSE_SERVER_SCRIPT) {
    return env.BROWSE_SERVER_SCRIPT;
  }

  // Dev mode: cli.ts runs directly from browse/src
  if (metaDir.startsWith('/') && !metaDir.includes('$bunfs')) {
    const direct = path.resolve(metaDir, 'server.ts');
    if (fs.existsSync(direct)) {
      return direct;
    }
  }

  // Compiled binary: derive the source tree from browse/dist/browse
  if (execPath) {
    const adjacent = path.resolve(path.dirname(execPath), '..', 'src', 'server.ts');
    if (fs.existsSync(adjacent)) {
      return adjacent;
    }
  }

  // Legacy fallback for user-level installs
  return path.resolve(env.HOME || '/tmp', '.claude/skills/gstack/browse/src/server.ts');
}

const SERVER_SCRIPT = resolveServerScript();

interface ServerState {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
  serverPath: string;
}

// ─── State File ────────────────────────────────────────────────
function readState(): ServerState | null {
  try {
    const data = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── Server Lifecycle ──────────────────────────────────────────
async function startServer(): Promise<ServerState> {
  // Clean up stale state file
  try { fs.unlinkSync(STATE_FILE); } catch {}

  // Start server as detached background process
  const proc = Bun.spawn(['bun', 'run', SERVER_SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  // Don't hold the CLI open
  proc.unref();

  // Wait for state file to appear
  const start = Date.now();
  while (Date.now() - start < MAX_START_WAIT) {
    const state = readState();
    if (state && isProcessAlive(state.pid)) {
      return state;
    }
    await Bun.sleep(100);
  }

  // If we get here, server didn't start in time
  // Try to read stderr for error message
  const stderr = proc.stderr;
  if (stderr) {
    const reader = stderr.getReader();
    const { value } = await reader.read();
    if (value) {
      const errText = new TextDecoder().decode(value);
      throw new Error(`Server failed to start:\n${errText}`);
    }
  }
  throw new Error(`Server failed to start within ${MAX_START_WAIT / 1000}s`);
}

async function ensureServer(): Promise<ServerState> {
  const state = readState();

  if (state && isProcessAlive(state.pid)) {
    // Server appears alive — do a health check
    try {
      const resp = await fetch(`http://127.0.0.1:${state.port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const health = await resp.json() as any;
        if (health.status === 'healthy') {
          return state;
        }
      }
    } catch {
      // Health check failed — server is dead or unhealthy
    }
  }

  // Need to (re)start
  console.error('[browse] Starting server...');
  return startServer();
}

// ─── Command Dispatch ──────────────────────────────────────────
async function sendCommand(state: ServerState, command: string, args: string[], retries = 0): Promise<void> {
  const body = JSON.stringify({ command, args });

  try {
    const resp = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      body,
      signal: AbortSignal.timeout(30000),
    });

    if (resp.status === 401) {
      // Token mismatch — server may have restarted
      console.error('[browse] Auth failed — server may have restarted. Retrying...');
      const newState = readState();
      if (newState && newState.token !== state.token) {
        return sendCommand(newState, command, args);
      }
      throw new Error('Authentication failed');
    }

    const text = await resp.text();

    if (resp.ok) {
      process.stdout.write(text);
      if (!text.endsWith('\n')) process.stdout.write('\n');
    } else {
      // Try to parse as JSON error
      try {
        const err = JSON.parse(text);
        console.error(err.error || text);
        if (err.hint) console.error(err.hint);
      } catch {
        console.error(text);
      }
      process.exit(1);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.error('[browse] Command timed out after 30s');
      process.exit(1);
    }
    // Connection error — server may have crashed
    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.message?.includes('fetch failed')) {
      const { count, backoffMs } = recordCrash();
      if (count > CRASH_MAX_IN_WINDOW) {
        throw new Error(
          `[browse] Server has crashed ${count} times in the last ${CRASH_WINDOW_MS / 1000}s — aborting. ` +
          `Check for GPU/memory issues or run 'browse status' once the server is stable.`
        );
      }
      console.error(`[browse] Server connection lost (crash #${count}). Waiting ${backoffMs}ms before restart...`);
      await Bun.sleep(backoffMs);
      const newState = await startServer();
      // On success, clear the crash log so future crashes start fresh
      clearCrashLog();
      return sendCommand(newState, command, args, retries + 1);
    }
    throw err;
  }
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  // Handle --cdp flag: set CDP endpoint for server
  const cdpIdx = args.indexOf('--cdp');
  if (cdpIdx !== -1 && cdpIdx + 1 < args.length) {
    process.env.BROWSE_CDP_ENDPOINT = args[cdpIdx + 1];
    args.splice(cdpIdx, 2);
  }

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`gstack browse — Fast headless browser for AI coding agents

Usage: browse <command> [args...]

Navigation:     goto <url> | back | forward | reload | url
Content:        text | html [sel] | links | forms | accessibility
Interaction:    click <sel> | fill <sel> <val> | select <sel> <val>
                hover <sel> | type <text> | press <key>
                scroll [sel] | wait <sel|--networkidle|--load> | viewport <WxH>
                upload <sel> <file1> [file2...]
                cookie-import <json-file>
                cookie-import-browser [browser] [--domain <d>]
Inspection:     js <expr> | eval <file> | css <sel> <prop> | attrs <sel>
                console [--clear|--errors] | network [--clear] | dialog [--clear]
                cookies | storage [set <k> <v>] | perf
                is <prop> <sel> (visible|hidden|enabled|disabled|checked|editable|focused)
Visual:         screenshot [path] | pdf [path] | responsive [prefix]
Snapshot:       snapshot [-i] [-c] [-d N] [-s sel] [-D] [-a] [-o path] [-C]
                -D/--diff: diff against previous snapshot
                -a/--annotate: annotated screenshot with ref labels
                -C/--cursor-interactive: find non-ARIA clickable elements
Compare:        diff <url1> <url2>
Multi-step:     chain (reads JSON from stdin)
Tabs:           tabs | tab <id> | newtab [url] | closetab [id]
Server:         status | cookie <n>=<v> | header <n>:<v>
                useragent <str> | stop | restart
CDP:            --cdp ws://host:9222 (connect to running browser)
Dialogs:        dialog-accept [text] | dialog-dismiss

Refs:           After 'snapshot', use @e1, @e2... as selectors:
                click @e3 | fill @e4 "value" | hover @e1
                @c refs from -C: click @c1`);
    process.exit(0);
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  // Special case: chain reads from stdin
  if (command === 'chain' && commandArgs.length === 0) {
    const stdin = await Bun.stdin.text();
    commandArgs.push(stdin.trim());
  }

  const state = await ensureServer();
  await sendCommand(state, command, commandArgs);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`[browse] ${err.message}`);
    process.exit(1);
  });
}
