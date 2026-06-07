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

  it('renders a bg-primary fill element — not a status hue (T5 One-Blue)', () => {
    const { container } = render(<HoursBar label="Project" code="P1" hours={5} maxHours={10} />);
    const fill = container.querySelector('.bg-primary');
    expect(fill).not.toBeNull();
    // Must NOT have status-hue classes
    expect(container.innerHTML).not.toContain('bg-success');
    expect(container.innerHTML).not.toContain('bg-destructive');
    expect(container.innerHTML).not.toContain('bg-warning');
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
});
