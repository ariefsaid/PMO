/**
 * AC-JR-W3B-04: BvACard D-2 — no decorative trailing chevron on at-risk rows.
 *
 * The trailing Icon was a false affordance (it visually implies the row is
 * clickable but the sole interactive is the project-name Link). D-2 drops it.
 * The project-name Link remains the affordance; the "At risk" pill is the
 * exception badge. This test is the canonical proof that the false affordance
 * is gone.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
    // 98% utilization → at-risk
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

describe('AC-JR-W3B-04: BvACard D-2 — false-affordance chevron removed', () => {
  it('AC-JR-W3B-04: at-risk row has no decorative trailing chevron (false affordance eliminated)', () => {
    renderCard();
    // The false-affordance chevron must be absent on at-risk rows
    const atRiskRow = screen
      .getByRole('link', { name: /SunVolt Install/i })
      .closest('[data-row]') as HTMLElement;
    expect(within(atRiskRow).queryByTestId('bva-row-open-chevron')).not.toBeInTheDocument();
  });

  it('AC-JR-W3B-04: at-risk row still shows the At-risk badge (exception still flagged)', () => {
    renderCard();
    const atRiskRow = screen
      .getByRole('link', { name: /SunVolt Install/i })
      .closest('[data-row]') as HTMLElement;
    expect(within(atRiskRow).getByText(/At risk/i)).toBeInTheDocument();
  });

  it('AC-JR-W3B-04: project name Link is still present (affordance unchanged)', () => {
    renderCard();
    const link = screen.getByRole('link', { name: /SunVolt Install/i });
    expect(link).toHaveAttribute('href', '/projects/d2');
  });
});
