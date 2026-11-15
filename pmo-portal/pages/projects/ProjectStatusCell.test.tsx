import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from '@/src/components/ui';
import { ProjectStatusCell } from './ProjectStatusCell';

/** #design-1115 project health: late is the same amber mark in the list as on the record. */
describe('ProjectStatusCell late mark', () => {
  const amber = render(<StatusPill variant="warn">x</StatusPill>).getByText('x').className;

  it('shows late as the record\'s amber pill under a calm status', () => {
    render(<ProjectStatusCell state="Ongoing Project" exception={null} lateDays={138} />);
    expect(screen.getByText('138 days past end date').className).toBe(amber);
  });

  it('keeps exception colour once per row: over budget (red) wins, late reads as plain text', () => {
    render(<ProjectStatusCell state="Ongoing Project" exception="overBudget" lateDays={107} />);
    expect(screen.getByText('107 days past end date').className).not.toContain('warning');
    expect(screen.getByText(/over budget/)).toBeInTheDocument();
  });

  it('shows no late mark when nothing is late', () => {
    render(<ProjectStatusCell state="Ongoing Project" exception={null} lateDays={null} />);
    expect(screen.queryByText(/past end date/)).not.toBeInTheDocument();
  });
});
