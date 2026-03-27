/**
 * Auth enforcement and idle timeout tests
 *
 * These tests start a full browse server process and verify:
 *   MT2 — Bearer token enforcement (401 without/wrong token, 200 with correct token)
 *   MT7 — Idle timeout shutdown (server exits after BROWSE_IDLE_TIMEOUT elapses)
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const CLI_PATH = path.resolve(__dirname, '../src/cli.ts');

interface ServerState {
  port: number;
  token: string;
  pid: number;
}

/**
 * Start a browse server via the CLI and return its state.
 * Merges `extraEnv` over the current environment.
 */
async function startServer(
  stateFile: string,
  extraEnv: Record<string, string> = {}
): Promise<ServerState> {
  const baseEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== 'CONDUCTOR_PORT' && k !== 'BROWSE_PORT' && v !== undefined) baseEnv[k] = v;
  }
  // Ensure the bun binary is findable on PATH (it may not be in default env PATH)
  const bunDir = path.dirname(process.execPath);
  const existingPath = baseEnv.PATH || '';
  const env: Record<string, string> = {
    ...baseEnv,
    PATH: existingPath.includes(bunDir) ? existingPath : `${bunDir}:${existingPath}`,
    BROWSE_STATE_FILE: stateFile,
    BROWSE_PORT_START: String(9700 + Math.floor(Math.random() * 80)),
    ...extraEnv,
  };

  // Use process.execPath so tests work regardless of whether 'bun' is on PATH
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(process.execPath, ['run', CLI_PATH, 'status'], { env, timeout: 25000 });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`CLI exited ${code}`))));
  });

  if (!fs.existsSync(stateFile)) throw new Error('State file not created');
  return JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as ServerState;
}

function killServer(state: ServerState, stateFile: string) {
  try { process.kill(state.pid, 'SIGTERM'); } catch {}
  try { fs.unlinkSync(stateFile); } catch {}
}

// ─── Auth Enforcement (MT2) ─────────────────────────────────────

describe('Auth enforcement', () => {
  let state: ServerState;
  const stateFile = `/tmp/browse-test-auth-${Date.now()}.json`;

  beforeAll(async () => {
    state = await startServer(stateFile);
  }, 30000);

  afterAll(() => killServer(state, stateFile));

  test('request with no token returns 401', async () => {
    const res = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'url' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  test('request with wrong token returns 401', async () => {
    const res = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer definitely-wrong-token',
      },
      body: JSON.stringify({ command: 'url' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  test('request with correct token returns 200', async () => {
    const res = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      body: JSON.stringify({ command: 'status' }),
    });
    expect(res.status).toBe(200);
  });

  test('lowercase "bearer" prefix is rejected (case-sensitive)', async () => {
    const res = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `bearer ${state.token}`,
      },
      body: JSON.stringify({ command: 'url' }),
    });
    expect(res.status).toBe(401);
  });

  test('/health endpoint requires no auth', async () => {
    const res = await fetch(`http://127.0.0.1:${state.port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('healthy');
  });

  test('/health response includes uptime, tabs, buffersDropped', async () => {
    const res = await fetch(`http://127.0.0.1:${state.port}/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.tabs).toBe('number');
    expect(body.buffersDropped).toBeDefined();
    const dropped = body.buffersDropped as Record<string, number>;
    expect(typeof dropped.console).toBe('number');
    expect(typeof dropped.network).toBe('number');
    expect(typeof dropped.dialog).toBe('number');
  });

  test('X-Duration-Ms header present on successful command', async () => {
    const res = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      body: JSON.stringify({ command: 'status' }),
    });
    expect(res.status).toBe(200);
    const durationHeader = res.headers.get('X-Duration-Ms');
    expect(durationHeader).not.toBeNull();
    expect(parseInt(durationHeader!, 10)).toBeGreaterThanOrEqual(0);
  });

  test('unknown command with correct token returns 400', async () => {
    const res = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      body: JSON.stringify({ command: 'not-a-real-command' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Unknown command');
  });

  test('request with empty string token returns 401', async () => {
    const res = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ',
      },
      body: JSON.stringify({ command: 'url' }),
    });
    expect(res.status).toBe(401);
  });
});

