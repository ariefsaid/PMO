/**
 * #693 (F-2) — the Sales board's screen-reader name, weighted-value suffix and empty-column
 * message were hard-coded English. Rendered under the real `id` catalogue they must read as Bahasa.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { BahasaProvider } from '@/test/bahasa';
import SalesKanbanBoard from './SalesKanbanBoard';
import type { PipelineProject } from '@/src/lib/db/dashboard';

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

const projects: PipelineProject[] = [
  { id: 'q1', name: 'Quotation Deal Alpha', client_name: 'Acme', status: 'Quotation Submitted', contract_value: 500_000, currency: 'USD', tax_treatment: 'exclusive', win_probability: 0.4 },
];

describe('SalesKanbanBoard in Bahasa (#693 F-2)', () => {
  it('#693: the board has a Bahasa screen-reader name', () => {
    render(<BahasaProvider><SalesKanbanBoard projects={projects} onOpen={vi.fn()} /></BahasaProvider>);
    expect(screen.getByLabelText('Papan pipeline penjualan')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sales pipeline board')).toBeNull();
  });

  // ⚑ The empty-message assertion above once read "…tahap Leads" — it locked in the English stage
  // enum leaking through a Bahasa sentence (the bug). Stage NAMES are display labels; the enum
  // values ('Leads', 'Quotation Submitted', …) stay as data and never reach the user's eyes.
  it('#693: column titles, the mobile stage indicator and the status pill show Bahasa stage names', () => {
    render(<BahasaProvider><SalesKanbanBoard projects={projects} onOpen={vi.fn()} /></BahasaProvider>);
    const titleIn = (testId: string, name: string) => within(screen.getByTestId(testId)).getByText(name, { exact: true });
    expect(titleIn('stage-Leads', 'Prospek')).toBeInTheDocument();
    expect(titleIn('stage-PQ Submitted', 'Pra-kualifikasi')).toBeInTheDocument();
    expect(titleIn('stage-Quotation Submitted', 'Penawaran')).toBeInTheDocument();
    expect(titleIn('stage-Tender Submitted', 'Tender')).toBeInTheDocument();
    expect(titleIn('stage-Negotiation', 'Negosiasi')).toBeInTheDocument();
    expect(titleIn('stage-Won', 'Menang')).toBeInTheDocument();
    expect(titleIn('stage-Lost', 'Kalah')).toBeInTheDocument();
    // mobile indicator (rendered md:hidden, always in the DOM)
    expect(screen.getByRole('button', { name: 'Prospek' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pra-kualifikasi' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leads' })).toBeNull();
    // the card's pill names the STATUS in full, in Bahasa
    const card = screen.getByTestId('project-card');
    expect(within(card).getByText('Penawaran diajukan')).toBeInTheDocument();
    expect(within(card).queryByText('Quotation Submitted')).toBeNull();
  });

  it('#693: the weighted-value suffix and the empty-column message are Bahasa', () => {
    render(<BahasaProvider><SalesKanbanBoard projects={projects} onOpen={vi.fn()} /></BahasaProvider>);
    const card = screen.getByTestId('project-card');
    expect(within(card).getByText(/tertimbang$/)).toBeInTheDocument();
    expect(within(card).queryByText(/wtd/)).toBeNull();
    expect(screen.getByText('Tidak ada proyek pada tahap Prospek')).toBeInTheDocument();
  });
});
