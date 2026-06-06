import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { formatCurrency } from '@/src/lib/format';
import { BvACard } from './BvACard';
import type { TopProject } from '@/src/lib/db/dashboard';

const projects: TopProject[] = [
  { id: 'p1', name: 'Innovate HQ', client_name: 'Innovate', contract_value: 5_000_000, budget: 4_700_000, spent: 2_100_000, status: 'Ongoing Project' },
  // 98% utilization → at-risk (spent/budget > 0.9)
  { id: 'p2', name: 'Acme Platform', client_name: 'Acme', contract_value: 3_000_000, budget: 2_000_000, spent: 1_960_000, status: 'Ongoing Project' },
];

describe('BvACard (Exec — real top_projects)', () => {
  it('renders one row per project with spent / contract tabular readout', () => {
    render(<BvACard projects={projects} />);
    expect(screen.getByText('Innovate HQ')).toBeInTheDocument();
    expect(
      screen.getByText(`${formatCurrency(2_100_000)} / ${formatCurrency(5_000_000)}`),
    ).toBeInTheDocument();
  });

  it('exposes a per-row accessible "{name}: {pct}% of contract" progress label', () => {
    render(<BvACard projects={projects} />);
    // Innovate spent 2.1M of 5M contract = 42%
    expect(screen.getByLabelText(/Innovate HQ: 42% of contract/i)).toBeInTheDocument();
  });

  it('flags the over-90%-utilized project with an At risk pill', () => {
    render(<BvACard projects={projects} />);
    const row = screen.getByText('Acme Platform').closest('[data-row]') as HTMLElement;
    expect(within(row).getByText(/At risk/i)).toBeInTheDocument();
    // the on-track project has no At-risk pill
    const ok = screen.getByText('Innovate HQ').closest('[data-row]') as HTMLElement;
    expect(within(ok).queryByText(/At risk/i)).toBeNull();
  });

  it('labels the whole section for assistive tech', () => {
    render(<BvACard projects={projects} />);
    expect(screen.getByRole('group', { name: /Budget vs actual by project/i })).toBeInTheDocument();
  });
});
