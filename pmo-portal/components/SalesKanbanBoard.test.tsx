import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import SalesKanbanBoard from './SalesKanbanBoard';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { formatCurrencyAuto } from '@/src/lib/format';

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

const projects: PipelineProject[] = [
      { id: 'q1', name: 'Quotation Deal Alpha', short_name: null, client_name: 'Acme', status: 'Quotation Submitted', contract_value: 500_000, currency: 'USD', tax_treatment: 'exclusive', win_probability: 0.4, pm_name: 'Project Manager A' },
  { id: 't1', name: 'Tender Deal Bravo', short_name: null, client_name: null, status: 'Tender Submitted', contract_value: 1_200_000, currency: 'USD', tax_treatment: 'inclusive', win_probability: 0.5 },
  { id: 'l1', name: 'Lost Deal Delta', short_name: null, client_name: 'Initech', status: 'Loss Tender', contract_value: 700_000, currency: 'USD', tax_treatment: 'exclusive', win_probability: 0 },
  { id: 'idr1', name: 'IDR Deal', short_name: null, client_name: 'Garuda', status: 'Quotation Submitted', contract_value: 1_234, currency: 'IDR', tax_treatment: 'inclusive', win_probability: 0.4 },
  { id: 'usd1', name: 'USD Deal', short_name: null, client_name: 'Acme Corp', status: 'Quotation Submitted', contract_value: 9_000, currency: 'USD', tax_treatment: 'exclusive', win_probability: 0.4 },
  { id: 'nb1', name: 'Unpriced Deal', short_name: null, client_name: 'Umbrella', status: 'Quotation Submitted', contract_value: 0, currency: 'USD', tax_treatment: null, win_probability: 0.4 },
];

const renderBoard = (items = projects, onOpen = vi.fn()) => ({
  onOpen,
  ...render(<MemoryRouter><SalesKanbanBoard projects={items} onOpen={onOpen} /></MemoryRouter>),
});

