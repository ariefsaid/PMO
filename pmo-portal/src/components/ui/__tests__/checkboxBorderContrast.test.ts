import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AC-A11Y-CHECKBOX-001: a checkbox's border is visible.
 *
 * The unchecked `Checkbox` (and every `border-input` control) has no fill — its `--input`
 * border is the ONLY visual indication a control exists there, so it is a standalone control
 * boundary and WCAG 1.4.11 "Non-text Contrast" requires >=3:1 against the surface it sits on.
 * Rewritten 2026-10-28 (visual step 1, #1452) to assert that floor directly, in BOTH themes,
 * against EVERY surface a checkbox/input is hosted on (`background`, `card`, `popover`) —
 * replacing the earlier dark-only probe pinned to the historical 2.13:1 measurement.
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

/** Surfaces a checkbox/input control is hosted on. */
const HOST_SURFACES = ['background', 'card', 'popover'] as const;

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

const themeTokens: Array<{ theme: string; tokens: Record<string, [number, number, number]> }> = [
  { theme: 'light (:root)', tokens: parseHslTokens(extractBlock(css, ':root {')) },
  { theme: 'dark (.dark)', tokens: parseHslTokens(extractBlock(css, '.dark {')) },
];

describe('AC-A11Y-CHECKBOX-001: the --input control boundary clears 3:1 on every host surface, both themes', () => {
  for (const { theme, tokens } of themeTokens) {
    it(`${theme}: --input clears 3:1 against background, card, and popover`, () => {
      expect(tokens['input']).toBeDefined();
      const inputRgb = hslToRgb(...tokens['input']);
      for (const surface of HOST_SURFACES) {
        expect(tokens[surface], `--${surface} missing`).toBeDefined();
        const ratio = contrastRatio(inputRgb, hslToRgb(...tokens[surface]));
        expect(ratio, `--input on --${surface} measured ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          AA_NON_TEXT_MIN_CONTRAST
        );
      }
    });
  }
});
