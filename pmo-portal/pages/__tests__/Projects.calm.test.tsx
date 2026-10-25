/** Projects table keeps identity, customer and money evidence legible without duplicating caveats. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import Projects from '../Projects';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const projectsState = { data: null as ProjectWithRefs[] | null, isPending: false, isError: false, refetch: vi.fn() };
const deliverySummaryState = { data: {} as Record<string, unknown>, isPending: false, isError: false };
const projectMoneyState = { data: {} as Record<string, unknown>, isPending: false, isError: false, refetch: vi.fn() };
const clientsState = { data: [] as unknown[], isPending: false, isError: false, isSuccess: true, refetch: vi.fn() };
const companiesState = { data: [] as unknown[], isPending: false, isError: false, isSuccess: true, refetch: vi.fn() };

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('../../components/ProjectStatusControl', () => ({ default: () => null }));
vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({ useProjectClassificationOptions: () => ({ data: { serviceLines: [], sectors: [] }, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => companiesState }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => clientsState,
  useProjectManagers: () => ({ data: [], isPending: false, isError: false, isSuccess: true }),
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useProjectsMilestoneDates: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => deliverySummaryState,
}));
vi.mock('@/src/hooks/useProjectsMoneyCollection', () => ({ useProjectsMoneyCollection: () => projectMoneyState }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }) }));

const ROWS = 25;
const row = (i: number): ProjectWithRefs => ({
  id: `p${i}`, name: `Synthetic project ${i}`, code: `CLI-${i}`, pmo_project_number: `PMO-${1000 + i}`,
  customer_contract_ref: `CONTRACT-${i}`, status: 'Ongoing Project', client_id: 'c1', project_manager_id: 'pm-1',
  contract_value: 5_000_000, currency: 'USD', tax_treatment: 'exclusive', budget: 0, spent: 0, end_date: '2026-12-18',
  client: { name: 'Acme' }, pm: { full_name: 'Alice Manager' },
  end_client_id: i === 0 ? 'c9' : null, end_client: i === 0 ? { name: 'Endco' } : null,
  contract_date: null, decided_at: null,
}) as unknown as ProjectWithRefs;

const money = (i: number) => {
  const partial = i === 1 || i === 2; // two rows with an unmapped category
  const restricted = i === 3;
  return {
    ledgerBasis: 'erp',
    actuals: {
      currency: 'USD', total: partial ? null : `${1_000_000 + i}.00`, asOf: '2026-10-01T00:00:00Z',
      excludesRestrictedRows: restricted,
      categories: [{ category: 'Labor', mapped: !partial, amount: partial ? null : `${1_000_000 + i}.00` }],
    },
    activeBudgetAmount: '4000000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true,
  };
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/projects']}>
      <ToastProvider>
        <Projects />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  projectsState.data = Array.from({ length: ROWS }, (_, i) => row(i));
  projectsState.isPending = false;
  projectsState.isError = false;
  deliverySummaryState.data = Object.fromEntries(
    projectsState.data.map((p, i) => [p.id, { deliveryPct: i === 0 ? null : 40, committedSpend: 0, budget: 0 }]),
  );
  projectMoneyState.data = Object.fromEntries(projectsState.data.map((p, i) => [p.id, money(i)]));
});
afterEach(() => vi.unstubAllGlobals());

describe('AC-RD-SUB-PL-A: Projects table says each fact once', () => {
  it('scope line has one quiet Pipeline link', () => {
    renderPage();
    expect(screen.getAllByRole('link', { name: 'Pipeline' })).toHaveLength(1);
  });

  it('keeps end-customer identity beside the project without a second data column', () => {
    renderPage();
    expect(screen.queryByRole('columnheader', { name: /end customer/i })).not.toBeInTheDocument();
    expect(screen.getByText('End customer: Endco')).toBeInTheDocument();
  });

  it('project identity keeps customer and references labelled and visible', () => {
    renderPage();
    const first = screen.getByText('Synthetic project 0').closest('tr')!;
    expect(within(first).getByText(/PMO Project Number: PMO-1000/)).toBeInTheDocument();
    expect(within(first).getByText(/Client Project Code: CLI-0/)).toBeInTheDocument();
    expect(within(first).getByText(/Customer contract reference: CONTRACT-0/)).toBeInTheDocument();
  });

  it('classification fields live inside the one Filters disclosure (no second trigger)', async () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /^Classification/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Filters/ })).toHaveLength(1);
    expect(screen.queryByLabelText('Filter by service line')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    expect(screen.getByLabelText('Filter by service line')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by customer')).toBeInTheDocument();
  });

  it('Actual cells are amount only; one table note carries partial coverage and the date', () => {
    renderPage();
    const body = document.querySelector('tbody')!;
    expect(within(body).queryByText(/ERP actual|Committed POs|Updated|Incomplete source coverage/)).not.toBeInTheDocument();
    expect(screen.queryByText('Incomplete source coverage')).not.toBeInTheDocument();
    const notes = screen.getAllByText(/Actual is partial on/);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent('Actual is partial on 2 of 25 projects. Updated');
    // null Actual stays unavailable, never 0
    const partialRow = screen.getByText('Synthetic project 1').closest('tr')!;
    expect(within(partialRow).getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(within(partialRow).queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('the coverage note omits the Updated sentence when no ERP update time is known', () => {
    projectMoneyState.data = Object.fromEntries(Object.entries(projectMoneyState.data).map(([id, m]) => [id, { ...(m as object), actuals: { ...(m as { actuals: object }).actuals, asOf: null } }]));
    renderPage();
    expect(screen.getByText('Actual is partial on 2 of 25 projects.')).toBeInTheDocument();
  });

  it('only a restricted row carries a per-row tag', () => {
    renderPage();
    const restricted = screen.getByText('Synthetic project 3').closest('tr')!;
    expect(within(restricted).getByText('Restricted excluded')).toBeInTheDocument();
    expect(screen.getAllByText('Restricted excluded')).toHaveLength(1);
  });

  it('Budget used reports the percentage against its Active-budget basis', () => {
    renderPage();
    const bar = within(screen.getByText('Synthetic project 4').closest('tr')!).getByRole('progressbar', { name: '25% of Active budget' });
    expect(bar).toBeInTheDocument();
  });

  it('delivery without phases is named explicitly', () => {
    renderPage();
    const noPhases = screen.getByText('Synthetic project 0').closest('tr')!;
    expect(within(noPhases).getByText('No phases yet')).toBeInTheDocument();
  });

  it('phone Filters panel drops the "Loading options…" and "No options available" lines', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    clientsState.data = []; companiesState.data = [];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    expect(screen.queryByText('No options available')).not.toBeInTheDocument();
    clientsState.isPending = true; companiesState.isPending = true;
    clientsState.isSuccess = false; companiesState.isSuccess = false;
    renderPage();
    expect(screen.queryByText('Loading options…')).not.toBeInTheDocument();
    clientsState.isPending = false; companiesState.isPending = false;
    clientsState.isSuccess = true; companiesState.isSuccess = true;
  });

  it('a failed options load still offers Retry', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    clientsState.isError = true; clientsState.isSuccess = false;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    const panel = screen.getByRole('region', { name: 'Filters' });
    clientsState.refetch.mockClear();
    await userEvent.click(within(panel).getByRole('button', { name: 'Retry options' }));
    expect(clientsState.refetch).toHaveBeenCalled();
    clientsState.isError = false; clientsState.isSuccess = true;
  });
});
