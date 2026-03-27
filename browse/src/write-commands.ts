/**
 * Write commands — navigate and interact with pages (side effects)
 *
 * goto, back, forward, reload, click, fill, select, hover, type,
 * press, scroll, wait, viewport, cookie, header, useragent
 */

import type { BrowserManager } from './browser-manager';
import { findInstalledBrowsers, importCookies } from './cookie-import-browser';
import * as fs from 'fs';
import * as path from 'path';

export async function handleWriteCommand(
  command: string,
  args: string[],
  bm: BrowserManager
): Promise<string> {
  const page = bm.getPage();

  switch (command) {
    case 'goto': {
      const url = args[0];
      if (!url) throw new Error('Usage: browse goto <url>');
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const status = response?.status() || 'unknown';
      return `Navigated to ${url} (${status})`;
    }

    case 'back': {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
      return `Back → ${page.url()}`;
    }

    case 'forward': {
      await page.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 });
      return `Forward → ${page.url()}`;
    }

    case 'reload': {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      return `Reloaded ${page.url()}`;
    }

    case 'click': {
      const selector = args[0];
      if (!selector) throw new Error('Usage: browse click <selector>');
      const resolved = bm.resolveRef(selector);
      if ('locator' in resolved) {
        await resolved.locator.click({ timeout: 5000 });
      } else {
        await page.click(resolved.selector, { timeout: 5000 });
      }
      // Wait briefly for any navigation/DOM update
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      return `Clicked ${selector} → now at ${page.url()}`;
    }

    case 'fill': {
      const [selector, ...valueParts] = args;
      const value = valueParts.join(' ');
      if (!selector || !value) throw new Error('Usage: browse fill <selector> <value>');
      const resolved = bm.resolveRef(selector);
      if ('locator' in resolved) {
        await resolved.locator.fill(value, { timeout: 5000 });
      } else {
        await page.fill(resolved.selector, value, { timeout: 5000 });
      }
      return `Filled ${selector}`;
    }

    case 'select': {
      const [selector, ...valueParts] = args;
      const value = valueParts.join(' ');
      if (!selector || !value) throw new Error('Usage: browse select <selector> <value>');
      const resolved = bm.resolveRef(selector);
      if ('locator' in resolved) {
        await resolved.locator.selectOption(value, { timeout: 5000 });
      } else {
        await page.selectOption(resolved.selector, value, { timeout: 5000 });
      }
      return `Selected "${value}" in ${selector}`;
    }

    case 'hover': {
      const selector = args[0];
      if (!selector) throw new Error('Usage: browse hover <selector>');
      const resolved = bm.resolveRef(selector);
      if ('locator' in resolved) {
        await resolved.locator.hover({ timeout: 5000 });
      } else {
        await page.hover(resolved.selector, { timeout: 5000 });
      }
      return `Hovered ${selector}`;
    }

    case 'type': {
      const text = args.join(' ');
      if (!text) throw new Error('Usage: browse type <text>');
      await page.keyboard.type(text);
      return `Typed ${text.length} characters`;
    }

    case 'press': {
      const key = args[0];
      if (!key) throw new Error('Usage: browse press <key> (e.g., Enter, Tab, Escape)');
      await page.keyboard.press(key);
      return `Pressed ${key}`;
    }

    case 'scroll': {
      const selector = args[0];
      if (selector) {
        const resolved = bm.resolveRef(selector);
        if ('locator' in resolved) {
          await resolved.locator.scrollIntoViewIfNeeded({ timeout: 5000 });
        } else {
          await page.locator(resolved.selector).scrollIntoViewIfNeeded({ timeout: 5000 });
        }
        return `Scrolled ${selector} into view`;
      }
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      return 'Scrolled to bottom';
    }

    case 'wait': {
      const selector = args[0];
      if (!selector) throw new Error('Usage: browse wait <selector|--networkidle|--load|--domcontentloaded>');
      if (selector === '--networkidle') {
        const timeout = args[1] ? parseInt(args[1], 10) : 15000;
        await page.waitForLoadState('networkidle', { timeout });
        return 'Network idle';
      }
      if (selector === '--load') {
        await page.waitForLoadState('load');
        return 'Page loaded';
      }
      if (selector === '--domcontentloaded') {
        await page.waitForLoadState('domcontentloaded');
        return 'DOM content loaded';
      }
      const timeout = args[1] ? parseInt(args[1], 10) : 15000;
      const resolved = bm.resolveRef(selector);
      if ('locator' in resolved) {
        await resolved.locator.waitFor({ state: 'visible', timeout });
      } else {
        await page.waitForSelector(resolved.selector, { timeout });
      }
      return `Element ${selector} appeared`;
    }

    case 'viewport': {
      const size = args[0];
      if (!size || !size.includes('x')) throw new Error('Usage: browse viewport <WxH> (e.g., 375x812)');
      const [w, h] = size.split('x').map(Number);
      await bm.setViewport(w, h);
      return `Viewport set to ${w}x${h}`;
    }

    case 'cookie': {
      const cookieStr = args[0];
      if (!cookieStr || !cookieStr.includes('=')) throw new Error('Usage: browse cookie <name>=<value>');
      const eq = cookieStr.indexOf('=');
      const name = cookieStr.slice(0, eq);
      const value = cookieStr.slice(eq + 1);
      const url = new URL(page.url());
      await page.context().addCookies([{
        name,
        value,
        domain: url.hostname,
        path: '/',
      }]);
      return `Cookie set: ${name}=****`;
    }

    case 'header': {
      const headerStr = args[0];
      if (!headerStr || !headerStr.includes(':')) throw new Error('Usage: browse header <name>:<value>');
      const sep = headerStr.indexOf(':');
      const name = headerStr.slice(0, sep).trim();
      const value = headerStr.slice(sep + 1).trim();
      await bm.setExtraHeader(name, value);
      const sensitiveHeaders = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token'];
      const redactedValue = sensitiveHeaders.includes(name.toLowerCase()) ? '****' : value;
      return `Header set: ${name}: ${redactedValue}`;
    }

    case 'useragent': {
      const ua = args.join(' ');
      if (!ua) throw new Error('Usage: browse useragent <string>');
      bm.setUserAgent(ua);
      const error = await bm.recreateContext();
      if (error) {
        return `User agent set to "${ua}" but: ${error}`;
      }
      return `User agent set: ${ua}`;
    }

    case 'upload': {
      const [selector, ...filePaths] = args;
      if (!selector || filePaths.length === 0) throw new Error('Usage: browse upload <selector> <file1> [file2...]');

      // Validate all files exist before upload
      for (const fp of filePaths) {
        if (!fs.existsSync(fp)) throw new Error(`File not found: ${fp}`);
      }

      const resolved = bm.resolveRef(selector);
      if ('locator' in resolved) {
        await resolved.locator.setInputFiles(filePaths);
      } else {
        await page.locator(resolved.selector).setInputFiles(filePaths);
      }

      const fileInfo = filePaths.map(fp => {
        const stat = fs.statSync(fp);
        return `${path.basename(fp)} (${stat.size}B)`;
      }).join(', ');
      return `Uploaded: ${fileInfo}`;
    }

    case 'dialog-accept': {
      const text = args.length > 0 ? args.join(' ') : null;
      bm.setDialogAutoAccept(true);
      bm.setDialogPromptText(text);
      return text
        ? `Dialogs will be accepted with text: "${text}"`
        : 'Dialogs will be accepted';
    }

    case 'dialog-dismiss': {
      bm.setDialogAutoAccept(false);
      bm.setDialogPromptText(null);
      return 'Dialogs will be dismissed';
    }

    case 'cookie-import': {
      const filePath = args[0];
      if (!filePath) throw new Error('Usage: browse cookie-import <json-file>');
      // Path validation — prevent reading arbitrary files
      if (path.isAbsolute(filePath)) {
        const safeDirs = ['/tmp', process.cwd()];
        const resolved = path.resolve(filePath);
        if (!safeDirs.some(dir => resolved === dir || resolved.startsWith(dir + '/'))) {
          throw new Error(`Path must be within: ${safeDirs.join(', ')}`);
        }
      }
      if (path.normalize(filePath).includes('..')) {
        throw new Error('Path traversal sequences (..) are not allowed');
      }
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
      const raw = fs.readFileSync(filePath, 'utf-8');
      let cookies: any[];
      try { cookies = JSON.parse(raw); } catch { throw new Error(`Invalid JSON in ${filePath}`); }
      if (!Array.isArray(cookies)) throw new Error('Cookie file must contain a JSON array');

      // Auto-fill domain from current page URL when missing (consistent with cookie command)
      const pageUrl = new URL(page.url());
      const defaultDomain = pageUrl.hostname;

      for (const c of cookies) {
        if (!c.name || c.value === undefined) throw new Error('Each cookie must have "name" and "value" fields');
        if (!c.domain) c.domain = defaultDomain;
        if (!c.path) c.path = '/';
      }

      await page.context().addCookies(cookies);
      return `Loaded ${cookies.length} cookies from ${filePath}`;
    }

    case 'cookie-import-browser': {
      // Two modes:
      // 1. Direct CLI import: cookie-import-browser <browser> --domain <domain>
      // 2. Open picker UI: cookie-import-browser [browser]
      const browserArg = args[0];
      const domainIdx = args.indexOf('--domain');

      if (domainIdx !== -1 && domainIdx + 1 < args.length) {
        // Direct import mode — no UI
        const domain = args[domainIdx + 1];
        const browser = browserArg || 'comet';
        const result = await importCookies(browser, [domain]);
        if (result.cookies.length > 0) {
          await page.context().addCookies(result.cookies);
        }
        const msg = [`Imported ${result.count} cookies for ${domain} from ${browser}`];
        if (result.failed > 0) msg.push(`(${result.failed} failed to decrypt)`);
        return msg.join(' ');
      }

      // Picker UI mode — open in user's browser
      const port = bm.serverPort;
      if (!port) throw new Error('Server port not available');

      const browsers = findInstalledBrowsers();
      if (browsers.length === 0) {
        throw new Error('No Chromium browsers found. Supported: Comet, Chrome, Arc, Brave, Edge');
      }

      const pickerUrl = `http://127.0.0.1:${port}/cookie-picker`;
      try {
        Bun.spawn(['open', pickerUrl], { stdout: 'ignore', stderr: 'ignore' });
      } catch {
        // open may fail silently — URL is in the message below
      }

      return `Cookie picker opened at ${pickerUrl}\nDetected browsers: ${browsers.map(b => b.name).join(', ')}\nSelect domains to import, then close the picker when done.`;
    }

    case 'form-fill': {
      // Enumerate all form fields, then fill each with contextually appropriate values
      // Args: optional form index (default: 0), optional --strategy "description"
      const strategyIdx = args.indexOf('--strategy');
      const strategy = strategyIdx !== -1 ? args.slice(strategyIdx + 1).join(' ') : 'realistic test data';
      const formIdxArg = args.find(a => /^\d+$/.test(a));
      const targetFormIdx = formIdxArg !== undefined ? parseInt(formIdxArg, 10) : null;

      // Get form fields (mirrors the `forms` read command)
      const forms = await page.evaluate(() => {
        return [...document.querySelectorAll('form')].map((form, i) => {
          const fields = [...form.querySelectorAll('input, select, textarea')].map(el => {
            const input = el as HTMLInputElement;
            const label = input.labels?.[0]?.textContent?.trim() ||
              input.getAttribute('aria-label') || input.getAttribute('placeholder') || '';
            return {
              tag: el.tagName.toLowerCase(),
              type: input.type || undefined,
              name: input.name || undefined,
              id: input.id || undefined,
              placeholder: input.placeholder || undefined,
              label: label || undefined,
              required: input.required || undefined,
              options: el.tagName === 'SELECT'
                ? [...(el as HTMLSelectElement).options].map(o => o.value).filter(v => v !== '')
                : undefined,
            };
          });
          return { index: i, id: form.id || undefined, fields };
        });
      });

      if (forms.length === 0) throw new Error('No forms found on this page');

      const formsToFill = targetFormIdx !== null
        ? forms.filter(f => f.index === targetFormIdx)
        : [forms[0]];

      if (formsToFill.length === 0) throw new Error(`No form at index ${targetFormIdx}`);

      // Generate fill values based on field metadata
      function generateValue(field: {
        type?: string; name?: string; label?: string;
        placeholder?: string; options?: string[];
      }): string | null {
        const hint = `${field.label || ''} ${field.name || ''} ${field.placeholder || ''}`.toLowerCase();
        const type = (field.type || 'text').toLowerCase();

        if (type === 'checkbox' || type === 'radio') return null; // skip
        if (type === 'file') return null; // skip
        if (field.options && field.options.length > 0) return field.options[0]; // pick first option

        if (type === 'email' || hint.includes('email')) return 'test@example.com';
        if (type === 'tel' || hint.includes('phone') || hint.includes('tel')) return '+1 555-555-0100';
        if (type === 'url' || hint.includes('url') || hint.includes('website')) return 'https://example.com';
        if (type === 'number') {
          if (hint.includes('age')) return '30';
          if (hint.includes('zip') || hint.includes('postal')) return '94103';
          if (hint.includes('price') || hint.includes('amount') || hint.includes('cost')) return '9.99';
          return '42';
        }
        if (type === 'date') return '1990-01-15';
        if (type === 'time') return '09:00';
        if (type === 'color') return '#336699';
        if (type === 'range') return '50';
        if (type === 'password') return 'Test@1234!';
        if (type === 'search') return 'test query';

        // Text fields — use label/name hint
        if (hint.includes('first') && hint.includes('name')) return 'Alice';
        if (hint.includes('last') && hint.includes('name')) return 'Smith';
        if (hint.includes('name') && !hint.includes('user')) return 'Alice Smith';
        if (hint.includes('username') || hint.includes('user name')) return 'alice_smith';
        if (hint.includes('city')) return 'San Francisco';
        if (hint.includes('state') || hint.includes('province')) return 'CA';
        if (hint.includes('country')) return 'United States';
        if (hint.includes('zip') || hint.includes('postal')) return '94103';
        if (hint.includes('address')) return '123 Main St';
        if (hint.includes('company') || hint.includes('org')) return 'Acme Corp';
        if (hint.includes('title') || hint.includes('subject')) return 'Test Subject';
        if (hint.includes('comment') || hint.includes('message') || hint.includes('note') ||
            hint.includes('description') || hint.includes('bio')) return 'This is a test message for QA purposes.';
        if (hint.includes('code') || hint.includes('coupon')) return 'TEST2026';
        return 'Test Value';
      }

      const filled: string[] = [];
      const skipped: string[] = [];

      for (const form of formsToFill) {
        for (const field of form.fields) {
          if (field.type === 'hidden' || field.type === 'submit' ||
              field.type === 'button' || field.type === 'reset' || field.type === 'image') continue;

          const value = generateValue(field);
          if (value === null) { skipped.push(field.name || field.id || field.type || 'field'); continue; }

          const selector = field.id ? `#${field.id}` :
            field.name ? `[name="${field.name}"]` : null;
          if (!selector) { skipped.push('(no selector)'); continue; }

          try {
            if (field.tag === 'select') {
              await page.selectOption(selector, value, { timeout: 3000 });
            } else {
              await page.fill(selector, value, { timeout: 3000 });
            }
            filled.push(`${selector} = "${value}"`);
          } catch {
            skipped.push(selector);
          }
        }
      }

      const lines = [`form-fill: filled ${filled.length} field${filled.length === 1 ? '' : 's'} (strategy: ${strategy})`];
      for (const f of filled) lines.push(`  ✓ ${f}`);
      if (skipped.length > 0) lines.push(`  skipped: ${skipped.join(', ')}`);
      return lines.join('\n');
    }

    default:
      throw new Error(`Unknown write command: ${command}`);
  }
}
