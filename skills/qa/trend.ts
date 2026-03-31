/**
 * QA trend tracking for gstack health scores across runs
 * 
 * Provides functions for tracking, detecting regressions, and formatting trend reports
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

/**
 * Baseline data structure stored in JSONL format
 */
interface Baseline {
  date: string;    // ISO string: new Date().toISOString()
  score: number;   // health score (0-100)
  url: string;     // target URL tested
  reportPath?: string; // optional path to the full report
}

/**
 * saveBaseline: appends a baseline record to a baselines.jsonl file
 * 
 * @param reportPath - path to the report directory (e.g., ".gstack/qa-reports")
 * @param score - health score (0-100)
 * @param url - target URL tested
 */
export function saveBaseline(reportPath: string, score: number, url: string): void {
  // Ensure the skills/qa directory exists for storing baselines
  const skillsQaDir = join(process.cwd(), 'skills', 'qa');
  if (!existsSync(skillsQaDir)) {
    mkdirSync(skillsQaDir, { recursive: true });
  }
  
  const baselineFile = join(skillsQaDir, '.baselines.jsonl');
  
  const baseline: Baseline = {
    date: new Date().toISOString(),
    score,
    url,
    reportPath
  };
  
  // Append JSON line
  const line = JSON.stringify(baseline) + '\n';
  appendFileSync(baselineFile, line, { encoding: 'utf-8' });
}

/**
 * loadBaselines: reads baseline history for a given report path
 * 
 * @param reportPath - path to filter by (matches reportPath field)
 * @returns array of baseline objects, most recent first
 */
export function loadBaselines(reportPath: string): Baseline[] {
  const skillsQaDir = join(process.cwd(), 'skills', 'qa');
  const baselineFile = join(skillsQaDir, '.baselines.jsonl');
  
  if (!existsSync(baselineFile)) {
    return [];
  }
  
  const content = readFileSync(baselineFile, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.trim());
  
  const allBaselines: Baseline[] = lines.map(line => {
    try {
      return JSON.parse(line) as Baseline;
    } catch {
      // Invalid JSON line - skip
      return null;
    }
  }).filter((b): b is Baseline => b !== null);
  
  // Filter by reportPath (if provided) and sort by date descending
  const filtered = reportPath
    ? allBaselines.filter(b => b.reportPath === reportPath)
    : allBaselines;
  
  return filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * Regression detection result
 */
interface Regression {
  index: number;   // index in the baselines array (0 = most recent)
  delta: number;   // score drop (negative number, e.g., -12)
  previousScore: number;
  currentScore: number;
  date: string;    // date of the regression baseline
  previousDate?: string;
}

/**
 * detectRegressions: finds score drops >5 points in baseline history
 * 
 * @param baselines - array of baselines sorted by date descending (most recent first)
 * @returns array of regressions
 */
export function detectRegressions(baselines: Baseline[]): Regression[] {
  if (baselines.length < 2) {
    return [];
  }
  
  const regressions: Regression[] = [];
  
  // Compare each baseline with the next one (chronological order)
  // Since baselines is sorted descending (newest first), we iterate from newest to oldest
  // We compare baseline[i] (current) with baseline[i+1] (previous)
  for (let i = 0; i < baselines.length - 1; i++) {
    const current = baselines[i];
    const previous = baselines[i + 1];
    
    const delta = current.score - previous.score;
    
    // Detect regression if score drops by more than 5 points
    if (delta < -5) {
      regressions.push({
        index: i,
        delta,
        previousScore: previous.score,
        currentScore: current.score,
        date: current.date,
        previousDate: previous.date
      });
    }
  }
  
  return regressions;
}

/**
 * formatTrendReport: formats a markdown trend table
 * 
 * @param baselines - array of baselines
 * @returns markdown string with trend table and regression alerts
 */
export function formatTrendReport(baselines: Baseline[]): string {
  if (baselines.length === 0) {
    return '## QA Trend Report\n\nNo baseline data available.\n';
  }
  
  const regressions = detectRegressions(baselines);
  
  let markdown = '## QA Trend Report\n\n';
  
  // Summary stats
  const scores = baselines.map(b => b.score);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const latest = baselines[0];
  
  markdown += `**Latest score:** ${latest.score}/100 (${latest.date})\n`;
  markdown += `**Average score:** ${avgScore.toFixed(1)}/100\n`;
  markdown += `**Score range:** ${minScore}–${maxScore}\n`;
  markdown += `**Total runs:** ${baselines.length}\n\n`;
  
  // Regression alerts
  if (regressions.length > 0) {
    markdown += '### ⚠️ Regression Alerts\n\n';
    regressions.forEach(r => {
      markdown += `- **Score dropped ${Math.abs(r.delta)} points** (${r.previousScore} → ${r.currentScore}) on ${new Date(r.date).toLocaleDateString()}\n`;
    });
    markdown += '\n';
  } else if (baselines.length >= 2) {
    const latestDelta = baselines[0].score - baselines[1].score;
    if (latestDelta > 0) {
      markdown += `📈 **Score improved by +${latestDelta} points** from previous run\n\n`;
    } else if (latestDelta >= -5) {
      markdown += `📊 **Score stable** (change: ${latestDelta} points)\n\n`;
    }
  }
  
  // Trend table
  markdown += '### Trend History\n\n';
  markdown += '| Date | Score | URL | Change |\n';
  markdown += '|------|-------|-----|--------|\n';
  
  for (let i = 0; i < baselines.length; i++) {
    const b = baselines[i];
    const dateStr = new Date(b.date).toLocaleDateString();
    const scoreStr = `${b.score}/100`;
    const urlShort = b.url.length > 30 ? b.url.substring(0, 30) + '…' : b.url;
    
    // Calculate change from previous (if exists)
    let change = '';
    if (i < baselines.length - 1) {
      const prev = baselines[i + 1];
      const delta = b.score - prev.score;
      if (delta > 0) {
        change = `🟢 +${delta}`;
      } else if (delta < -5) {
        change = `🔴 ${delta}`;
      } else if (delta < 0) {
        change = `🟡 ${delta}`;
      } else {
        change = '🟡 0';
      }
    } else {
      change = '—';
    }
    
    markdown += `| ${dateStr} | ${scoreStr} | ${urlShort} | ${change} |\n`;
  }
  
  // Health trend indicator
  if (baselines.length >= 3) {
    const recentScores = baselines.slice(0, 3).map(b => b.score);
    const trend = recentScores[0] - recentScores[2];
    markdown += '\n';
    if (trend > 10) {
      markdown += '> **Trend:** 🔥 Strong improvement over last 3 runs\n';
    } else if (trend > 0) {
      markdown += '> **Trend:** 📈 Gradual improvement\n';
    } else if (trend > -10) {
      markdown += '> **Trend:** 📉 Slight decline\n';
    } else {
      markdown += '> **Trend:** ⚠️ Significant decline\n';
    }
  }
  
  return markdown;
}

// Example usage (commented out for production)
/*
// Save a baseline after QA run
saveBaseline('.gstack/qa-reports', 85, 'https://example.com');

// Load baselines for a report path
const baselines = loadBaselines('.gstack/qa-reports');

// Detect regressions
const regressions = detectRegressions(baselines);

// Format report
const report = formatTrendReport(baselines);
console.log(report);
*/