import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { ViewToggle } from '../ViewToggle';
import { KPITile } from '../KPITile';

/**
 * WCAG 2.5.5 Target Size (AA) — item D. Compact controls (28px segmented-control
 * buttons, the 15px KPI help "?", and the 32px shell header icon buttons) must
 * expose a >=44px HIT AREA on a coarse pointer while keeping their visual size.
 * The mechanism is the shared `.touch-target` hook + a coarse-pointer ::before
 * overlay in index.css.
 *
 * jsdom evaluates neither `@media (pointer: coarse)` nor ::before geometry, so
 * the behavior is verified in two halves: (1) the CSS rule itself defines a
 * >=44px overlay under the coarse-pointer query, and (2) the compact controls
 * actually carry the hook class that activates it.
 */

// Tests run with cwd = pmo-portal/, where index.css lives at the project root.
const indexCss = readFileSync(resolve(process.cwd(), 'index.css'), 'utf8');

describe('touch-target hit-area expansion (WCAG 2.5.5)', () => {
  it('index.css defines a >=44px ::before overlay under (pointer: coarse)', () => {
    // The coarse-pointer media block exists and grows .touch-target::before.
    expect(indexCss).toMatch(/@media \(pointer: coarse\)/);
    // The overlay enforces the 44px minimum target size.
    const coarseBlock = indexCss.slice(indexCss.indexOf('.touch-target { touch-action'));
    expect(coarseBlock).toMatch(/\.touch-target::before/);
    expect(coarseBlock).toMatch(/min-width:\s*44px/);
    expect(coarseBlock).toMatch(/min-height:\s*44px/);
  });

  it('segmented-control (ViewToggle) buttons carry the touch-target hook', () => {
    render(
      <ViewToggle
        options={[
          { value: 'count', label: 'By count' },
          { value: 'value', label: 'By value' },
        ]}
        value="count"
        onChange={vi.fn()}
        ariaLabel="Margin lens"
      />,
    );
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('touch-target');
    }
  });

  it('the KPI help "?" affordance carries the touch-target hook', () => {
    render(
      <KPITile icon="up" tone="blue" label="On-hand margin" value="42%" help="Realized actual margin." />,
    );
    const help = screen.getByRole('button', { name: /Help: On-hand margin/i });
    expect(help.className).toContain('touch-target');
  });
});
