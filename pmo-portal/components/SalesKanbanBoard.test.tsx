import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import SalesKanbanBoard from './SalesKanbanBoard';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { formatCurrency } from '@/src/lib/format';

// FR-L10N-020: the board reads useOrgCurrency for its per-COLUMN totals only — a column total sums
// across deals and has no single record currency. The deal CARDS take each project's own currency
// (0201) and, since #578, its own tax basis (0208). Pinned rather than left to a real
// query. ⚑ At LINE-START on purpose — inserted inside a neighbouring vi.mock call it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

const projects: PipelineProject[] = [
  { id: 'q1', name: 'Quotation Deal Alpha', client_name: 'Acme', status: 'Quotation Submitted', contract_value: 500_000, currency: 'USD', tax_treatment: 'exclusive', win_probability: 0.4 },
  { id: 't1', name: 'Tender Deal Bravo', client_name: null, status: 'Tender Submitted', contract_value: 1_200_000, currency: 'USD', tax_treatment: 'inclusive', win_probability: 0.5 },
  { id: 'w1', name: 'Won Deal Charlie', client_name: 'Globex', status: 'Won, Pending KoM', contract_value: 2_000_000, currency: 'USD', tax_treatment: 'exclusive', win_probability: 1 },
  { id: 'l1', name: 'Lost Deal Delta', client_name: 'Initech', status: 'Loss Tender', contract_value: 700_000, currency: 'USD', tax_treatment: 'exclusive', win_probability: 0 },
  // #530 / FR-L10N-020: a mixed-currency pair proves a card renders ITS OWN currency, not the
  // USD org default — a single-currency fixture set cannot tell a record currency from a
  // hardcoded literal (which is exactly how this issue shipped in 0044).
  { id: 'idr1', name: 'IDR Deal', client_name: 'Garuda', status: 'Quotation Submitted', contract_value: 1_234, currency: 'IDR', tax_treatment: 'inclusive', win_probability: 0.4 },
  { id: 'usd1', name: 'USD Deal', client_name: 'Acme Corp', status: 'Quotation Submitted', contract_value: 9_000, currency: 'USD', tax_treatment: 'exclusive', win_probability: 0.4 },
  // 0197 permits a NULL basis ONLY at zero value, and OD-TAX-1 says render NOTHING for it rather
  // than invent one. Without this row the "unknown renders nothing" branch has no witness here.
  { id: 'nb1', name: 'Unpriced Deal', client_name: 'Umbrella', status: 'Quotation Submitted', contract_value: 0, currency: 'USD', tax_treatment: null, win_probability: 0.4 },
];

