/**
 * T271: Frame command test
 *
 * Verifies frame switching on a page with iframes.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { BrowserManager } from '../src/browser-manager';
import { handleWriteCommand } from '../src/write-commands';
import { handleReadCommand } from '../src/read-commands';
import * as http from 'http';

let bm: BrowserManager;
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  // Create a simple HTTP server with an iframe page
  server = http.createServer((req, res) => {
    if (req.url === '/iframe-content') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><p id="inner">Hello from iframe</p></body></html>');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body>
        <p id="outer">Main page content</p>
        <iframe id="myframe" src="/iframe-content" width="300" height="200"></iframe>
      </body></html>`);
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;

  bm = new BrowserManager();
  await bm.launch();
});

afterAll(() => {
  try { server.close(); } catch {}
  // bm.close() can hang — just let process exit handle it
  setTimeout(() => process.exit(0), 500);
});

describe('Frame command', () => {
  test('switch to iframe and back to main', async () => {
    await handleWriteCommand('goto', [baseUrl], bm);

    // Wait for iframe to load
    await handleWriteCommand('wait', ['#myframe'], bm);

    // Switch to iframe
    const result = await handleWriteCommand('frame', ['#myframe'], bm);
    expect(result).toContain('Switched to frame');
    expect(result).toContain('iframe-content');

    // Switch back to main
    const mainResult = await handleWriteCommand('frame', ['main'], bm);
    expect(mainResult).toContain('Switched to main frame');
  });

  test('frame with invalid selector throws', async () => {
    await handleWriteCommand('goto', [baseUrl], bm);
    expect(
      handleWriteCommand('frame', ['#nonexistent'], bm)
    ).rejects.toThrow();
  });

  test('frame with no args throws', async () => {
    expect(
      handleWriteCommand('frame', [], bm)
    ).rejects.toThrow('Usage: browse frame');
  });
});
