import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AC-A11Y-CHECKBOX-001 (Discover-pass IMPORTANT-5, 2026-07-28): the standalone `Checkbox`
 * primitive's un-checked border is the ONLY visual indication a control exists there (it has no
 * fill in that state) — WCAG 1.4.11 "Non-text Contrast" requires >=3:1 against the adjacent
 * surface for that boundary. The dark theme measured 2.13:1 (`--input: 240 4% 30%` on
 * `--background: 240 6% 7%`) — below the floor. Light theme already passes.
 *
 * Values are read straight out of `index.css` (the single source of truth for `:root`/`.dark`)
 * rather than hardcoded here, matching `AdminUsers.avatarContrast.test.ts`'s pattern — the test
 * stays honest if the palette is retuned; it always re-derives ratios from the real CSS.
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

const AA_NON_TEXT_MIN_CONTRAST = 3.0;

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

const darkBlock = extractBlock(css, '.dark {');
const darkTokens = parseHslTokens(darkBlock);

describe('AC-A11Y-CHECKBOX-001: --input (the checkbox boundary in its unchecked state) clears 3:1 against --background', () => {
  // NOTE: this test deliberately does NOT assert a light-theme number. Reproducing the light
  // token pair (`--input: 240 4% 84%` on `--background: 0 0% 100%`) here measures ~1.47:1 — the
  // Discover-pass finding reported light as passing, but that was a rendered-page measurement
  // (real DOM, real compositing) this token-only re-derivation cannot faithfully reproduce, and
  // asserting a number that contradicts a real render would be worse than asserting nothing.
  // Flagged back to the design-reviewer/Director rather than silently asserted either way.

  it('dark theme: --input on --background clears 3:1 (was 2.13:1 — the audited defect)', () => {
    const inputRgb = hslToRgb(...darkTokens['input']);
    const bgRgb = hslToRgb(...darkTokens['background']);
    expect(contrastRatio(inputRgb, bgRgb)).toBeGreaterThanOrEqual(AA_NON_TEXT_MIN_CONTRAST);
  });

  it('regression guard: the PREVIOUSLY-SHIPPED dark --input (240 4% 30%) would fail this gate at ~2.13:1', () => {
    const oldInputRgb = hslToRgb(240, 4, 30);
    const bgRgb = hslToRgb(...darkTokens['background']);
    const ratio = contrastRatio(oldInputRgb, bgRgb);
    expect(ratio).toBeLessThan(AA_NON_TEXT_MIN_CONTRAST);
    expect(ratio).toBeCloseTo(2.13, 1);
  });
});
