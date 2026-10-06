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
      .replace(/@media[^{]+\{/g, '') // look inside media queries; their closing braces split to empty segments
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

  // The block of rules inside `@media (<query>) { … }` (one nesting level).
  const media = (query: string): string => {
    const start = css.indexOf(`@media ${query}`);
    expect(start, `@media ${query}`).toBeGreaterThan(-1);
    const open = css.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
    }
    throw new Error('unbalanced @media');
  };

  it('AC-MTG-022 the editor reserves room for the side menu (52px) on the inline-start — spacing-14, 56px — from 640px up', () => {
    expect(media('(min-width: 640px)')).toMatch(/\.minutes-editor \.bn-editor\s*\{\s*padding-inline-start:\s*56px/);
    // the base rule must not already pad (mobile gets no indent)
    expect(css).toMatch(/\.minutes-editor \.bn-editor\s*\{\s*padding:\s*0;/);
  });

  it('AC-MTG-022 below 640px the side menu is not offered (its handle would sit outside the viewport)', () => {
    expect(media('(max-width: 639px)')).toMatch(/\.minutes-editor \.bn-side-menu\s*\{\s*display:\s*none/);
  });

  it('AC-MTG-022 below 640px the slash menu hides shortcut hints and keeps a 16px margin from the viewport edge', () => {
    const mobile = media('(max-width: 639px)');
    expect(mobile).toMatch(/\.bn-suggestion-menu-item \[data-position='right'\]\s*\{\s*display:\s*none/);
    expect(mobile).toMatch(/\.minutes-slash-popover\s*\{\s*padding-inline:\s*16px/);
    expect(mobile).toMatch(/max-width:\s*calc\(100vw - 32px\)/);
  });
});
