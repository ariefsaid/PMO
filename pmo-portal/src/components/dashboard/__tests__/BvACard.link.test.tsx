import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { BvACard } from '../BvACard';
import type { TopProject } from '@/src/lib/db/dashboard';

const projects: TopProject[] = [
  {
    id: 'd1',
    name: 'Meridian Steelworks',
    client_name: 'Meridian',
    contract_value: 5_000_000,
    budget: 4_700_000,
    spent: 2_100_000,
    status: 'Ongoing Project',
  },
  {
    id: 'd2',
    name: 'SunVolt Install',
    client_name: 'SunVolt',
    contract_value: 3_000_000,
    budget: 2_000_000,
    spent: 1_960_000,
    status: 'Ongoing Project',
  },
];

const renderCard = () =>
  render(
    <MemoryRouter>
      <BvACard projects={projects} />
    </MemoryRouter>,
  );

describe('BvACard — AC-IFW-DASH-01: BvA row name links to /projects/:id', () => {
  it('AC-IFW-DASH-01: each project name is a link to /projects/:id (Lens-D regression invariant)', () => {
    renderCard();
    // First project name must be a link pointing to /projects/d1
    const link1 = screen.getByRole('link', { name: /Meridian Steelworks/i });
    expect(link1).toBeInTheDocument();
    expect(link1).toHaveAttribute('href', '/projects/d1');

    // Second project name must be a link pointing to /projects/d2
    const link2 = screen.getByRole('link', { name: /SunVolt Install/i });
    expect(link2).toBeInTheDocument();
    expect(link2).toHaveAttribute('href', '/projects/d2');
  });

  it('AC-IFW-DASH-01: the row data-row structure is preserved alongside the name link', () => {
    renderCard();
    // Existing layout tests rely on [data-row] selector; it must still exist
    const row = screen.getByRole('link', { name: /Meridian Steelworks/i }).closest('[data-row]');
    expect(row).toBeInTheDocument();
  });

  it('AC-IFW-DASH-01: the progress bar aria-label is preserved (no nested interactives collision)', () => {
    renderCard();
    // The ProgressBar keeps its own aria-label — not obscured by the link
    expect(screen.getByLabelText(/Meridian Steelworks: \d+% of contract/i)).toBeInTheDocument();
  });
});
