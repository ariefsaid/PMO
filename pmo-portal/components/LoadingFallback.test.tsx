import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LoadingFallback } from './LoadingFallback';

/**
 * UX-1110 R2-CONTRAST — the measured `contrast` pair on the route-loading state:
 * `home-admin@768`, `home-finance@1440`, `projects-*@1440` measured the visible "Loading…"
 * text at 4.4:1 (needs 4.5:1). The producer was `text-gray-500` (Tailwind's raw #6b7280,
 * 4.41:1 on the `--background` canvas) — a raw colour, not a DESIGN.md token.
 *
 * The label now takes the `muted-foreground` token, which the ratio check below re-derives
 * from `index.css` in both themes so a palette retune cannot silently drop it under AA.
 */

const TEXT_AA_MIN = 4.5;
const MARK_AA_MIN = 3.0;

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

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)];
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

function parseHslTokens(cssBlock: string): Record<string, [number, number, number]> {
  const tokens: Record<string, [number, number, number]> = {};
  const re = /--([a-z0-9-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssBlock))) tokens[m[1]!] = [parseFloat(m[2]!), parseFloat(m[3]!), parseFloat(m[4]!)];
  return tokens;
}

/** The token block that starts at `selector` and closes at its own brace. */
function themeTokens(css: string, selector: string): Record<string, [number, number, number]> {
  const start = css.indexOf(selector);
  expect(start, `${selector} missing from index.css`).toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return parseHslTokens(css.slice(open + 1, i));
  }
  throw new Error(`unbalanced braces for ${selector}`);
}

const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf8');
const THEMES = [
  { name: 'light', tokens: themeTokens(css, ':root {') },
  { name: 'dark', tokens: themeTokens(css, '.dark {') },
];

describe('LoadingFallback — the loading label uses DESIGN.md tokens that clear AA', () => {
  it('renders the visible "Loading…" label in the muted-foreground token, not a raw grey', () => {
    render(<LoadingFallback />);
    const label = screen.getByText('Loading…');
    const inkBlock = label.parentElement!;
    expect(inkBlock.className).toContain('text-muted-foreground');
    // No raw Tailwind palette colour anywhere in the fallback (the measured defect was `text-gray-500`).
    const html = screen.getByRole('status').outerHTML;
    expect(html).not.toMatch(/text-(gray|slate|zinc|neutral|stone|blue)-\d/);
  });

  it.each(THEMES)('holds 4.5:1 for the label and 3:1 for the spinner in $name', ({ tokens }) => {
    const rgb = (name: string) => {
      const hsl = tokens[name];
      expect(hsl, `--${name} missing from index.css`).toBeDefined();
      return hslToRgb(hsl![0], hsl![1], hsl![2]);
    };
    for (const surface of ['background', 'card'] as const) {
      const ratio = contrastRatio(rgb('muted-foreground'), rgb(surface));
      expect(ratio, `muted-foreground on ${surface}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(TEXT_AA_MIN);
    }
    expect(contrastRatio(rgb('primary'), rgb('background')), 'primary spinner is a graphical mark').toBeGreaterThanOrEqual(MARK_AA_MIN);
  });
});
