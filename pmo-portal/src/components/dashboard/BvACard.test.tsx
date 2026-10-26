import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { BvACard } from './BvACard';
import type { TopProject } from '@/src/lib/db/dashboard';

const projects: TopProject[] = [
  { id: 'p1', name: 'Innovate HQ', client_name: 'Innovate', currency: 'USD', contract_value: 5_000_000, budget: 4_700_000, spent: 2_100_000, status: 'Ongoing Project', actual_complete: true, actual_currency: 'USD' },
  { id: 'p2', name: 'Acme Platform', client_name: 'Acme', currency: 'USD', contract_value: 3_000_000, budget: 2_000_000, spent: 1_960_000, status: 'Ongoing Project', actual_complete: true, actual_currency: 'USD' },
];

const renderCard = (rows = projects) => render(
  <MemoryRouter><BvACard projects={rows} currency="USD" /></MemoryRouter>,
);

describe('Executive spending comparison', () => {
  it('AC-UX-013 opens project identity beside known Actual and contract', () => {
    renderCard();
    const table = screen.getByRole('table', { name: 'USD spending comparison' });
    expect(within(table).getByRole('link', { name: 'Innovate HQ' })).toHaveAttribute('href', '/projects/p1');
    expect(within(table).getAllByRole('link', { name: 'Innovate HQ' })).toHaveLength(1);
    expect(within(table).getByText('2,100,000')).toBeInTheDocument();
    expect(within(table).getByText('5,000,000')).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Known Actual' })).toBeInTheDocument();
  });

  it('labels a comparable Actual bar with project and percentage', () => {
    renderCard();
    expect(screen.getByRole('progressbar', { name: 'Innovate HQ: 42% of contract' })).toBeInTheDocument();
  });

  it('AC-RF-002 keeps an unknown Actual as a linked dash and draws no comparison bar', () => {
    renderCard([{ ...projects[0]!, spent: null, actual_complete: false }]);
    const table = screen.getByRole('table', { name: 'USD spending comparison' });
    expect(within(table).getByRole('link', { name: 'Actual unavailable; see coverage note' })).toBeInTheDocument();
    expect(within(table).getByText('5,000,000')).toBeInTheDocument();
    expect(within(table).queryByRole('progressbar')).toBeNull();
  });

  it('marks a known at-risk project in its status row', () => {
    renderCard();
    const row = screen.getByRole('link', { name: 'Acme Platform' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('At risk')).toBeInTheDocument();
    const onTrack = screen.getByRole('link', { name: 'Innovate HQ' }).closest('tr') as HTMLElement;
    expect(within(onTrack).queryByText('At risk')).toBeNull();
  });

  it('keeps unknown risk as a labelled dash instead of repeating prose in every row', () => {
    renderCard(projects.map((project) => ({
      ...project, budget: null, spent: null, actual_complete: false,
      actual_coverage_count: 0, actual_coverage_total: 1,
    })));
    const table = screen.getByRole('table', { name: 'USD spending comparison' });
    expect(within(table).getAllByRole('link', { name: 'Risk not checked; see portfolio data note' })).toHaveLength(2);
    expect(within(table).queryByText('Risk not checked')).not.toBeInTheDocument();
  });

  it('names the table for assistive technology', () => {
    renderCard();
    expect(screen.getByRole('table', { name: 'USD spending comparison' })).toBeInTheDocument();
  });

  it('H-03 groups amounts by currency and shows the unit once above exact numeric rows', () => {
    renderCard([
      { ...projects[0]!, name: 'Pembangunan Gedung Layanan Terpadu Tahap IV Baru', currency: 'IDR', actual_currency: 'IDR', contract_value: 2_226_648_000, spent: 1_780_000_000 },
      projects[1]!,
    ]);
    const idrTable = screen.getByRole('table', { name: 'IDR spending comparison' });
    const usdTable = screen.getByRole('table', { name: 'USD spending comparison' });
    expect(within(idrTable).getByText('2,226,648,000')).toBeInTheDocument();
    expect(within(idrTable).getByText('1,780,000,000')).toBeInTheDocument();
    expect(idrTable).not.toHaveTextContent('IDR');
    expect(usdTable).not.toHaveTextContent('USD');
    expect(screen.getByRole('heading', { name: 'IDR' })).toBeInTheDocument();
  });
});
