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

  it('#693: the weighted-value suffix and the empty-column message are Bahasa', () => {
    render(<BahasaProvider><SalesKanbanBoard projects={projects} onOpen={vi.fn()} /></BahasaProvider>);
    const card = screen.getByTestId('project-card');
    expect(within(card).getByText(/tertimbang$/)).toBeInTheDocument();
    expect(within(card).queryByText(/wtd/)).toBeNull();
    expect(screen.getByText('Tidak ada proyek pada tahap Leads')).toBeInTheDocument();
  });
});
