/**
 * Read commands — extract data from pages without side effects
 *
 * text, html, links, forms, accessibility, js, eval, css, attrs,
 * console, network, cookies, storage, perf
 */

import type { BrowserManager } from './browser-manager';
import { consoleBuffer, networkBuffer, dialogBuffer } from './buffers';
import type { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// Security: Path validation to prevent path traversal attacks
const SAFE_DIRECTORIES = ['/tmp', process.cwd()];

function validateReadPath(filePath: string): void {
  if (path.isAbsolute(filePath)) {
    const resolved = path.resolve(filePath);
    const isSafe = SAFE_DIRECTORIES.some(dir => resolved === dir || resolved.startsWith(dir + '/'));
    if (!isSafe) {
      throw new Error(`Absolute path must be within: ${SAFE_DIRECTORIES.join(', ')}`);
    }
  }
  const normalized = path.normalize(filePath);
  if (normalized.includes('..')) {
    throw new Error('Path traversal sequences (..) are not allowed');
  }
}

/**
 * Extract clean text from a page (strips script/style/noscript/svg).
 * Exported for DRY reuse in meta-commands (diff).
 */
export async function getCleanText(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const body = document.body;
    if (!body) return '';
    const clone = body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script, style, noscript, svg').forEach(el => el.remove());
    return clone.innerText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
  });
}

