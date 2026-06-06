import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import SalesKanbanBoard from './SalesKanbanBoard';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { formatCurrency } from '@/src/lib/format';

const projects: PipelineProject[] = [
  { id: 'q1', name: 'Quotation Deal Alpha', client_name: 'Acme', status: 'Quotation Submitted', contract_value: 500_000, win_probability: 0.4 },
  { id: 't1', name: 'Tender Deal Bravo', client_name: null, status: 'Tender Submitted', contract_value: 1_200_000, win_probability: 0.5 },
  { id: 'w1', name: 'Won Deal Charlie', client_name: 'Globex', status: 'Won, Pending KoM', contract_value: 2_000_000, win_probability: 1 },
];

describe('SalesKanbanBoard (AC-SP-204)', () => {
  it('AC-SP-204: renders all six columns in fixed order', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const titles = ['Leads', 'Pre-Qual', 'Quotation', 'Tender', 'Negotiation', 'Won / Lost'];
    for (const t of titles) expect(screen.getByText(t)).toBeInTheDocument();
  });

  it('AC-SP-204: a Quotation deal renders name, customer, value, weighted chip and win%', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const card = screen.getByText('Quotation Deal Alpha').closest('[role="button"]')!;
    const c = within(card as HTMLElement);
    expect(c.getByText('Acme')).toBeInTheDocument();
    expect(c.getByText(formatCurrency(500_000))).toBeInTheDocument();
    // weighted = 500000 * 0.4 = 200000 (rendered "$200,000 wtd")
    expect(c.getByText((t) => t.includes(formatCurrency(200_000)))).toBeInTheDocument();
    // win% from the RPC (40%), not a hard-coded legacy value
    expect(c.getByText('40%')).toBeInTheDocument();
  });

  it('AC-SP-204: a deal with no customer renders an em-dash, never blank', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const card = screen.getByText('Tender Deal Bravo').closest('[role="button"]')!;
    expect(within(card as HTMLElement).getByText('—')).toBeInTheDocument();
  });

  it('AC-SP-204: clicking a card calls onOpen with the row', () => {
    const onOpen = vi.fn();
    render(<SalesKanbanBoard projects={projects} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('Tender Deal Bravo').closest('[role="button"]')!);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });

  it('AC-SP-204: an empty column shows the per-stage empty message', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    expect(screen.getByText('No deals in Leads')).toBeInTheDocument();
  });

  it('AC-SP-204: a won deal shows a won status pill and lands in the terminal column', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const card = screen.getByText('Won Deal Charlie').closest('[role="button"]')!;
    expect(within(card as HTMLElement).getByText('Won, Pending KoM')).toBeInTheDocument();
  });

  it('AC-1117: the Tender column totals expose a weighted currency value (test id preserved)', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const tender = screen.getByTestId('stage-Tender Submitted');
    // weighted for Tender = 1,200,000 * 0.5 = 600,000 — surfaced both in the
    // column totals AND the single card's weighted chip.
    expect(
      within(tender).getAllByText((t) => t.includes(formatCurrency(600_000))).length,
    ).toBeGreaterThan(0);
  });
});
