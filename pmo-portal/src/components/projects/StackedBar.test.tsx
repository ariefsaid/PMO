import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StackedBar } from './StackedBar';

describe('project stacked bar', () => {
  it('shows the name and value of a slice too narrow for an on-bar label', () => {
    render(<StackedBar
      ariaLabel="Tasks by status"
      otherLabel="Other"
      segments={[
        { key: 'done', label: 'Done', value: 19, display: '19' },
        { key: 'blocked', label: 'Blocked', value: 1, display: '1', accent: true },
      ]}
    />);

    const legend = screen.getByRole('img', { name: 'Tasks by status legend: Blocked' });
    expect(legend).toBeVisible();
    expect(legend).toHaveTextContent('Blocked');
  });
});

/**
 * UX-1110 R2-CONTRAST — the measured `contrast` FAIL on this component:
 * `projects-budget-pm@390` ("Materials $3.6M" / "Equipment $1.3M") and
 * `projects-tasks-pm` ("To Do 5" / "In Progress 8") measured 1.1:1
 * (#f1f5f9 on #ffffff) — the first two ramp steps were alpha fills
 * (`bg-foreground/85`, `bg-foreground/70`), so a contrast probe read the CARD behind the
 * segment instead of the segment, and the label pair could not be proved at all.
 *
 * The ramp is now opaque token fills: `foreground` → `chart-neutral-mid` → `secondary` → `muted`.
 * These tests pin the classes and re-derive every ink/fill ratio from `index.css`, so a retune
 * (or a translucent fill creeping back) fails here rather than on a rendered audit.
 */

const TEXT_AA_MIN = 4.5;

/** The ramp as shipped, in render order, with the ink each step carries. */
const RAMP = [
  { fill: 'bg-foreground', ink: 'text-background' },
  { fill: 'bg-chart-neutral-mid', ink: 'text-background' },
  { fill: 'bg-secondary', ink: 'text-foreground' },
  { fill: 'bg-muted', ink: 'text-foreground' },
] as const;

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

const css = readFileSync(join(__dirname, '..', '..', '..', 'index.css'), 'utf8');
const THEMES = [
  { name: 'light', tokens: themeTokens(css, ':root {') },
  { name: 'dark', tokens: themeTokens(css, '.dark {') },
];

/** Five segments so every ramp step (and the one accent) is rendered: segments sort by value. */
const segments = [
  { key: 'todo', label: 'To Do', value: 5, display: '5' },
  { key: 'inprog', label: 'In Progress', value: 8, display: '8' },
  { key: 'blocked', label: 'Blocked', value: 2, display: '2', accent: true },
  { key: 'done', label: 'Done', value: 9, display: '9' },
  { key: 'other', label: 'Other', value: 1, display: '1' },
];

describe('project stacked bar — R2-CONTRAST: on-bar labels use opaque DESIGN.md tokens', () => {
  it('draws every segment with an opaque token fill and the ink token that pairs with it', () => {
    render(<StackedBar ariaLabel="Tasks by status" otherLabel="Other" segments={segments} />);
    const nodes = Array.from(screen.getByTestId('stacked-bar').children) as HTMLElement[];
    expect(nodes).toHaveLength(5);
    for (const node of nodes) {
      // The label sits ON the segment: the ink must pair with the fill below, never the card.
      expect(node.className, 'no alpha fill: a tint measures as the card behind it').not.toMatch(/\bbg-[\w-]+\/\d/);
      expect(node.className).not.toMatch(/text-white/); // raw colour, not a token
    }
    // Sorted by value: done 9, In Progress 8, To Do 5, Blocked 2, Other 1 — steps 1-4 then the accent.
    const [first, second, third, accent, fourth] = nodes as [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(first.className).toContain(RAMP[0].fill);
    expect(first.className).toContain(RAMP[0].ink);
    expect(second.className).toContain(RAMP[1].fill);
    expect(second.className).toContain(RAMP[1].ink);
    expect(third.className).toContain(RAMP[2].fill);
    expect(third.className).toContain(RAMP[2].ink);
    expect(fourth.className).toContain(RAMP[3].fill);
    expect(fourth.className).toContain(RAMP[3].ink);
    // The one accent step keeps its own paired foreground token (dark theme needs the dark ink).
    expect(accent.className).toContain('bg-destructive');
    expect(accent.className).toContain('text-destructive-foreground');
  });

  it.each(THEMES)('every labelled ink/fill pair clears 4.5:1 in $name', ({ tokens }) => {
    const rgb = (name: string) => {
      const hsl = tokens[name];
      expect(hsl, `--${name} missing from index.css`).toBeDefined();
      return hslToRgb(hsl![0], hsl![1], hsl![2]);
    };
    for (const step of RAMP) {
      const fill = step.fill.replace(/^bg-/, '');
      const ink = step.ink.replace(/^text-/, '');
      const ratio = contrastRatio(rgb(ink), rgb(fill));
      expect(ratio, `${step.ink} on ${step.fill}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(TEXT_AA_MIN);
    }
    const accentRatio = contrastRatio(rgb('destructive-foreground'), rgb('destructive'));
    expect(accentRatio, `text-destructive-foreground on bg-destructive: ${accentRatio.toFixed(2)}:1`)
      .toBeGreaterThanOrEqual(TEXT_AA_MIN);
  });
});
