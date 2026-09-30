import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buttonClasses } from '../buttonClasses';

/**
 * AC-RAM-004 (#688) regression fix (2026-09-29): the FIRST pass at the solid destructive-button
 * contrast defect darkened `--destructive` ITSELF (0 80% 62% → 0 80% 46%) in the dark theme. But
 * `--destructive` doubles as the raw hue behind `text-destructive` (error text, ~30 callsites) and
 * the status dot/bar — both want the brighter raw hue for THEIR OWN contrast against the dark
 * canvas. Darkening it fixed the button and broke every `text-destructive` usage (dark error text
 * fell to ~3.5:1, sub-AA).
 *
 * The fix splits the concerns the same way DESIGN.md's "Solid fills" note already prescribes for
 * `--primary`/`-solid`: a dedicated `--destructive-solid` token, used ONLY as the solid destructive
 * BUTTON background, leaving the raw `--destructive` hue (and `text-destructive`/dot/bar) restored
 * to its original bright value.
 *
 * Token VALUES are read straight out of `index.css` (the single source of truth) rather than
 * hardcoded here, matching `AdminUsers.avatarContrast.test.ts` / `checkboxBorderContrast.test.ts` —
 * the test stays honest if the palette is retuned.
 */

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [255 * f(0), 255 * f(8), 255 * f(4)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const srgb = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(rgb1: [number, number, number], rgb2: [number, number, number]): number {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const AA_TEXT_MIN_CONTRAST = 4.5;

function parseHslTokens(cssBlock: string): Record<string, [number, number, number]> {
  const tokens: Record<string, [number, number, number]> = {};
  const re = /--([a-z0-9-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssBlock))) {
    tokens[m[1]] = [parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
  }
  return tokens;
}

const cssPath = join(__dirname, '..', '..', '..', '..', 'index.css');
const css = readFileSync(cssPath, 'utf8');

function extractBlock(source: string, selector: string): string {
  const start = source.indexOf(selector);
  if (start === -1) throw new Error(`selector "${selector}" not found in index.css`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart + 1, i);
    }
  }
  throw new Error(`unbalanced braces for selector "${selector}"`);
}

const rootBlock = extractBlock(css, ':root {');
const lightTokens = parseHslTokens(rootBlock);
const darkBlock = extractBlock(css, '.dark {');
const darkTokens = parseHslTokens(darkBlock);

describe('AC-RAM-004 regression: --destructive/--destructive-solid split', () => {
  it('a dedicated --destructive-solid token exists in both themes', () => {
    expect(lightTokens['destructive-solid']).toBeDefined();
    expect(darkTokens['destructive-solid']).toBeDefined();
  });

  it('dark --destructive-solid (the solid BUTTON fill) with white text clears AA (was 3.58:1)', () => {
    const solidRgb = hslToRgb(...darkTokens['destructive-solid']);
    const whiteRgb: [number, number, number] = [255, 255, 255];
    expect(contrastRatio(solidRgb, whiteRgb)).toBeGreaterThanOrEqual(AA_TEXT_MIN_CONTRAST);
  });

  it('dark --destructive (the raw hue behind text-destructive/dot/bar) on --background clears AA', () => {
    const destructiveRgb = hslToRgb(...darkTokens['destructive']);
    const bgRgb = hslToRgb(...darkTokens['background']);
    expect(contrastRatio(destructiveRgb, bgRgb)).toBeGreaterThanOrEqual(AA_TEXT_MIN_CONTRAST);
  });

  it('regression guard: the darkened dark --destructive (0 80% 46%, the shipped-then-reverted value) as TEXT on --background would fail this gate', () => {
    const regressedRgb = hslToRgb(0, 80, 46);
    const bgRgb = hslToRgb(...darkTokens['background']);
    const ratio = contrastRatio(regressedRgb, bgRgb);
    expect(ratio).toBeLessThan(AA_TEXT_MIN_CONTRAST);
  });

  it('light --destructive-solid matches the current light --destructive (never regressed, unchanged)', () => {
    expect(lightTokens['destructive-solid']).toEqual(lightTokens['destructive']);
  });

  it('the destructive Button variant wires bg-destructive-solid, not the raw bg-destructive class', () => {
    const classes = buttonClasses('destructive', 'default').split(/\s+/);
    expect(classes).toContain('bg-destructive-solid');
    expect(classes).toContain('hover:bg-destructive-solid/90');
    expect(classes).not.toContain('bg-destructive');
    expect(classes).not.toContain('hover:bg-destructive/90');
  });
});
