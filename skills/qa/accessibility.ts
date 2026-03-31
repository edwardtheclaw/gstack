/**
 * Accessibility audit helpers for GStack QA
 */

import type { Page } from 'playwright';

export async function checkAltText(page: Page): Promise<Array<{element: string, issue: string}>> {
    const issues: Array<{element: string, issue: string}> = [];
    const images = page.locator('img');
    const count = await images.count();
    
    for (let i = 0; i < count; i++) {
        const img = images.nth(i);
        const alt = await img.getAttribute('alt');
        const src = await img.getAttribute('src') || '';
        const selector = await img.evaluate(el => el.id ? `#${el.id}` : 'img');
        
        if (alt === null) {
            issues.push({
                element: `${selector} (src: ${src.substring(0, 30)}${src.length > 30 ? '...' : ''})`,
                issue: 'Missing alt text'
            });
        } else if (alt.trim() === '') {
            issues.push({
                element: `${selector} (src: ${src.substring(0, 30)}${src.length > 30 ? '...' : ''})`,
                issue: 'Empty alt text (should be decorative or have aria-hidden)'
            });
        }
    }
    return issues;
}

export async function checkAriaLabels(page: Page): Promise<Array<{element: string, issue: string}>> {
    const issues: Array<{element: string, issue: string}> = [];
    const interactive = ['button', 'a[href]', 'input:not([type="hidden"])', 'select', 'textarea'];
    
    for (const selector of interactive) {
        const elements = page.locator(selector);
        const count = await elements.count();
        
        for (let i = 0; i < count; i++) {
            const element = elements.nth(i);
            const hasAriaLabel = await element.getAttribute('aria-label');
            const hasAriaLabelledby = await element.getAttribute('aria-labelledby');
            const visibleText = (await element.textContent() || '').trim();
            const isVisible = await element.isVisible();
            
            if (isVisible && !hasAriaLabel && !hasAriaLabelledby && visibleText === '') {
                const tagName = await element.evaluate(el => el.tagName.toLowerCase());
                const id = await element.getAttribute('id');
                issues.push({
                    element: id ? `#${id}` : `${tagName}[${i}]`,
                    issue: `Interactive ${tagName} missing accessible label`
                });
            }
        }
    }
    return issues;
}

export async function checkHeadingHierarchy(page: Page): Promise<Array<{level: number, text: string, issue: string}>> {
    const issues: Array<{level: number, text: string, issue: string}> = [];
    const headings = page.locator('h1, h2, h3, h4, h5, h6');
    const count = await headings.count();
    
    let previousLevel = 0;
    let hasH1 = false;
    
    for (let i = 0; i < count; i++) {
        const heading = headings.nth(i);
        const tagName = await heading.evaluate(el => el.tagName.toLowerCase());
        const level = parseInt(tagName.substring(1), 10);
        const text = (await heading.textContent() || '').trim();
        
        if (text === '') continue;
        
        if (level === 1) {
            if (hasH1) issues.push({ level, text, issue: 'Multiple h1 elements' });
            hasH1 = true;
        }
        
        if (previousLevel > 0 && level - previousLevel > 1) {
            issues.push({ level, text, issue: `Skipped from h${previousLevel} to h${level}` });
        }
        
        previousLevel = level;
    }
    
    if (!hasH1 && count > 0) {
        issues.push({ level: 1, text: 'Page', issue: 'No h1 heading found' });
    }
    
    return issues;
}

export function formatA11yReport(issues: any): string {
    const sections: string[] = ['# Accessibility Audit Report\n'];
    
    const total = (issues.altText?.length || 0) + (issues.ariaLabels?.length || 0) + (issues.headingHierarchy?.length || 0);
    sections.push(`## Summary\nFound ${total} potential issues.\n`);
    
    if (issues.altText?.length) {
        sections.push(`## Image Alt Text (${issues.altText.length})\n`);
        issues.altText.forEach((issue: any) => sections.push(`- ${issue.element}: ${issue.issue}`));
        sections.push('');
    }
    
    if (issues.ariaLabels?.length) {
        sections.push(`## ARIA Labels (${issues.ariaLabels.length})\n`);
        issues.ariaLabels.forEach((issue: any) => sections.push(`- ${issue.element}: ${issue.issue}`));
        sections.push('');
    }
    
    if (issues.headingHierarchy?.length) {
        sections.push(`## Heading Hierarchy (${issues.headingHierarchy.length})\n`);
        issues.headingHierarchy.forEach((issue: any) => sections.push(`- h${issue.level}: "${issue.text}" - ${issue.issue}`));
        sections.push('');
    }
    
    sections.push('## Recommendations');
    sections.push('1. Add alt text to informative images');
    sections.push('2. Ensure interactive elements have labels');
    sections.push('3. Maintain proper heading hierarchy');
    
    return sections.join('\n');
}