describe('SalesKanbanBoard (AC-SP-204 / AC-IXD-PROJ-007)', () => {
  // Model B (ADR-0020): the terminal column is split into separate "Won" and "Lost" columns.
  it('AC-IXD-PROJ-007: renders the five open stages + separate terminal Won and Lost columns in fixed order', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const titles = ['Leads', 'Pre-Qual', 'Quotation', 'Tender', 'Negotiation', 'Won', 'Lost'];
    for (const t of titles) {
      const col = screen.getByTestId(
        t === 'Won' ? 'stage-Won' : t === 'Lost' ? 'stage-Lost' : `stage-${t === 'Pre-Qual' ? 'PQ Submitted' : t === 'Quotation' ? 'Quotation Submitted' : t === 'Tender' ? 'Tender Submitted' : t}`,
      );
      expect(within(col).getByText(t, { exact: true })).toBeInTheDocument();
    }
  });

  it('CW-3b: each deal renders the shared canonical ProjectCardShell (one project-card vocabulary)', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    // The shared shell stamps every card with the canonical `project-card` testid — the SAME
    // molecule the Projects cards-view and Projects kanban use, so a project looks identical
    // wherever it appears.
    const cards = screen.getAllByTestId('project-card');
    expect(cards).toHaveLength(projects.length);
  });

  it('AC-IXD-PROJ-007: a lost deal lands in the terminal "Lost" column, not the "Won" column', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const lostCol = screen.getByTestId('stage-Lost');
    expect(within(lostCol).getByText('Lost Deal Delta')).toBeInTheDocument();
    expect(within(screen.getByTestId('stage-Won')).queryByText('Lost Deal Delta')).toBeNull();
  });

  it('AC-SP-204: a Quotation deal renders name, customer, value, weighted chip and win%', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const card = screen.getByText('Quotation Deal Alpha').closest('[role="button"]')!;
    const c = within(card as HTMLElement);
    expect(c.getByText('Acme')).toBeInTheDocument();
    expect(c.getByText(formatCurrency(500_000, 'USD'))).toBeInTheDocument();
    // weighted = 500000 * 0.4 = 200000 (rendered "$200,000 wtd")
    expect(c.getByText((t) => t.includes(formatCurrency(200_000, 'USD')))).toBeInTheDocument();
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
    expect(screen.getByText('No projects in Leads')).toBeInTheDocument();
  });

  it('AC-SP-204: a won deal shows a won status pill and lands in the terminal Won column', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const wonCol = screen.getByTestId('stage-Won');
    const card = within(wonCol).getByText('Won Deal Charlie').closest('[role="button"]')!;
    expect(within(card as HTMLElement).getByText('Won, Pending KoM')).toBeInTheDocument();
  });

  it('C2: every rendered stage-column dot is a DESIGN.md token (no raw cyan/orange literal)', () => {
    const { container } = render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const dots = Array.from(
      container.querySelectorAll<HTMLElement>('span.size-\\[9px\\].rounded-full'),
    );
    // one column-head dot per stage (6 columns)
    expect(dots.length).toBeGreaterThanOrEqual(6);
    const backgrounds = dots.map((d) => d.style.background);
    for (const bg of backgrounds) {
      expect(bg).toMatch(/^hsl\(var\(--/);
    }
    expect(backgrounds.some((b) => b.includes('hsl(199'))).toBe(false); // no cyan
    expect(backgrounds.some((b) => b.includes('hsl(25 95'))).toBe(false); // no orange
  });

  it('AC-1117: the Tender column totals expose a weighted currency value (test id preserved)', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const tender = screen.getByTestId('stage-Tender Submitted');
    // weighted for Tender = 1,200,000 * 0.5 = 600,000 — surfaced both in the
    // column totals AND the single card's weighted chip.
    expect(
      within(tender).getAllByText((t) => t.includes(formatCurrency(600_000, 'USD'))).length,
    ).toBeGreaterThan(0);
  });

  it('#530 / AC-L10N-020: cards render each deal in its own currency, not the USD org default', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    // IDR card: shows the code-style NBSP currency (U+00A0, Intl en-US separates a code-style
    // currency with a non-breaking space), and NO dollar sign. We assert on the RAW node text
    // content for the NBSP — getByText's default normalizer collapses NBSP to a space before
    // comparing, so a plain-space assertion could be satisfied by a hardcoded "IDR 1,234".
    const idrCard = screen.getByText('IDR Deal').closest('[role="button"]')!;
    const idr = within(idrCard as HTMLElement);
    // SOME element inside the card carries the raw NBSP currency (the value span and its
    // ancestors both contain it in textContent, so this is a presence check, not unique-node).
    expect(
      idr.getAllByText((_, node) => node?.textContent?.includes('IDR\u00A01,234') ?? false)
        .length,
    ).toBeGreaterThan(0);
    expect(idr.queryByText(/\$/)).toBeNull();
    // USD card (same column, same board): renders its own dollar value and NO IDR.
    const usdCard = screen.getByText('USD Deal').closest('[role="button"]')!;
    const usd = within(usdCard as HTMLElement);
    expect(usd.getByText('$9,000')).toBeInTheDocument();
    expect(usd.queryByText(/IDR/)).toBeNull();
  });
});

// ⚑ OD-TAX-1 §2 on the pipeline board (#578). The two assertions below are deliberately keyed to
// DIFFERENT deals with DIFFERENT bases: a fixture where every card shares one treatment cannot
// tell a rendered value from a hardcoded literal, which is exactly how the currency gap shipped in
// 0044 and how #566's drawdown label passed 26 tests while hardcoded.
describe('OD-TAX-1 §2: a pipeline deal card states its own tax basis (#578)', () => {
  const cardFor = (name: string) => {
    const heading = screen.getByText(name);
    const card = heading.closest('[data-testid^="project-card"]') ?? heading.closest('article') ?? heading.parentElement!;
    return card as HTMLElement;
  };

  it('AC-TAX-309: labels an inclusive deal and an exclusive deal from each row, not from one shared default', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    expect(within(cardFor('Tender Deal Bravo')).getByTestId('tax-basis')).toHaveAttribute('data-tax-basis', 'inclusive');
    expect(within(cardFor('Quotation Deal Alpha')).getByTestId('tax-basis')).toHaveAttribute('data-tax-basis', 'exclusive');
  });

  it('AC-TAX-310: renders NOTHING for a deal whose basis is unknown — a guess would be a claim the row does not make', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    expect(within(cardFor('Unpriced Deal')).queryByTestId('tax-basis')).toBeNull();
  });
});