// ─── Idle Timeout (MT7) ─────────────────────────────────────────
//
// The idle timer works correctly when the server is started directly (not via CLI).
// When started via Bun.spawn (as the CLI does), the Playwright WebSocket I/O appears
// to interfere with setInterval firing in background subprocesses.
// These tests start the server process directly via Node spawn to avoid that issue.

const SERVER_SCRIPT = path.resolve(__dirname, '../src/server.ts');

/**
 * Start the server DIRECTLY (not via CLI) with the given env overrides.
 * Returns the state and proc; caller must clean up.
 */
async function startServerDirect(
  stateFile: string,
  extraEnv: Record<string, string> = {}
): Promise<{ state: ServerState; proc: ReturnType<typeof spawn> }> {
  const bunDir = path.dirname(process.execPath);
  const existingPath = process.env.PATH || '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: existingPath.includes(bunDir) ? existingPath : `${bunDir}:${existingPath}`,
    BROWSE_STATE_FILE: stateFile,
    BROWSE_PORT_START: String(9820 + Math.floor(Math.random() * 40)),
    ...extraEnv,
  };

  const proc = spawn(process.execPath, ['run', SERVER_SCRIPT], {
    env,
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: true,
  });
  (proc as any).unref?.();

  // Wait for state file to appear
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as ServerState;
      if (state?.port) {
        // Wait for /health to return OK
        for (let i = 0; i < 30; i++) {
          try {
            const res = await fetch(`http://127.0.0.1:${state.port}/health`, { signal: AbortSignal.timeout(1000) });
            if (res.ok) return { state, proc };
          } catch {}
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    } catch {}
  }
  throw new Error('Server did not start in time');
}

describe('Idle timeout', () => {
  test('server exits after idle timeout elapses (MT7)', async () => {
    const stateFile = `/tmp/browse-test-idle-${Date.now()}.json`;
    const { state, proc } = await startServerDirect(stateFile, {
      BROWSE_IDLE_TIMEOUT: '2000',
      BROWSE_IDLE_CHECK_MS: '500',
    });

    // Verify server is up
    const healthBefore = await fetch(`http://127.0.0.1:${state.port}/health`);
    expect(healthBefore.status).toBe(200);

    // Wait: idle timeout (2s) + check interval (0.5s) + force-exit timeout (8s) + buffer
    await new Promise((r) => setTimeout(r, 12000));

    // Server should have exited — connection should be refused
    let exited = false;
    try {
      await fetch(`http://127.0.0.1:${state.port}/health`, { signal: AbortSignal.timeout(1000) });
    } catch {
      exited = true;
    }
    expect(exited).toBe(true);

    // State file should have been cleaned up by the server on shutdown
    expect(fs.existsSync(stateFile)).toBe(false);

    // Cleanup in case test fails and server is still alive
    try { proc.kill('SIGTERM'); } catch {}
    try { process.kill(state.pid, 'SIGTERM'); } catch {}
    try { fs.unlinkSync(stateFile); } catch {}
  }, 55000);

  test('/health does not reset idle timer (MT7)', async () => {
    const stateFile = `/tmp/browse-test-idle-health-${Date.now()}.json`;
    const { state, proc } = await startServerDirect(stateFile, {
      BROWSE_IDLE_TIMEOUT: '2000',
      BROWSE_IDLE_CHECK_MS: '500',
    });

    // Poll /health every 400ms — this should NOT prevent idle shutdown
    const pollInterval = setInterval(async () => {
      try { await fetch(`http://127.0.0.1:${state.port}/health`, { signal: AbortSignal.timeout(500) }); } catch {}
    }, 400);

    // Wait: idle timeout (2s) + check (0.5s) + force-exit timeout (8s) + buffer
    await new Promise((r) => setTimeout(r, 12000));
    clearInterval(pollInterval);

    // Server should have exited despite health polls
    let exited = false;
    try {
      await fetch(`http://127.0.0.1:${state.port}/health`, { signal: AbortSignal.timeout(1000) });
    } catch {
      exited = true;
    }
    expect(exited).toBe(true);

    try { proc.kill('SIGTERM'); } catch {}
    try { process.kill(state.pid, 'SIGTERM'); } catch {}
    try { fs.unlinkSync(stateFile); } catch {}
  }, 55000);
});
