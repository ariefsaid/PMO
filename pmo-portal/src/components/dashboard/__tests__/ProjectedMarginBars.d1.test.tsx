/**
 * AC-JR-W3B-05: ProjectedMarginBars D-1 — each stage row links to /sales?status=<stage>.
 *
 * The dead-display finding D-1 flagged that stage bars in the margin card were
 * inert text — no navigation affordance. Each row must now be a Link to
 * /sales?status=<encoded-status> so the exec can drill into that stage's deals.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ProjectedMarginBars } from '../ProjectedMarginBars';
import { formatCurrency } from '@/src/lib/format';
import type { PipelineStage } from '@/src/lib/db/dashboard';

const stages: PipelineStage[] = [
  { status: 'Tender Submitted', count: 2, total_value: 2_000_000, win_probability: 0.3, weighted_value: 600_000 },
  { status: 'Negotiation', count: 1, total_value: 1_000_000, win_probability: 0.5, weighted_value: 500_000 },
  // terminal — must be excluded from bars
  { status: 'Won, Pending KoM', count: 1, total_value: 800_000, win_probability: 1, weighted_value: 800_000 },
];

describe('AC-JR-W3B-05: ProjectedMarginBars D-1 — stage rows link to /sales?status=', () => {
  it('AC-JR-W3B-05: each open stage row is a Link to /sales?status=<encoded>', () => {
    render(
      <MemoryRouter>
        <ProjectedMarginBars projectedMargin={0.141} stages={stages} />
      </MemoryRouter>,
    );
    const link1 = screen.getByRole('link', { name: /Tender Submitted/i });
    expect(link1).toBeInTheDocument();
    expect(link1).toHaveAttribute('href', `/sales?status=${encodeURIComponent('Tender Submitted')}`);

    const link2 = screen.getByRole('link', { name: /Negotiation/i });
    expect(link2).toBeInTheDocument();
    expect(link2).toHaveAttribute('href', `/sales?status=${encodeURIComponent('Negotiation')}`);
  });

  it('AC-JR-W3B-05: terminal stages are not rendered as links (excluded from bars)', () => {
    render(
      <MemoryRouter>
        <ProjectedMarginBars projectedMargin={0.141} stages={stages} />
      </MemoryRouter>,
    );
    // Terminal stage should not appear at all
    expect(screen.queryByText('Won, Pending KoM')).toBeNull();
  });

  it('AC-JR-W3B-05: stage bar content is still accessible inside the link', () => {
    render(
      <MemoryRouter>
        <ProjectedMarginBars projectedMargin={0.141} stages={stages} />
      </MemoryRouter>,
    );
    // The weighted value should still be visible inside the link
    expect(screen.getByText(formatCurrency(600_000))).toBeInTheDocument();
  });
});
