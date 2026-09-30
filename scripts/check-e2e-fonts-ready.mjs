#!/usr/bin/env node
// Guard (#713): an e2e spec that MEASURES layout must wait for web fonts first.
//
// The app's Inter faces use `font-display: swap`, so text is first laid out in the fallback face
// and re-laid-out when Inter arrives. A spec that reads boundingBox()/getBoundingClientRect()/
// scrollWidth in that window can see a different text width than the settled page and flip its
// result at a column boundary. The fix is `await waitForFonts(page)` (e2e/helpers.ts) AFTER the
// content is visible (fonts are only requested once text is laid out) and BEFORE measuring.
//
// Heuristic, file-level: any spec containing a geometry read must also call waitForFonts(.
// Run with --self-test to prove the detector catches a violation and accepts a compliant file.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E2E_DIR = path.join(ROOT, 'pmo-portal', 'e2e');

// Reads whose value depends on text width. (scrollHeight/scrollTo alone is scroll control, not
// measurement, and is deliberately not listed.)
const MEASURES = /\.boundingBox\(|getBoundingClientRect\(|\.scrollWidth\b|\.clientWidth\b|\.offsetWidth\b/;
const WAITS = /\bwaitForFonts\(/;

/** Strip comment-only lines so documenting the rule (or a metric name) cannot trip it. */
function code(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
}

export function violates(source) {
  const body = code(source);
  return MEASURES.test(body) && !WAITS.test(body);
}

function specFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : specFiles(full);
    return entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

if (process.argv.includes('--self-test')) {
  const cases = [
    ['measures without waiting', 'const b = await el.boundingBox();', true],
    ['in-page measure without waiting', 'page.evaluate(() => x.getBoundingClientRect())', true],
    ['scrollWidth without waiting', 'document.documentElement.scrollWidth', true],
    ['measures after waiting', 'await waitForFonts(page);\nconst b = await el.boundingBox();', false],
    ['no measurement at all', "await expect(page).toHaveURL('/')", false],
    ['scroll control only', 'el.scrollTo(0, el.scrollHeight)', false],
    ['metric named only in a comment', '// boundingBox() is read here\nawait x()', false],
  ];
  const wrong = cases.filter(([, src, expected]) => violates(src) !== expected);
  if (wrong.length) {
    for (const [name] of wrong) console.error(`self-test FAILED: ${name}`);
    process.exit(1);
  }
  console.log(`check-e2e-fonts-ready --self-test: OK (${cases.length} cases)`);
  process.exit(0);
}

const offenders = specFiles(E2E_DIR).filter((f) => violates(readFileSync(f, 'utf8')));
if (offenders.length) {
  console.error('e2e specs measure layout without `await waitForFonts(page)` (#713):');
  for (const f of offenders) console.error(`  ${path.relative(ROOT, f)}`);
  process.exit(1);
}
console.log('check-e2e-fonts-ready: OK');
