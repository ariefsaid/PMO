import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const E2E_DIR = resolve(__dirname, '../../e2e');

const GATES = [
  'AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts',
  'AC-VISUAL-ICON-001-no-oversized-icons.spec.ts',
];

/** Slice the hand-maintained `const ROUTES = [ … ];` block from a gate file. */
function routesBlock(fileName: string): string {
  const src = readFileSync(resolve(E2E_DIR, fileName), 'utf8');
  const start = src.indexOf('const ROUTES');
  expect(start, `${fileName}: no ROUTES array found`).toBeGreaterThan(-1);
  const end = src.indexOf('];', start);
  expect(end, `${fileName}: ROUTES array not closed`).toBeGreaterThan(start);
  return src.slice(start, end + 2);
}

describe('AC-LEG-026 — legal routes present in both sweep ROUTES arrays', () => {
  for (const gate of GATES) {
    it(`${gate}: ROUTES contains /terms and /privacy`, () => {
      const block = routesBlock(gate);
      expect(block, `${gate}: missing /terms entry`).toMatch(/path:\s*'\/terms'/);
      expect(block, `${gate}: missing /privacy entry`).toMatch(/path:\s*'\/privacy'/);
    });
  }
});
