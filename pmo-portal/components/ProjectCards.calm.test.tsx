/**
 * AC-RD-SUB-PL-B — Projects cards and board say each fact once (v0.24 UI subtraction).
 * Removed on the default card: the duplicate "No active budget", the status-change control,
 * per-card freshness/coverage prose, the "x of y" caption, the rate/DPP + "Show tax details"
 * toggle, and the board card's "PMO Project Number:" label text.
 */
import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import ProjectCard from './ProjectCard';
import ProjectKanbanBoard from './ProjectKanbanBoard';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProjectMoneyRead } from '@/src/lib/db/projectMoney';

const render = (ui: ReactElement) =>
  rtlRender(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }),
}));
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })),
});

const project = {
  id: 'p1', name: 'Synthetic project', code: 'CLI-81', pmo_project_number: 'PMO-26-7711', status: 'Ongoing Project',
  client_id: 'c2', project_manager_id: 'u1', contract_value: 5_000_000, currency: 'USD', tax_treatment: 'exclusive',
  tax_rate: 11, tax_base_numerator: 11, tax_base_denominator: 12, customer_contract_ref: null,
  client: { name: 'Acme' }, pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

const money = (over: Partial<ProjectMoneyRead> = {}): ProjectMoneyRead => ({
  ledgerBasis: 'erp',
  actuals: { currency: 'USD', total: '125000.00', asOf: '2026-10-01T00:00:00Z', excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '125000.00' }] },
  activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true,
  ...over,
}) as ProjectMoneyRead;

describe('AC-RD-SUB-PL-B: ProjectCard says each fact once', () => {
  it('a card with no Active budget says "No active budget" once, and has no Budget used row', () => {
    render(<ProjectCard project={project} onOpen={vi.fn()} deliverySummary={{ deliveryPct: 40, committedSpend: 0, budget: 0 }}
      projectMoney={money({ activeBudgetAmount: null, activeBudgetCurrency: null, hasActiveBudget: false })} />);
    expect(screen.getAllByText('No active budget')).toHaveLength(1);
    expect(screen.queryByText('Budget used')).not.toBeInTheDocument();
    // Same without a delivery summary: no second grid.
    expect(screen.getByLabelText('Delivery 40%')).toBeInTheDocument();
  });

  it('without delivery data the card still says "No active budget" once', () => {
    render(<ProjectCard project={project} onOpen={vi.fn()}
      projectMoney={money({ activeBudgetAmount: null, activeBudgetCurrency: null, hasActiveBudget: false })} />);
    expect(screen.getAllByText('No active budget')).toHaveLength(1);
    expect(screen.queryByTestId('project-card-bars')).not.toBeInTheDocument();
  });

  it('has no status-change control; the status pill remains', () => {
    render(<ProjectCard project={project} onOpen={vi.fn()} projectMoney={money()} />);
    expect(screen.queryByTestId('project-status-control')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change status/i })).not.toBeInTheDocument();
    expect(screen.getByText('Ongoing Project')).toBeInTheDocument();
  });

  it('Actual is the amount only; the bar carries the percentage, not an "x of y" caption', () => {
    render(<ProjectCard project={project} onOpen={vi.fn()} deliverySummary={{ deliveryPct: 40, committedSpend: 0, budget: 0 }} projectMoney={money()} />);
    const card = screen.getByTestId('project-card');
    expect(within(card).getByText('$125,000.00')).toBeInTheDocument();
    expect(within(card).queryByText(/Updated|Update time|Incomplete source coverage|Restricted rows excluded/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/of .* Active budget/)).not.toBeInTheDocument();
    expect(within(card).getAllByLabelText('25% of Active budget')).toHaveLength(1);
  });

  it('a partial Actual shows Unavailable (never a partial total), with no per-card coverage prose', () => {
    render(<ProjectCard project={project} onOpen={vi.fn()} projectMoney={money({
      actuals: { currency: 'USD', total: '450.00', asOf: null, excludesRestrictedRows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '450.00' }, { category: 'Materials', mapped: false, amount: null }] },
    } as Partial<ProjectMoneyRead>)} />);
    const card = screen.getByTestId('project-card');
    expect(within(card).queryByText('$450.00')).not.toBeInTheDocument();
    expect(within(card).getAllByText('Unavailable')).toHaveLength(1);
    expect(within(card).queryByText(/Incomplete source coverage/)).not.toBeInTheDocument();
  });

  it('the tax basis is plain "excl. PPN": no rate, no DPP, no Show tax details toggle', () => {
    render(<ProjectCard project={project} onOpen={vi.fn()} projectMoney={money()} />);
    const card = screen.getByTestId('project-card');
    expect(within(card).getByTestId('tax-basis')).toHaveTextContent(/^excl\. PPN$/);
    expect(within(card).queryByRole('button', { name: /tax details/i })).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent(/DPP|11%/);
  });
});

describe('AC-RD-SUB-PL-B: Projects board card shows values only, on one line', () => {
  it('shows PMO number and client code as values, without the "PMO Project Number:" label text', () => {
    render(<ProjectKanbanBoard projects={[project]} onOpen={vi.fn()} />);
    const card = screen.getByTestId('project-card');
    expect(card).not.toHaveTextContent('PMO Project Number');
    expect(card).not.toHaveTextContent('Client Project Code');
    const line = within(card).getByText('PMO-26-7711 · CLI-81');
    expect(line).toHaveClass('font-mono');
    // the accessible name keeps the labelled identities for assistive technology
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('PMO Project Number: PMO-26-7711'));
  });

  it('the board tax basis is plain "excl. PPN" with no rate or DPP', () => {
    render(<ProjectKanbanBoard projects={[project]} onOpen={vi.fn()} />);
    const card = screen.getByTestId('project-card');
    expect(within(card).getByTestId('tax-basis')).toHaveTextContent(/^excl\. PPN$/);
    expect(card).not.toHaveTextContent(/DPP|11%/);
  });
});
