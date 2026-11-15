import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrBanner } from '../ErrBanner';
import { SuccessNotice } from '@/src/auth/authFormPrimitives';

/**
 * AC-A11Y-DARK-STATUS-001 (#2090) — error / success text follows the theme.
 *
 * jsdom has no layout, so axe's colour-contrast rule cannot run in the unit layer. The gate is
 * therefore split in two deterministic halves: (1) the dark AND light values of the status-text
 * tokens clear 4.5:1 against the card and page surfaces (computed from index.css); (2) every
 * component the ticket names paints its status text through those tokens — no literal light-theme
 * hsl() and no raw small `text-destructive` — so the measured contrast is the token's contrast.
 */

const ROOT = process.cwd();
const css = readFileSync(join(ROOT, 'index.css'), 'utf8');

function block(selector: RegExp): string {
  const m = selector.exec(css);
  if (!m) throw new Error(`no css block for ${selector}`);
  let depth = 0;
  for (let i = css.indexOf('{', m.index); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(m.index, i);
  }
  throw new Error('unbalanced');
}
const token = (scope: string, name: string): [number, number, number] => {
  const m = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`).exec(scope);
  if (!m) throw new Error(`token ${name} missing`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
function lum([h, s, l]: [number, number, number]): number {
  const S = s / 100;
  const L = l / 100;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(0) + 0.7152 * f(8) + 0.0722 * f(4);
}
const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const light = block(/:root\s*\{/);
const dark = block(/\.dark\s*\{/);

describe('AC-A11Y-DARK-STATUS-001 status-text tokens (#2090)', () => {
  for (const [theme, scope] of [['light', light], ['dark', dark]] as const) {
    for (const name of ['destructive-text', 'success-text']) {
      for (const surface of ['card', 'background']) {
        it(`${name} on ${surface} is ≥ 4.5:1 in ${theme}`, () => {
          expect(ratio(token(scope, name), token(scope, surface))).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
  it('the literal light-theme red (hsl(0 72% 42%)) would fail on the dark card — why the token is needed', () => {
    expect(ratio([0, 72, 42], token(dark, 'card'))).toBeLessThan(4.5);
  });
});

const TOUCHED = [
  'src/components/ui/ErrBanner.tsx',
  'src/components/ui/TimesheetGrid.tsx',
  'src/components/ui/Combobox.tsx',
  'src/auth/UpdatePasswordPage.tsx',
  'src/auth/RequireAuth.tsx',
  'src/auth/authFormPrimitives.tsx',
  'src/components/timesheets/EmployeeLinkConfirm.tsx',
  'src/components/projects/ProjectIntegrationsCard.tsx',
  'pages/sales/DealParts.tsx',
  'pages/project-detail/MilestoneStrip.tsx',
];

describe('AC-A11Y-DARK-STATUS-001 touched components use the theme tokens (#2090)', () => {
  for (const file of TOUCHED) {
    it(`${file}: no literal red/green status colour and no raw text-destructive on text`, () => {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src).not.toMatch(/color:\s*['"]hsl\((0 72%|142 60%)/);
      // Raw `text-destructive` is allowed only on a decorative glyph (<Icon/> or an aria-hidden mark,
      // held to the 3:1 non-text bar); on text it is the sub-AA defect this ticket removes.
      const rawOnText = src
        .split('\n')
        .filter((l) => /(^|[\s'"`])text-destructive(?=[\s'"`}])/.test(l))
        .filter((l) => !/<Icon\b|aria-hidden/.test(l));
      expect(rawOnText).toEqual([]);
    });
  }

  it('ErrBanner title renders in text-destructive-text (follows dark)', () => {
    render(<ErrBanner title="Week returned" />);
    const title = screen.getByText('Week returned');
    expect(title).toHaveClass('text-destructive-text');
    expect(title.getAttribute('style') ?? '').not.toMatch(/color/);
  });

  it('SuccessNotice text renders in text-success-text with no inline colour', () => {
    render(<SuccessNotice>Check your email</SuccessNotice>);
    const text = screen.getByText('Check your email');
    expect(text).toHaveClass('text-success-text');
    expect(text.getAttribute('style') ?? '').not.toMatch(/color/);
  });
});
