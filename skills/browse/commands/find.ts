/**
 * Semantic locator finder for browse skill
 * Uses Playwright's semantic locators: getByRole, getByLabel, getByText, getByPlaceholder, getByTestId
 */

import type { Page, Locator } from 'playwright';

interface FindArgs {
  role?: string;
  label?: string;
  text?: string;
  placeholder?: string;
  testid?: string;
  name?: string;          // For role, e.g., role=button name="Submit"
  level?: string;         // For heading, e.g., role=heading level="2"
  checked?: string;       // For checkbox/radio, e.g., role=checkbox checked="true"
  expanded?: string;      // For treeitem, e.g., role=treeitem expanded="false"
  selected?: string;      // For option, e.g., role=option selected="true"
  pressed?: string;       // For button, e.g., role=button pressed="false"
}

interface FoundElement {
  ref: string;           // e.g., "@e1", "@l1", "@t1", etc.
  locator: Locator;
  textContent: string;
  attributes: Record<string, string>;
}

/**
 * Find elements using semantic locators
 * Example usage: find role=button name="Submit"
 * Returns array of FoundElement with ref identifiers
 */
export async function find(
  page: Page,
  args: FindArgs
): Promise<FoundElement[]> {
  const results: FoundElement[] = [];

  // Helper to extract text content and attributes from a locator
  async function processLocator(locator: Locator, prefix: string): Promise<void> {
    const count = await locator.count();
    for (let i = 0; i < count; i++) {
      const nth = locator.nth(i);
      const text = await nth.textContent() || '';
      const attrObj: Record<string, string> = {};
      // Collect some common attributes
      const attrs = ['role', 'aria-label', 'data-testid', 'placeholder', 'type', 'name', 'id'];
      for (const attr of attrs) {
        const val = await nth.getAttribute(attr);
        if (val) attrObj[attr] = val;
      }
      // Generate unique ref based on prefix and index
      const ref = `@${prefix}${i + 1}`;
      results.push({ ref, locator: nth, textContent: text.trim(), attributes: attrObj });
    }
  }

  // Role-based search
  if (args.role) {
    const roleOptions: any = {};
    if (args.name) roleOptions.name = args.name;
    if (args.level) roleOptions.level = parseInt(args.level, 10);
    if (args.checked) roleOptions.checked = args.checked === 'true';
    if (args.expanded) roleOptions.expanded = args.expanded === 'true';
    if (args.selected) roleOptions.selected = args.selected === 'true';
    if (args.pressed) roleOptions.pressed = args.pressed === 'true';
    
    const locator = page.getByRole(args.role as any, roleOptions);
    await processLocator(locator, 'r');
  }

  // Label-based search
  if (args.label) {
    const locator = page.getByLabel(args.label);
    await processLocator(locator, 'l');
  }

  // Text-based search (exact or substring)
  if (args.text) {
    const locator = page.getByText(args.text);
    await processLocator(locator, 't');
  }

  // Placeholder-based search
  if (args.placeholder) {
    const locator = page.getByPlaceholder(args.placeholder);
    await processLocator(locator, 'p');
  }

  // Test ID-based search
  if (args.testid) {
    const locator = page.getByTestId(args.testid);
    await processLocator(locator, 'd'); // 'd' for data-testid
  }

  // If no specific arg but multiple provided, combine? For now, treat as OR.
  // Return results sorted by ref prefix order
  return results;
}