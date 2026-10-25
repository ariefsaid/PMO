/** EN/ID Sales row labels, grouped headings, and missing evidence stay in the active locale. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { BahasaProvider } from '@/test/bahasa';
import SalesKanbanBoard from './SalesKanbanBoard';
import type { PipelineProject } from '@/src/lib/db/dashboard';

const project: PipelineProject = {
  id: 'q1', name: 'Quotation Deal Alpha', short_name: null, client_name: 'Acme',
  status: 'Quotation Submitted', contract_value: 500_000, currency: 'USD',
  tax_treatment: 'exclusive', win_probability: 0.4, last_update: null,
};
const renderBoard = (presentation: 'board' | 'list' = 'board') => render(
  <BahasaProvider><MemoryRouter><SalesKanbanBoard projects={[project]} onOpen={vi.fn()} presentation={presentation} /></MemoryRouter></BahasaProvider>,
);

describe('SalesKanbanBoard Bahasa labels', () => {
  it('gives the grouped board a Bahasa accessible name and translated stage headers', () => {
    renderBoard();
    expect(screen.getByRole('region', { name: 'Papan pipeline penjualan' })).toBeInTheDocument();
    expect(within(screen.getByTestId('stage-Leads')).getByText('Prospek')).toBeInTheDocument();
    expect(within(screen.getByTestId('stage-PQ Submitted')).getByText('Pra-kualifikasi')).toBeInTheDocument();
    expect(within(screen.getByTestId('stage-Quotation Submitted')).getByText('Penawaran')).toBeInTheDocument();
    expect(within(screen.getByTestId('stage-Tender Submitted')).getByText('Tender')).toBeInTheDocument();
    expect(within(screen.getByTestId('stage-Negotiation')).getByText('Negosiasi')).toBeInTheDocument();
  });

  it('uses the localized lifecycle label and does not repeat stage inside the grouped card', () => {
    renderBoard();
    const card = screen.getByRole('link', { name: 'Quotation Deal Alpha' }).closest('article')!;
    expect(within(card).queryByText('Penawaran diajukan')).toBeNull();
    expect(within(card).getByText('Aktivitas tidak tersedia')).toBeInTheDocument();
    expect(within(card).queryByText('Quotation Submitted')).toBeNull();
    expect(within(card).queryByText(/tertimbang$/)).toBeNull();
  });

  it('keeps stage visible on the ungrouped phone row', () => {
    renderBoard('list');
    const card = screen.getByRole('link', { name: 'Quotation Deal Alpha' }).closest('article')!;
    expect(within(card).getByText('Penawaran diajukan')).toBeInTheDocument();
  });
});
