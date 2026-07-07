import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AVATAR_HUES } from '../AdminUsers';

/**
 * AC-A11Y-AVATAR-001: every categorical hue the Avatar's `avatarHue()` picker can
 * return must clear WCAG-AA 4.5:1 contrast for its BOLD WHITE initials, in BOTH
 * themes. Two independent audits flagged raw `--warning` (#faa805, 1.96:1) and raw
 * `--success` (#2bab5a, 2.96:1) as AA failures — this is the durable, deterministic
 * gate so a future hue/token edit cannot silently regress below 4.5:1 again.
 *
 * The token VALUES are read straight out of `index.css` (the single source of
 * truth for `:root` light + `.dark`) rather than hardcoded here, so the test stays
 * honest if the palette is retuned — it always re-derives ratios from the real CSS.
 */

// ---- WCAG relative-luminance / contrast-ratio helpers (small, self-contained) ----
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

const WHITE: [number, number, number] = [255, 255, 255];
const AA_MIN_CONTRAST = 4.5;

/** Extract `--token: H S% L%;` triplets from a CSS block (`:root { ... }` or `.dark { ... }`). */
function parseHslTokens(cssBlock: string): Record<string, [number, number, number]> {
  const tokens: Record<string, [number, number, number]> = {};
  const re = /--([a-z0-9-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssBlock))) {
    tokens[m[1]] = [parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
  }
  return tokens;
}

const cssPath = join(__dirname, '..', '..', 'index.css');
const css = readFileSync(cssPath, 'utf8');

// Split :root { ... } (light) from .dark { ... } blocks by locating their braces.
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

const lightBlock = extractBlock(css, ':root {');
const darkBlock = extractBlock(css, '.dark {');
const lightTokens = parseHslTokens(lightBlock);
const darkTokens = parseHslTokens(darkBlock);

// The Avatar's hue picker (AVATAR_HUES) references `hsl(var(--avatar-N))` — pull the
// token names it actually uses so the test enumerates EVERY hue the picker can return.
const avatarTokenNames = AVATAR_HUES.map((entry) => {
  const match = /--([a-z0-9-]+)/.exec(entry);
  if (!match) throw new Error(`could not parse token name out of AVATAR_HUES entry "${entry}"`);
  return match[1];
});

describe('AC-A11Y-AVATAR-001: Avatar categorical hues clear AA 4.5:1 for white bold initials', () => {
  it('AVATAR_HUES is non-empty and every entry references a --avatar-* token', () => {
    expect(avatarTokenNames.length).toBeGreaterThan(0);
    for (const name of avatarTokenNames) {
      expect(name).toMatch(/^avatar-/);
    }
  });

  it.each(avatarTokenNames)('light theme: --%s clears 4.5:1 against white', (tokenName) => {
    const hsl = lightTokens[tokenName];
    expect(hsl, `--${tokenName} not found in :root of index.css`).toBeDefined();
    const rgb = hslToRgb(...hsl);
    const ratio = contrastRatio(WHITE, rgb);
    expect(ratio).toBeGreaterThanOrEqual(AA_MIN_CONTRAST);
  });

  it.each(avatarTokenNames)('dark theme: --%s clears 4.5:1 against white', (tokenName) => {
    const hsl = darkTokens[tokenName];
    expect(hsl, `--${tokenName} not found in .dark of index.css`).toBeDefined();
    const rgb = hslToRgb(...hsl);
    const ratio = contrastRatio(WHITE, rgb);
    expect(ratio).toBeGreaterThanOrEqual(AA_MIN_CONTRAST);
  });

  it('regression guard: the previously-flagged raw tokens (--warning, --success) would fail this gate', () => {
    // Sanity check that the helper correctly reproduces the two audit-flagged
    // failures on the OLD raw tokens, so we know the test is measuring the real thing.
    const warningLight = lightTokens['warning'];
    const successLight = lightTokens['success'];
    expect(contrastRatio(WHITE, hslToRgb(...warningLight))).toBeLessThan(4.5);
    expect(contrastRatio(WHITE, hslToRgb(...successLight))).toBeLessThan(4.5);
  });
});
