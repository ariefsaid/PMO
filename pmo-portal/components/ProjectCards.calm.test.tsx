/**
 * AC-RD-SUB-PL-B — Projects cards and board say each fact once (v0.24 UI subtraction).
 * The project-specific card and board retain the evidence users need while keeping money
 * coverage and references distinct.
 */
import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  it('a missing Active budget is explicit once while Actual and Budget used remain distinct', () => {
    render(<ProjectCard project={project} onOpen={vi.fn()} deliverySummary={{ deliveryPct: 40, committedSpend: 0, budget: 0 }}
      projectMoney={money({ activeBudgetAmount: null, activeBudgetCurrency: null, hasActiveBudget: false })} />);
    expect(screen.getAllByText('No active budget')).toHaveLength(1);
    expect(screen.getByText('Budget used')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByLabelText('Delivery 40%')).toBeInTheDocument();
  });

  it('without delivery data the card still says "No active budget" once', () => {
    render(<ProjectCard project={project} onOpen={vi.fn()}
      projectMoney={money({ activeBudgetAmount: null, activeBudgetCurrency: null, hasActiveBudget: false })} />);
    expect(screen.getAllByText('No active budget')).toHaveLength(1);
    expect(screen.getByText('No phases yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review delivery plan' })).toHaveAttribute('href', '/projects/p1/overview');
  });

  it('has no status-change control; the status pill remains', () => {
    render(<ProjectCard project={project} onOpen={vi.fn()} projectMoney={money()} />);
    expect(screen.queryByTestId('project-status-control')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change status/i })).not.toBeInTheDocument();
    expect(screen.getByText('Ongoing Project')).toBeInTheDocument();
  });

  it('Actual is the amount only; the bar carries the percentage, not an "x of y" caption', () => {
    render(<ProjectCard project={project} onOpen={vi.fn()} deliverySummary={{ deliveryPct: 40, committedSpend: 0, budget: 0 }} projectMoney={money()} />);
    const card = screen.getByRole('article');
    expect(within(card).getByText('125,000')).toBeInTheDocument();
    expect(within(card).getByText('Amounts · USD')).toBeInTheDocument();
    expect(within(card).queryByText(/Updated|Update time|Incomplete source coverage|Restricted rows excluded/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/of .* Active budget/)).not.toBeInTheDocument();
    expect(within(card).getAllByLabelText('25% of Active budget')).toHaveLength(1);
  });

  it('a partial Actual stays unavailable in the card; the page-level note owns the shared recovery action', () => {
    render(<ProjectCard project={project} onOpen={vi.fn()} projectMoney={money({
      actuals: { currency: 'USD', total: '450.00', asOf: null, excludesRestrictedRows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '450.00' }, { category: 'Materials', mapped: false, amount: null }] },
    } as Partial<ProjectMoneyRead>)} />);
    const card = screen.getByRole('article');
    expect(within(card).queryByText('$450')).not.toBeInTheDocument();
    expect(within(card).getAllByRole('link', { name: 'Review project finances' })).toHaveLength(1);
  });

  it('the contract states its tax basis', () => {
    render(<ProjectCard project={project} onOpen={vi.fn()} projectMoney={money()} />);
    const card = screen.getByRole('article');
    expect(within(card).getByTestId('tax-basis')).toHaveTextContent(/^excl\. PPN$/);
  });
});

describe('AC-RD-SUB-PL-B: Projects board preserves recognizable references', () => {
  it('shows project identifiers behind a named disclosure', async () => {
    render(<ProjectKanbanBoard projects={[project]} onOpen={vi.fn()} />);
    const card = screen.getByRole('button', { name: /Open project Synthetic project/ });
    const article = card.closest('article')!;
    const user = userEvent.setup();
    await user.click(article.querySelector('summary')!);
    expect(within(article).getByText('PMO Project Number:').parentElement).toHaveTextContent('PMO-26-7711');
    expect(within(article).getByText('Client Project Code:').parentElement).toHaveTextContent('CLI-81');
  });

  it('the board contract states its tax basis', () => {
    render(<ProjectKanbanBoard projects={[project]} onOpen={vi.fn()} />);
    const card = screen.getByRole('article');
    expect(within(card).getByTestId('tax-basis')).toHaveTextContent(/^excl\. PPN$/);
  });
});