describe('SalesKanbanBoard composed collection (AC-SP-204 / AC-IXD-PROJ-007)', () => {
  it('AC-IXD-PROJ-007: groups open stages and adds one terminal Lost group when present', () => {
    renderBoard();
    const titles = ['Leads', 'Pre-Qual', 'Quotation', 'Tender', 'Negotiation'];
    titles.forEach((title) => expect(screen.getByText(title, { exact: true })).toBeInTheDocument());
    expect(screen.getByTestId('stage-Lost')).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-007: terminal outcomes distinguish Lost from Declined and forecast fields are not applicable', () => {
    const declined: PipelineProject = { id: 'dc1', name: 'Declined Deal Echo', short_name: null, client_name: 'Echo', status: 'Declined', contract_value: 300_000, currency: 'USD', tax_treatment: 'exclusive', win_probability: 0 };
    renderBoard([...projects.filter((project) => project.status === 'Loss Tender'), declined]);
    const terminal = screen.getByTestId('stage-Lost');
    expect(within(terminal).getByRole('link', { name: 'Lost Deal Delta' })).toBeInTheDocument();
    expect(within(terminal).getByRole('link', { name: 'Declined Deal Echo' })).toBeInTheDocument();
    expect(within(terminal).getAllByText('Not applicable')).toHaveLength(2);
  });

  it('AC-SP-204: cards expose identity, customer, owner, activity, exact row money/basis, and win probability', () => {
    const identity: PipelineProject = {
      ...projects[0], short_name: 'North Terminal', name: 'Contractual infrastructure agreement',
      pmo_project_number: 'PMO-26-0042', code: 'CLIENT-77', end_client_name: 'Asset Owner',
    };
    renderBoard([identity]);
    const card = screen.getByRole('link', { name: 'North Terminal' }).closest('article')!;
    expect(within(card).getByText('Contractual infrastructure agreement')).toBeInTheDocument();
    expect(within(card).getByText('PMO-26-0042 · CLIENT-77')).toBeInTheDocument();
    expect(within(card).getByText('Acme')).toBeInTheDocument();
    expect(within(card).getByText(/Asset Owner/)).toBeInTheDocument();
    expect(within(card).getByText('Project Manager A')).toBeInTheDocument();
    expect(within(card).getByText('40%')).toBeInTheDocument();
    expect(within(card).getByText(/excl\. PPN/i)).toBeInTheDocument();
    expect(within(card).queryByText(/weighted/i)).toBeNull();
  });

  it('AC-SP-204 / AC-LRC-004: opening the project link calls the page return-context action', () => {
    const onOpen = vi.fn();
    renderBoard([projects[0]], onOpen);
    const link = screen.getByRole('link', { name: 'Quotation Deal Alpha' });
    expect(link).toHaveAttribute('href', '/projects/q1');
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledWith(projects[0]);
  });

  it('#530 / AC-L10N-020: each card keeps its own ISO currency and amount', () => {
    renderBoard(projects.filter((project) => ['idr1', 'usd1'].includes(project.id)));
    const idr = screen.getByRole('link', { name: 'IDR Deal' }).closest('article')!;
    const usd = screen.getByRole('link', { name: 'USD Deal' }).closest('article')!;
    const normalized = (value: string) => value.replace(/\u00a0/g, ' ');
    expect(within(idr).getByText((text) => normalized(text) === normalized(formatCurrencyAuto(1_234, 'IDR')))).toBeInTheDocument();
    expect(within(usd).getByText((text) => normalized(text) === normalized(formatCurrencyAuto(9_000, 'USD')))).toBeInTheDocument();
    expect(within(idr).queryByText(/\$/)).toBeNull();
  });

  it('RD-046: preserves fractional contract value precision on a deal card', () => {
    const fractional = { ...projects[1], contract_value: 1_200_000.25 };
    renderBoard([fractional]);
    const card = screen.getByRole('link', { name: 'Tender Deal Bravo' }).closest('article')!;
    expect(within(card).getByText(formatCurrencyAuto(1_200_000.25, 'USD'))).toBeInTheDocument();
  });

  it('AC-S24-002: the phone projection is a vertical list with stage once and a real project link', () => {
    render(<MemoryRouter><SalesKanbanBoard projects={[projects[1]]} onOpen={vi.fn()} presentation="list" /></MemoryRouter>);
    const list = screen.getByTestId('sales-phone-stage-list');
    const card = within(list).getByRole('link', { name: 'Tender Deal Bravo' }).closest('article')!;
    expect(within(card).getByText('Tender Submitted')).toBeInTheDocument();
    expect(within(card).getByText('Customer unavailable')).toBeInTheDocument();
    expect(within(card).getByText(formatCurrencyAuto(1_200_000, 'USD'))).toBeInTheDocument();
    expect(list.querySelectorAll('li')).toHaveLength(1);
  });

  it('AC-S24-002: the compact phone row keeps a long contractual identity, customer and exact 13-digit IDR value', () => {
    const longDeal: PipelineProject = {
      id: 'long-idr',
      name: 'Pengadaan dan pemeliharaan terpadu untuk fasilitas regional Jawa Barat dengan layanan berkelanjutan',
      short_name: null,
      client_name: 'Example Regional Services Cooperative with a long procurement identity',
      status: 'Leads',
      contract_value: 2_226_648_000_000,
      currency: 'IDR',
      tax_treatment: 'inclusive',
      tax_rate: 11,
      tax_base_numerator: 100,
      tax_base_denominator: 111,
      win_probability: 0.1,
      pm_name: 'Example Project Manager',
    };
    render(<MemoryRouter><SalesKanbanBoard projects={[longDeal]} onOpen={vi.fn()} presentation="list" /></MemoryRouter>);

    const card = screen.getByRole('link', { name: longDeal.name }).closest('article')!;
    expect(within(card).getByText(longDeal.client_name!)).toBeInTheDocument();
    const normalizeSpacing = (text: string) => text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    expect(within(card).getByText((text) => normalizeSpacing(text) === normalizeSpacing(formatCurrencyAuto(longDeal.contract_value, 'IDR')))).toBeInTheDocument();
    expect(within(card).getByText('10%')).toBeInTheDocument();
    expect(within(card).getByTestId('tax-basis')).toHaveTextContent(/incl\. PPN/i);
  });

  it('OD-TAX-1 §2: unknown basis renders no inferred label', () => {
    renderBoard([projects.find((project) => project.id === 'nb1')!]);
    const card = screen.getByRole('link', { name: 'Unpriced Deal' }).closest('article')!;
    expect(within(card).queryByTestId('tax-basis')).toBeNull();
  });
});
