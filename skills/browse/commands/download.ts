/**
 * Download handling for browse skill
 * 
 * Downloads a file triggered by clicking a selector, saves to specified path.
 * Uses Playwright's page.waitForEvent('download') API.
 */

import type { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// Security: Path validation to prevent path traversal attacks
const SAFE_DIRECTORIES = ['/tmp', process.cwd()];

function validateWritePath(filePath: string): void {
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

interface DownloadResult {
  path: string;
  size: number;
}

/**
 * Download a file by clicking a selector and saving to output path.
 * 
 * @param page Playwright Page object
 * @param args Object with selector and output (file path)
 * @returns Promise resolving to DownloadResult with saved path and file size
 */
export async function download(
  page: Page,
  args: { selector: string; output: string }
): Promise<DownloadResult> {
  const { selector, output } = args;
  
  if (!selector || !output) {
    throw new Error('download requires selector and output arguments');
  }
  
  // Validate output path
  validateWritePath(output);
  
  // Ensure parent directory exists
  const dir = path.dirname(output);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Set up download event listener BEFORE clicking
  const downloadPromise = page.waitForEvent('download');
  
  // Click the selector to trigger download
  await page.click(selector, { timeout: 5000 });
  
  // Wait for download to start
  const download = await downloadPromise;
  
  // Wait for download to complete
  const savePath = await download.saveAs(output);
  
  // Get file size
  const stats = fs.statSync(savePath);
  const size = stats.size;
  
  return {
    path: savePath,
    size
  };
}

/**
 * Alternative explicit function signature for direct calling.
 */
export async function downloadFile(
  page: Page,
  selector: string,
  outputPath: string
): Promise<DownloadResult> {
  return download(page, { selector, output: outputPath });
}