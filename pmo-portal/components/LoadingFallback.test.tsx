import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LoadingFallback } from './LoadingFallback';
import { contrastRatio, themeTokens } from '../src/test/a11yContrast';

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
    const token = (name: string) => {
      const hsl = tokens[name];
      expect(hsl, `--${name} missing from index.css`).toBeDefined();
      return hsl!;
    };
    for (const surface of ['background', 'card'] as const) {
      const ratio = contrastRatio(token('muted-foreground'), token(surface));
      expect(ratio, `muted-foreground on ${surface}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(TEXT_AA_MIN);
    }
    expect(contrastRatio(token('primary'), token('background')), 'primary spinner is a graphical mark').toBeGreaterThanOrEqual(MARK_AA_MIN);
  });
});
