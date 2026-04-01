/**
 * T267: Session isolation test
 *
 * Verifies that two sessions have independent cookies.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { SessionManager } from '../src/session-manager';
import { chromium, type Browser } from 'playwright';

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
});

describe('SessionManager isolation', () => {
  test('two sessions have independent cookies', async () => {
    const sm = new SessionManager(browser);

    const ctx1 = await sm.create('session-a');
    const ctx2 = await sm.create('session-b');

    // Set different cookies in each session
    await ctx1.addCookies([{
      name: 'token', value: 'aaa', domain: 'example.com', path: '/',
    }]);
    await ctx2.addCookies([{
      name: 'token', value: 'bbb', domain: 'example.com', path: '/',
    }]);

    // Verify cookies are isolated
    const cookies1 = await ctx1.cookies('https://example.com');
    const cookies2 = await ctx2.cookies('https://example.com');

    expect(cookies1).toHaveLength(1);
    expect(cookies1[0].value).toBe('aaa');

    expect(cookies2).toHaveLength(1);
    expect(cookies2[0].value).toBe('bbb');

    // Verify list
    expect(sm.list()).toEqual(['session-a', 'session-b']);

    // Destroy and verify
    await sm.destroy('session-a');
    expect(sm.list()).toEqual(['session-b']);

    await sm.destroy('session-b');
    expect(sm.list()).toEqual([]);
  });

  test('duplicate session name throws', async () => {
    const sm = new SessionManager(browser);
    await sm.create('dup');
    expect(sm.create('dup')).rejects.toThrow("Session 'dup' already exists");
    await sm.destroy('dup');
  });

  test('get non-existent session throws', () => {
    const sm = new SessionManager(browser);
    expect(() => sm.get('nope')).toThrow("Session 'nope' not found");
  });
});