export async function handleReadCommand(
  command: string,
  args: string[],
  bm: BrowserManager
): Promise<string> {
  const page = bm.getPage();

  switch (command) {
    case 'text': {
      return await getCleanText(page);
    }

    case 'html': {
      const selector = args[0];
      if (selector) {
        const resolved = bm.resolveRef(selector);
        if ('locator' in resolved) {
          return await resolved.locator.innerHTML({ timeout: 5000 });
        }
        return await page.innerHTML(resolved.selector);
      }
      return await page.content();
    }

    case 'links': {
      const links = await page.evaluate(() =>
        [...document.querySelectorAll('a[href]')].map(a => ({
          text: a.textContent?.trim().slice(0, 120) || '',
          href: (a as HTMLAnchorElement).href,
        })).filter(l => l.text && l.href)
      );
      return links.map(l => `${l.text} → ${l.href}`).join('\n');
    }

    case 'forms': {
      const forms = await page.evaluate(() => {
        return [...document.querySelectorAll('form')].map((form, i) => {
          const fields = [...form.querySelectorAll('input, select, textarea')].map(el => {
            const input = el as HTMLInputElement;
            return {
              tag: el.tagName.toLowerCase(),
              type: input.type || undefined,
              name: input.name || undefined,
              id: input.id || undefined,
              placeholder: input.placeholder || undefined,
              required: input.required || undefined,
              value: input.type === 'password' ? '[redacted]' : (input.value || undefined),
              options: el.tagName === 'SELECT'
                ? [...(el as HTMLSelectElement).options].map(o => ({ value: o.value, text: o.text }))
                : undefined,
            };
          });
          return {
            index: i,
            action: form.action || undefined,
            method: form.method || 'get',
            id: form.id || undefined,
            fields,
          };
        });
      });
      return JSON.stringify(forms, null, 2);
    }

    case 'accessibility': {
      const snapshot = await page.locator("body").ariaSnapshot();
      return snapshot;
    }

    case 'a11y': {
      // DOM-based accessibility audit — no CDN required
      const violations = await page.evaluate(() => {
        const issues: Array<{ rule: string; impact: string; element: string; description: string }> = [];

        // Helper: get a short selector for an element
        function shortSel(el: Element): string {
          const id = el.id ? `#${el.id}` : '';
          const cls = el.className && typeof el.className === 'string'
            ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
          return `${el.tagName.toLowerCase()}${id || cls}`.slice(0, 60);
        }

        // 1. Images missing alt text
        document.querySelectorAll('img').forEach(img => {
          if (!img.hasAttribute('alt')) {
            issues.push({ rule: 'img-alt', impact: 'critical',
              element: shortSel(img), description: 'Image missing alt attribute' });
          } else if (img.alt === '' && !img.hasAttribute('role')) {
            // empty alt is fine for decorative — only flag if it looks content-bearing
            const src = img.src || '';
            if (src && !/logo|icon|avatar|bg|background|decoration/.test(src.toLowerCase())) {
              // heuristic: flag suspicious empty alts only if large
              if ((img.naturalWidth || img.width) > 100) {
                issues.push({ rule: 'img-alt-empty', impact: 'serious',
                  element: shortSel(img), description: 'Large content image has empty alt — verify it is decorative' });
              }
            }
          }
        });

        // 2. Form inputs without accessible labels
        document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select').forEach(el => {
          const input = el as HTMLInputElement;
          const hasLabel = input.labels && input.labels.length > 0;
          const hasAriaLabel = el.hasAttribute('aria-label') && el.getAttribute('aria-label')!.trim() !== '';
          const hasAriaLabelledBy = el.hasAttribute('aria-labelledby');
          const hasTitle = el.hasAttribute('title') && el.getAttribute('title')!.trim() !== '';
          if (!hasLabel && !hasAriaLabel && !hasAriaLabelledBy && !hasTitle) {
            issues.push({ rule: 'label', impact: 'critical',
              element: shortSel(el), description: 'Form control has no accessible label (no <label>, aria-label, aria-labelledby, or title)' });
          }
        });

        // 3. Buttons without accessible names
        document.querySelectorAll('button, [role="button"]').forEach(el => {
          const text = (el.textContent || '').trim();
          const ariaLabel = el.getAttribute('aria-label') || '';
          const ariaLabelledBy = el.getAttribute('aria-labelledby') || '';
          const title = el.getAttribute('title') || '';
          const hasImg = el.querySelector('img[alt]') !== null;
          if (!text && !ariaLabel && !ariaLabelledBy && !title && !hasImg) {
            issues.push({ rule: 'button-name', impact: 'critical',
              element: shortSel(el), description: 'Button has no accessible name (no text, aria-label, aria-labelledby, or title)' });
          }
        });

        // 4. Links with empty or non-descriptive text
        document.querySelectorAll('a[href]').forEach(el => {
          const text = (el.textContent || '').trim();
          const ariaLabel = el.getAttribute('aria-label') || '';
          const title = el.getAttribute('title') || '';
          if (!text && !ariaLabel && !title && !el.querySelector('img[alt]')) {
            issues.push({ rule: 'link-name', impact: 'serious',
              element: shortSel(el), description: 'Link has no accessible name' });
          } else if (/^(click here|here|read more|more|link)$/i.test(text) && !ariaLabel) {
            issues.push({ rule: 'link-name-descriptive', impact: 'moderate',
              element: shortSel(el), description: `Non-descriptive link text: "${text}"` });
          }
        });

        // 5. Missing lang attribute on <html>
        const html = document.documentElement;
        if (!html.hasAttribute('lang') || html.getAttribute('lang')!.trim() === '') {
          issues.push({ rule: 'html-has-lang', impact: 'serious',
            element: 'html', description: 'Page missing lang attribute on <html> element' });
        }

        // 6. Missing page title
        if (!document.title || document.title.trim() === '') {
          issues.push({ rule: 'document-title', impact: 'serious',
            element: 'title', description: 'Page has no <title>' });
        }

        // 7. Skipped heading levels
        const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
          .map(h => parseInt(h.tagName[1], 10));
        for (let i = 1; i < headings.length; i++) {
          if (headings[i] - headings[i - 1] > 1) {
            issues.push({ rule: 'heading-order', impact: 'moderate',
              element: `h${headings[i]}`, description: `Heading level skips from h${headings[i-1]} to h${headings[i]}` });
            break; // report once
          }
        }
        const h1Count = headings.filter(h => h === 1).length;
        if (h1Count === 0) {
          issues.push({ rule: 'page-has-heading-one', impact: 'moderate',
            element: 'h1', description: 'Page has no <h1> heading' });
        } else if (h1Count > 1) {
          issues.push({ rule: 'page-has-heading-one', impact: 'moderate',
            element: 'h1', description: `Page has ${h1Count} <h1> headings — should have exactly one` });
        }

        // 8. Interactive elements with very low contrast (heuristic: white-on-white, black-on-black)
        // Only catch obvious fails without full color computation
        document.querySelectorAll('button, a[href], input, label').forEach(el => {
          const style = getComputedStyle(el);
          const color = style.color;
          const bg = style.backgroundColor;
          if (color === bg && color !== 'rgba(0, 0, 0, 0)') {
            issues.push({ rule: 'color-contrast', impact: 'serious',
              element: shortSel(el), description: `Foreground and background color are identical: ${color}` });
          }
        });

        return issues;
      });

      if (violations.length === 0) return 'a11y audit: No violations found.';

      const counts = { critical: 0, serious: 0, moderate: 0 };
      for (const v of violations) {
        if (v.impact in counts) counts[v.impact as keyof typeof counts]++;
      }
      const summary = `a11y audit: ${violations.length} violation${violations.length === 1 ? '' : 's'} ` +
        `(${counts.critical} critical, ${counts.serious} serious, ${counts.moderate} moderate)`;

      const lines = [summary, ''];
      for (const v of violations) {
        lines.push(`[${v.impact.toUpperCase()}] ${v.rule}`);
        lines.push(`  Element: ${v.element}`);
        lines.push(`  Issue:   ${v.description}`);
        lines.push('');
      }
      return lines.join('\n').trimEnd();
    }

    case 'js': {
      const expr = args[0];
      if (!expr) throw new Error('Usage: browse js <expression>');
      const result = await page.evaluate(expr);
      return typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result ?? '');
    }

    case 'eval': {
      const filePath = args[0];
      if (!filePath) throw new Error('Usage: browse eval <js-file>');
      validateReadPath(filePath);
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
      const code = fs.readFileSync(filePath, 'utf-8');
      const result = await page.evaluate(code);
      return typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result ?? '');
    }

    case 'css': {
      const [selector, property] = args;
      if (!selector || !property) throw new Error('Usage: browse css <selector> <property>');
      const resolved = bm.resolveRef(selector);
      if ('locator' in resolved) {
        const value = await resolved.locator.evaluate(
          (el, prop) => getComputedStyle(el).getPropertyValue(prop),
          property
        );
        return value;
      }
      const value = await page.evaluate(
        ([sel, prop]) => {
          const el = document.querySelector(sel);
          if (!el) return `Element not found: ${sel}`;
          return getComputedStyle(el).getPropertyValue(prop);
        },
        [resolved.selector, property]
      );
      return value;
    }

    case 'attrs': {
      const selector = args[0];
      if (!selector) throw new Error('Usage: browse attrs <selector>');
      const resolved = bm.resolveRef(selector);
      if ('locator' in resolved) {
        const attrs = await resolved.locator.evaluate((el) => {
          const result: Record<string, string> = {};
          for (const attr of el.attributes) {
            result[attr.name] = attr.value;
          }
          return result;
        });
        return JSON.stringify(attrs, null, 2);
      }
      const attrs = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return `Element not found: ${sel}`;
        const result: Record<string, string> = {};
        for (const attr of el.attributes) {
          result[attr.name] = attr.value;
        }
        return result;
      }, resolved.selector);
      return typeof attrs === 'string' ? attrs : JSON.stringify(attrs, null, 2);
    }

    case 'console': {
      if (args[0] === '--clear') {
        consoleBuffer.clear();
        return 'Console buffer cleared.';
      }
      const entries = args[0] === '--errors'
        ? consoleBuffer.toArray().filter(e => e.level === 'error' || e.level === 'warning')
        : consoleBuffer.toArray();
      if (entries.length === 0) return args[0] === '--errors' ? '(no console errors)' : '(no console messages)';
      return entries.map(e =>
        `[${new Date(e.timestamp).toISOString()}] [${e.level}] ${e.text}`
      ).join('\n');
    }

    case 'network': {
      if (args[0] === '--clear') {
        networkBuffer.clear();
        return 'Network buffer cleared.';
      }
      if (networkBuffer.length === 0) return '(no network requests)';
      return networkBuffer.toArray().map(e =>
        `${e.method} ${e.url} → ${e.status || 'pending'} (${e.duration || '?'}ms, ${e.size || '?'}B)`
      ).join('\n');
    }

    case 'dialog': {
      if (args[0] === '--clear') {
        dialogBuffer.clear();
        return 'Dialog buffer cleared.';
      }
      if (dialogBuffer.length === 0) return '(no dialogs captured)';
      return dialogBuffer.toArray().map(e =>
        `[${new Date(e.timestamp).toISOString()}] [${e.type}] "${e.message}" → ${e.action}${e.response ? ` "${e.response}"` : ''}`
      ).join('\n');
    }

    case 'is': {
      const property = args[0];
      const selector = args[1];
      if (!property || !selector) throw new Error('Usage: browse is <property> <selector>\nProperties: visible, hidden, enabled, disabled, checked, editable, focused');

      const resolved = bm.resolveRef(selector);
      let locator;
      if ('locator' in resolved) {
        locator = resolved.locator;
      } else {
        locator = page.locator(resolved.selector);
      }

      switch (property) {
        case 'visible':  return String(await locator.isVisible());
        case 'hidden':   return String(await locator.isHidden());
        case 'enabled':  return String(await locator.isEnabled());
        case 'disabled': return String(await locator.isDisabled());
        case 'checked':  return String(await locator.isChecked());
        case 'editable': return String(await locator.isEditable());
        case 'focused': {
          const isFocused = await locator.evaluate(
            (el) => el === document.activeElement
          );
          return String(isFocused);
        }
        default:
          throw new Error(`Unknown property: ${property}. Use: visible, hidden, enabled, disabled, checked, editable, focused`);
      }
    }

    case 'cookies': {
      const cookies = await page.context().cookies();
      return JSON.stringify(cookies, null, 2);
    }

    case 'storage': {
      if (args[0] === 'set' && args[1]) {
        const key = args[1];
        const value = args[2] || '';
        await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, value]);
        return `Set localStorage["${key}"]`;
      }
      const storage = await page.evaluate(() => ({
        localStorage: { ...localStorage },
        sessionStorage: { ...sessionStorage },
      }));
      return JSON.stringify(storage, null, 2);
    }

    case 'perf': {
      // Parse --budget flag: e.g. --budget ttfb=500,load=3000
      const budgetIdx = args.indexOf('--budget');
      const budget: Record<string, number> = {};
      if (budgetIdx !== -1 && args[budgetIdx + 1]) {
        for (const part of args[budgetIdx + 1].split(',')) {
          const [key, val] = part.split('=');
          if (key && val && !isNaN(Number(val))) budget[key.trim()] = Number(val);
        }
      }

      const timings = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        if (!nav) return 'No navigation timing data available.';
        return {
          dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
          tcp: Math.round(nav.connectEnd - nav.connectStart),
          ssl: Math.round(nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : 0),
          ttfb: Math.round(nav.responseStart - nav.requestStart),
          download: Math.round(nav.responseEnd - nav.responseStart),
          domParse: Math.round(nav.domInteractive - nav.responseEnd),
          domReady: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
          load: Math.round(nav.loadEventEnd - nav.startTime),
          total: Math.round(nav.loadEventEnd - nav.startTime),
        };
      });
      if (typeof timings === 'string') return timings;

      if (Object.keys(budget).length > 0) {
        // Budget mode: return PASS/FAIL per budgeted metric + all raw values
        const lines: string[] = [];
        let anyFail = false;
        for (const [k, v] of Object.entries(timings)) {
          if (k in budget) {
            const pass = v <= budget[k];
            if (!pass) anyFail = true;
            lines.push(`${k.padEnd(12)} ${v}ms  (budget: ${budget[k]}ms)  ${pass ? 'PASS' : 'FAIL'}`);
          } else {
            lines.push(`${k.padEnd(12)} ${v}ms`);
          }
        }
        lines.push('');
        lines.push(anyFail ? 'Result: FAIL — one or more metrics exceeded budget.' : 'Result: PASS — all metrics within budget.');
        return lines.join('\n');
      }

      return Object.entries(timings)
        .map(([k, v]) => `${k.padEnd(12)} ${v}ms`)
        .join('\n');
    }

    default:
      throw new Error(`Unknown read command: ${command}`);
  }
}
