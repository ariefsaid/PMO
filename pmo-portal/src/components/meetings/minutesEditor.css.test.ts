import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raw = readFileSync(resolve(__dirname, 'minutesEditor.css'), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

/** Split a selector list on top-level commas only (`:where(a, b)` stays whole). */
const splitSelectors = (list: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

describe('minutesEditor.css — heading scale and scope (FR-MTG-025)', () => {
  it('AC-MTG-022 pins BlockNote’s --level to DESIGN.md’s 24 / 20 / 18 / 14 px hierarchy', () => {
    expect(css).toMatch(/\[data-content-type='heading'\]\s*\{\s*--level:\s*24px/);
    expect(css).toMatch(/\[data-level='2'\]\s*\{\s*--level:\s*20px/);
    expect(css).toMatch(/\[data-level='3'\]\s*\{\s*--level:\s*18px/);
    expect(css).toMatch(/--level:\s*14px/);
    // BlockNote's own em scale must not appear
    expect(css).not.toMatch(/--level:\s*[\d.]+em/);
  });

  it('AC-MTG-022 the prev-level animation var carries the same px scale (no frame uses the stock one)', () => {
    expect(css).toMatch(/data-prev-level='1'\]\s*\{\s*--prev-level:\s*24px/);
    expect(css).toMatch(/data-prev-level='2'\]\s*\{\s*--prev-level:\s*20px/);
    expect(css).toMatch(/data-prev-level='3'\]\s*\{\s*--prev-level:\s*18px/);
  });

  it('keeps every rule under .minutes-editor / .minutes-action-item so nothing leaks app-wide', () => {
    const selectors = css
      .split('}')
      .map((r) => r.split('{')[0].trim())
      .filter(Boolean)
      .flatMap(splitSelectors);
    for (const s of selectors) expect(s, s).toMatch(/^\.minutes-(editor|action-item)/);
  });

  it('AC-MOBILE-OVERFLOW-001 long strings wrap and tables/code scroll inside the editor', () => {
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/tableWrapper\s*\{[^}]*overflow-x:\s*auto/);
  });

  it('uses only app tokens for colour (no raw hex)', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
