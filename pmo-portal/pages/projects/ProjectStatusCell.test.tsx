import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectStatusCell } from './ProjectStatusCell';

/** #design-1115 project health: one status per row; lateness is a line under it in the same words as the record. */
describe('ProjectStatusCell lateness', () => {
  it.each([
    ['a calm status', null],
    ['an at-risk status', 'atRisk'],
    ['an over-budget status', 'overBudget'],
  ] as const)('under %s, says how far past the end date without adding a second status', (_label, exception) => {
    const { container } = render(<ProjectStatusCell state="Ongoing Project" exception={exception} lateDays={107} />);
    expect(screen.getByText('107 days past end date')).toBeInTheDocument();
    // The status pill is the row's only status mark; lateness is text beside it, not another pill.
    expect(container.querySelectorAll('.rounded-full').length).toBe(1);
  });

  it('counts a single day in the singular', () => {
    render(<ProjectStatusCell state="Ongoing Project" exception={null} lateDays={1} />);
    expect(screen.getByText('1 day past end date')).toBeInTheDocument();
  });

  it('shows no lateness when nothing is late', () => {
    render(<ProjectStatusCell state="Ongoing Project" exception={null} lateDays={null} />);
    expect(screen.queryByText(/past end date/)).not.toBeInTheDocument();
  });
});
