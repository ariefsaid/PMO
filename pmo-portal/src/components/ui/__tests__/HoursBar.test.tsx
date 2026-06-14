// T5 — HoursBar component tests
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { HoursBar } from '../HoursBar';

describe('T5 — HoursBar', () => {
  it('renders with correct aria-label on the progressbar (T5 a11y)', () => {
    render(<HoursBar label="Alpha" code="A001" hours={8} maxHours={10} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-label', 'Alpha: 8 hours');
    expect(bar).toHaveAttribute('aria-valuenow', '8');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
  });

  it('shows the hours value with tabular class (T5 tabular-nums rule)', () => {
    const { container } = render(<HoursBar label="Beta" code={null} hours={7.5} maxHours={10} />);
    const hoursEl = container.querySelector('.tabular');
    expect(hoursEl).not.toBeNull();
    expect(hoursEl!.textContent).toContain('7.5');
  });

  it('renders a neutral fill element, NOT bg-primary (T5 Freed-Blue / r2fix-enforce Part 2)', () => {
    // A quantity/hours bar is a data indicator, NOT an interactive affordance.
    // The Freed-Blue Status Rule (DESIGN.md §2): action-blue must not appear on
    // non-interactive data indicators. Fill uses bg-muted-foreground (neutral).
    const { container } = render(<HoursBar label="Project" code="P1" hours={5} maxHours={10} />);
    // Fill must be present (not empty).
    const fill = container.querySelector('[role="progressbar"] span');
    expect(fill).not.toBeNull();
    // Fill must NOT carry the action-blue token.
    expect(fill!.className).not.toMatch(/bg-primary\b/);
    // Fill must be a neutral tone (muted-foreground).
    expect(fill!.className).toMatch(/bg-muted-foreground/);
    // Must NOT bleed status-hue fills either.
    expect(fill!.className).not.toMatch(/bg-success\b/);
    expect(fill!.className).not.toMatch(/bg-destructive\b/);
    expect(fill!.className).not.toMatch(/bg-warning\b/);
  });

  it('renders mono code when provided (T5 Mono-For-Identifiers)', () => {
    render(<HoursBar label="Alpha" code="A001" hours={4} maxHours={8} />);
    expect(screen.getByText('A001')).toBeInTheDocument();
  });

  it('renders label even without a code (T5 edge)', () => {
    render(<HoursBar label="No Code" code={null} hours={3} maxHours={6} />);
    expect(screen.getByText('No Code')).toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  it('renders as part of a role=group with aria-label from parent (T5 a11y)', () => {
    render(
      <div role="group" aria-label="Hours this week by project">
        <HoursBar label="Alpha" code="A001" hours={8} maxHours={8} />
      </div>,
    );
    expect(screen.getByRole('group', { name: 'Hours this week by project' })).toBeInTheDocument();
  });

  // Item F: a money formatter replaces the raw "Nh" so budget figures read as
  // currency ($2,000,000), never "2000000h".
  it('formatValue formats the trailing value and the a11y suffix (no raw "h")', () => {
    const fmt = (v: number) => `$${v.toLocaleString('en-US')}`;
    render(
      <HoursBar label="Materials" code={null} hours={2_000_000} maxHours={5_000_000} formatValue={fmt} />,
    );
    // trailing value is currency-formatted, not "2000000h"
    expect(screen.getByText('$2,000,000')).toBeInTheDocument();
    expect(screen.queryByText('2000000h')).not.toBeInTheDocument();
    // the accessible name carries the formatted value, never " hours"
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-label', 'Materials: $2,000,000');
    expect(bar.getAttribute('aria-label')).not.toContain('hours');
  });
});
