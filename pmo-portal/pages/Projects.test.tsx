import '@/test/stubGetAnimations';
vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({ useProjectClassificationOptions: () => ({ data: { serviceLines: [], sectors: [] }, isPending: false, isError: false }) }));
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// OD-TAX-1 (#548): the money forms now PRE-SELECT the org's `default_tax_treatment`, which is a
// live org read (`useOrgTaxDefault` → react-query + AuthContext). Only the READ is stubbed here —
// `useTaxTreatmentPreselect` stays the real implementation, so this suite renders the shipped
// seeding behaviour without needing a QueryClientProvider/AuthProvider it otherwise has no use for.
// The pre-selection rule itself is owned by src/hooks/useOrgTaxDefault.test.tsx.
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => 'exclusive' };
});

import { render, screen, within, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { addBuilderFilter, removeBuilderFilter } from './__tests__/projectFilterBuilder.helpers';
import Projects from './Projects';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { CanonicalBudgetReading, ProjectMoneyRead } from '@/src/lib/db/projectMoney';
import { formatExactMoney } from '@/src/lib/format';
import { getNumberLocale, resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { BahasaProvider } from '@/test/bahasa';

const seed = [
  { id: 'p1', name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001', status: 'Ongoing Project',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 5000000, currency: 'USD', budget: 4700000,
    spent: 2100000, end_date: '2026-12-18', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null },
  { id: 'p2', name: 'Northwind ERP Rollout', code: 'PRJ-002', status: 'Tender Submitted',
    client_id: 'c3', project_manager_id: 'u-alice', contract_value: 1200000, currency: 'USD', budget: 0, spent: 0,
    end_date: '2026-12-31', client: { name: 'Northwind Manufacturing' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null },
  { id: 'p3', name: 'Regional Services Program', code: 'PRJ-003', status: 'PQ Submitted',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 800000, currency: 'USD', budget: 0, spent: 0,
    end_date: '2026-12-31', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null },
];

// Won project with customer_contract_ref set (for AC-1011 UI test)
const seedWithWon = [
  ...seed,
  { id: 'p4', name: 'Won Deal', code: 'PRJ-004', status: 'Won, Pending KoM',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 2000000, currency: 'USD', budget: 0, spent: 0,
    end_date: '2026-12-31', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: 'CPO-2026-999', contract_date: '2026-01-15', decided_at: '2026-01-15T00:00:00Z' },
];

const projectsState = { data: seed as unknown as ProjectWithRefs[], isPending: false, isError: false, refetch: vi.fn() };
// Mutable role box (hoisted) — drives the create/edit/archive affordance gating (ADR-0016)
// on the REAL JWT role. A test sets `roleBox.value` to render the page as a different role.
const { roleBox, projectMutations, deliverySummaryState, projectMoneyState, myTasksState } = vi.hoisted(() => ({
  roleBox: { value: 'Project Manager', viewerId: 'u-alice' },
  projectMutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  },
  deliverySummaryState: {
    p1: { deliveryPct: 50 as number | null, committedSpend: 2_100_000, budget: 4_700_000 },
    p2: { deliveryPct: 25 as number | null, committedSpend: 0, budget: 0 },
    p3: { deliveryPct: null, committedSpend: 0, budget: 0 },
    isError: false,
  },
  projectMoneyState: {
    data: {} as Record<string, ProjectMoneyRead> | undefined,
    isPending: false,
    fetchStatus: 'fetching' as 'fetching' | 'idle',
    isError: false,
    refetch: vi.fn(),
  },
  myTasksState: {
    data: [] as { project_id: string }[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

const canonicalPosition = (overrides: Partial<CanonicalBudgetReading> = {}): CanonicalBudgetReading => ({
  projectId: 'p1', ledgerBasis: 'erp', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '500000.00',
  spent: '125000.00', openCommitment: null, consumption: '125000.00', complete: true,
  usedRatio: '0.25', usedPercent: '25', consumptionVariance: '-375000.00', riskEligible: true, atRisk: false,
  ...overrides,
});
// FR-L10N-020: this component reads useOrgCurrency for its ACROSS-record aggregates. Pinned here
// rather than left to a real query. ⚑ At LINE-START on purpose — inserted inside a neighbouring
// vi.mock call it parses as a syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
// #758: the end-customer filter + form list ALL the org's companies via useCompanies().
const { companiesState } = vi.hoisted(() => ({
  companiesState: { data: [] as { id: string; name: string; type: string }[], isError: false },
}));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => companiesState,
}));
vi.mock('@/src/hooks/useProjectNumberProposal', () => ({
  useProjectNumberProposal: () => ({ status: 'success', number: 'PMO-TEST-0001', error: null }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => ({ data: [{ id: 'c2', name: 'Innovate Corp', type: 'Client' }] }),
  useProjectManagers: () => ({ data: [{ id: 'u-alice', full_name: 'Alice Manager' }] }),
  useProjectMutations: () => projectMutations,
  useProjectsMilestoneDates: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: roleBox.viewerId, org_id: 'org-1' }, role: roleBox.value }),
}));
// B-11 fix: Projects now reads the caller's tasks to scope an Engineer's "My Projects".
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => myTasksState }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => ({ data: deliverySummaryState, isError: deliverySummaryState.isError, isPending: false }),
}));
vi.mock('@/src/hooks/useProjectsMoneyCollection', () => ({ useProjectsMoneyCollection: () => projectMoneyState }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: roleBox.value, realRole: roleBox.value, canImpersonate: false, viewAs: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectWinEligibility: () => ({ data: 'allowed' }),
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
}));
// list-working-set-return (#682): the page writes URL changes through the real router navigate
// (one replace per event), so tests read the REAL location to assert the URL and the record-open
// return-context `location.state` — the #683 Companies pattern — instead of mocking navigation away.
const LocationProbe: React.FC = () => {
  const location = useLocation();
  return (
    <div
      data-testid="location-probe"
      data-pathname={location.pathname}
      data-search={location.search}
      data-state={JSON.stringify(location.state ?? null)}
    />
  );
};

// Projects rows embed ProjectStatusControl, which uses useToast — needs a provider.
// list-working-set-return (#682): the list-return seam captures context only from the list's own
// canonical index path (`/projects`), so the default entry must be `/projects`, not `/`.
const projectPage = (initialPath = '/projects') => (
  <MemoryRouter initialEntries={[initialPath]}>
    <LocationProbe />
    <ToastProvider>
      <Projects />
    </ToastProvider>
  </MemoryRouter>
);

const renderPage = (role = 'Project Manager', initialPath = '/projects') => {
  roleBox.value = role;
  return render(projectPage(initialPath));
};

const renderBahasaPage = (role = 'Project Manager', initialPath = '/projects') => {
  roleBox.value = role;
  return render(
    <BahasaProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <ToastProvider><Projects /></ToastProvider>
      </MemoryRouter>
    </BahasaProvider>,
  );
};

describe('Projects index — kanban view (AC-PK-008)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = seed as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  it('renders on the shared ListPage shell: header + canonical toolbar (CW-5)', () => {
    renderPage();
    expect(screen.getByTestId('list-page-header')).toBeInTheDocument();
    expect(screen.getByTestId('list-page-toolbar')).toBeInTheDocument();
    expect(within(screen.getByTestId('list-page-header')).getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    // View and list actions sit with the header CTA, outside the filter row.
    expect(within(screen.getByTestId('list-page-header')).getByRole('tablist', { name: /projects view/i })).toBeInTheDocument();
    expect(within(screen.getByTestId('list-page-header')).getByRole('button', { name: /^More actions$/i })).toBeInTheDocument();
  });

  it('keeps search, status, Add filter and the result count together in the list toolbar', () => {
    renderPage();
    const row = screen.getByTestId('projects-toolbar-row');
    expect(within(row).getByRole('searchbox', { name: /search projects/i })).toBeInTheDocument();
    expect(within(row).getByRole('tablist', { name: /status filter/i })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /^Add filter$/i })).toBeInTheDocument();
    expect(within(row).getByText('Showing 3 of 3')).toBeInTheDocument();
  });

  it('AC-EXP-008 / AC-IMP-009: renders live Export and Import affordances in the toolbar', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /^More actions/ }));
    const exportBtn = screen.getByRole('button', { name: /export/i });
    expect(exportBtn).toBeInTheDocument();
    expect(exportBtn).not.toBeDisabled();
    // #495: this page now carries TWO importers — projects and budget lines (DD-BIMP-4). Naming
    // each exactly is the point: a /import/i regex matched both and asserted neither.
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import budgets' })).toBeInTheDocument();
  });

  it('AC-PK-008: the view toggle offers a Board option; selecting it renders the kanban board', async () => {
    renderPage();
    const toggle = screen.getByRole('tablist', { name: /projects view/i });
    expect(within(toggle).getByRole('tab', { name: /^Board$/i })).toBeInTheDocument();
    await userEvent.click(within(toggle).getByRole('tab', { name: /^Board$/i }));
    // Board root appears — the kanban layout, distinct from the table/cards view.
    const board = screen.getByTestId('project-kanban-board');
    expect(board).toBeInTheDocument();
    // CW-3b: the board's cards ARE the shared canonical ProjectCardShell (one project-card
    // vocabulary everywhere) — every rendered project-card lives inside the board, not in a
    // separate cards-view grid.
    const cards = screen.getAllByTestId('project-card');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(board).toContainElement(card);
  });

  it('AC-PRJ-L10N-001: Bahasa localizes the project status, Board tab, and row Edit action', async () => {
    renderBahasaPage('Admin', '/projects?view=table');
    const pill = (await screen.findAllByText('Berjalan')).find((el) => el.closest('tr'))!;
    const row = pill.closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Tindakan baris' }));
    expect(await screen.findByRole('menuitem', { name: 'Ubah' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Papan' }));
    expect(screen.getByTestId('project-kanban-board')).toBeInTheDocument();
  });
});

describe('Projects index — IA-3 (real data)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = seed as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  it('AC-CODE-003: project cell shows identifier values without the label prefix in the truncating element, label kept for AT (#838)', async () => {
    const prev = projectsState.data;
    projectsState.data = [{ ...seed[0], pmo_project_number: 'PMO-26-0042', code: 'CLIENT-77' }] as unknown as ProjectWithRefs[];
    try {
      renderPage();
      // PL-A: identifiers share ONE mono line (no per-row references disclosure); the label stays for AT.
      const ids = screen.getByTitle('PMO-26-0042 · CLIENT-77');
      expect(ids).toHaveTextContent(/^PMO-26-0042 · CLIENT-77$/);
      expect(screen.queryByText('More project references')).not.toBeInTheDocument();
      expect(within(ids.parentElement as HTMLElement).getByText('PMO Project Number:')).toHaveClass('sr-only');
    } finally {
      projectsState.data = prev;
    }
  });

  it('renders seeded projects with joined client + PM names (AC-401)', () => {
    renderPage();
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getAllByText('Innovate Corp').length).toBeGreaterThan(0);
    // Every seeded row is the viewer's own, so the PM column says nothing and is dropped.
    expect(screen.queryByRole('columnheader', { name: 'PM' })).not.toBeInTheDocument();
  });

  it('says one shared manager once above the list and drops the column; different managers get the column with names', () => {
    roleBox.viewerId = 'u-someone-else';
    const previous = projectsState.data;
    try {
      renderPage();
      expect(screen.queryByRole('columnheader', { name: 'PM' })).not.toBeInTheDocument();
      expect(screen.getByText('Project manager: Alice Manager')).toBeInTheDocument();
      cleanup();
      projectsState.data = (previous as unknown as Record<string, unknown>[]).map((row, i) => (
        i === 0 ? { ...row, project_manager_id: 'u-bob', pm: { full_name: 'Bob Builder' } } : row
      )) as unknown as ProjectWithRefs[];
      renderPage();
      expect(screen.getByRole('columnheader', { name: 'PM' })).toBeInTheDocument();
      expect(within(document.querySelector('tbody')!).getByText('Bob Builder')).toBeInTheDocument();
      expect(screen.queryByText(/^Project manager:/)).not.toBeInTheDocument();
    } finally {
      projectsState.data = previous;
      roleBox.viewerId = 'u-alice';
    }
  });

  it('RF-010: keeps contract basis concise while exposing the complete qualifier to assistive technology', () => {
    const previous = projectsState.data;
    projectsState.data = [{
      ...seed[0], tax_treatment: 'exclusive', tax_rate: 11,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }] as unknown as ProjectWithRefs[];
    try {
      renderPage();
      // One basis across the visible rows is said once, in the column header, not under every figure.
      expect(screen.getByRole('columnheader', { name: 'Contract (excl. PPN)' })).toBeInTheDocument();
      expect(screen.queryByTestId('tax-basis')).not.toBeInTheDocument();
      const detail = screen.getByText('excl. PPN 11% · DPP 1/1');
      expect(detail).toHaveAttribute('data-testid', 'contract-tax-label-p1');
      expect(detail).toHaveClass('max-w-full', 'whitespace-normal', 'break-words');
      expect(detail.parentElement).toHaveClass('sr-only');
      expect(detail.parentElement?.parentElement).toHaveAttribute('aria-describedby', detail.parentElement?.id);
    } finally {
      projectsState.data = previous;
    }
  });

  it('defaults to the Table view and the toggle switches to Cards (AC-A)', async () => {
    renderPage();
    const toggle = screen.getByRole('tablist', { name: /projects view/i });
    expect(within(toggle).getByRole('tab', { name: /Table/i })).toHaveAttribute('aria-selected', 'true');
    // No project-card carriers in Table view
    expect(screen.queryAllByTestId('project-card').length).toBe(0);
    await userEvent.click(within(toggle).getByRole('tab', { name: /Cards/i }));
    expect(screen.getAllByTestId('project-card').length).toBeGreaterThan(0);
  });

  it('renders status as a StatusPill (paired surface + text), not a legacy badge (AC-C)', () => {
    renderPage();
    const pill = screen.getAllByText('Ongoing').map((el) => el.closest('[class*="rounded-full"]')).find(Boolean)!;
    // The StatusPill carries the pill chrome + the paired neutral status surface
    // (owner ban 2026-10-29: the former decorative leading dot is gone; the label
    // + surface carry the status).
    expect(pill.className).toContain('rounded-full');
    expect(pill.className).toContain('bg-status-neutral-surface');
  });

  it('CW-7: a zero/missing-budget project states why usage cannot be shown, never literal NaN% or $NaN', () => {
    // Seed p2/p3 carry budget 0 (zero-divide) — the budget-used cell must guard the math.
    renderPage();
    // No NaN leaks anywhere on the rendered index.
    expect(document.body.textContent).not.toMatch(/NaN/);
    // Zero-budget rows have an explanatory label instead of a dash in the Budget used column.
    expect(screen.queryByRole('button', { name: /optional columns/i })).not.toBeInTheDocument();
  });

  it('AC-NAV-006: navigates to the project detail route when a row is activated, carrying validated list-return context (no tab)', async () => {
    renderPage();
    await userEvent.click(screen.getByText('Innovate Corp HQ Fit-Out'));
    const probe = screen.getByTestId('location-probe');
    // Director ruling (2026-09-29): the destination stays canonical `/projects/p1` while the
    // record-open now additionally carries the validated Projects list-return context.
    await waitFor(() => expect(probe.dataset.pathname).toBe('/projects/p1'));
    const state = JSON.parse(probe.dataset.state ?? 'null') as Record<string, unknown>;
    expect(state.pmoListReturn).toMatchObject({ list: 'projects' });
  });

  // Model B (ADR-0020): the pre-win "Leads" partition lives in the Sales Pipeline now, so the
  // Projects status SegFilter no longer offers a "Leads" tab; the surviving filters are
  // All / My Projects / Ongoing / Completed.
  it('AC-IXD-PROJ-001a: the status SegFilter does NOT offer a "Leads" tab (leads live in the Pipeline)', () => {
    renderPage();
    const statusTabs = screen.getByRole('tablist', { name: /status filter/i });
    expect(within(statusTabs).queryByRole('tab', { name: /^Leads$/ })).toBeNull();
    expect(within(statusTabs).getByRole('tab', { name: /^All$/ })).toBeInTheDocument();
    expect(within(statusTabs).getByRole('tab', { name: /^My Projects$/ })).toBeInTheDocument();
    expect(within(statusTabs).getByRole('tab', { name: /^Ongoing$/ })).toBeInTheDocument();
    expect(within(statusTabs).getByRole('tab', { name: /^Completed$/ })).toBeInTheDocument();
  });

  it('filters to Ongoing via the status SegFilter (AC-403)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Ongoing$/ }));
    // Ongoing = Won/Ongoing/On-Hold delivery work; the pre-win deals are excluded.
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.queryByText('Regional Services Program')).not.toBeInTheDocument();
  });

  it('AC-002 #1325: project rows show the short name, disclose the contractual title, and search either identity', async () => {
    const withAlias = { ...seed[0], short_name: 'Harbor Operations' } as ProjectWithRefs;
    projectsState.data = [withAlias, seed[1], seed[2]] as ProjectWithRefs[];
    renderPage();
    const search = screen.getByRole('searchbox', { name: /search projects/i });
    expect(screen.getByRole('button', { name: 'Harbor Operations' })).toHaveAttribute('title', 'Innovate Corp HQ Fit-Out');
    expect(screen.getByRole('button', { name: 'Harbor Operations' })).toHaveAccessibleDescription('Innovate Corp HQ Fit-Out');
    await userEvent.type(search, 'Harbor Operations');
    expect(screen.getByRole('button', { name: 'Harbor Operations' })).toBeVisible();
    expect(screen.queryByText('Northwind ERP Rollout')).not.toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, 'Innovate Corp HQ Fit-Out');
    expect(screen.getByRole('button', { name: 'Harbor Operations' })).toBeVisible();
  });

  it('filters by search (AC-404)', async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/Search projects/i), 'Northwind');
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.queryByText('Innovate Corp HQ Fit-Out')).not.toBeInTheDocument();
  });

  it('"My Projects" uses the real profile id (AC-402)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /My Projects/ }));
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument(); // u-alice manages all
  });
});

describe('Projects index states', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = seed as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  it('shows loading state while pending (AC-405)', () => {
    projectsState.isPending = true; projectsState.isError = false;
    renderPage();
    expect(screen.getByTestId('projects-loading')).toBeInTheDocument();
  });

  it('shows error state with retry on failure (AC-408)', () => {
    projectsState.isError = true; projectsState.isPending = false;
    renderPage();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('C3: shows the teaching empty state with a live New project CTA when zero rows (AC-406)', () => {
    projectsState.data = [];
    renderPage(); // renders as PM (canCreate=true)
    expect(screen.getByText(/No projects yet/i)).toBeInTheDocument();
    // The live "New project" CTA is shown (not disabled) — page is always actionable for PM.
    const ctaButtons = screen.getAllByRole('button', { name: /New project/i });
    ctaButtons.forEach((btn) => expect(btn).not.toBeDisabled());
  });

  it('C3: the page header shows a live New project CTA for PM (not a dead/disabled button)', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    // The primary CTA in the header is live for PM.
    const headerCta = screen.getAllByRole('button', { name: /New project/i })[0];
    expect(headerCta).not.toBeDisabled();
  });

  it('shows a filter-no-match empty state with a clear-filters action (AC-D)', async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/Search projects/i), 'zzzz-no-match');
    expect(screen.getByText(/No projects match/i)).toBeInTheDocument();
    // the LIVE "Clear filters" action is kept (it actually does something).
    expect(screen.getByRole('button', { name: /Clear filters/i })).toBeInTheDocument();
  });
});

describe('Projects secondary reads keep the active view mounted (C22)', () => {
  const atRiskMoney = {
    p1: {
      actuals: {
        currency: 'USD', total: '450000.00', asOf: '2026-10-01T00:00:00Z', excludesRestrictedRows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '450000.00' }],
      },
      activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true,
      ledgerBasis: 'erp' as const,
      budgetPosition: canonicalPosition({ spent: '450000.00', consumption: '450000.00', usedRatio: '0.9', usedPercent: '90', consumptionVariance: '-50000.00', atRisk: true }),
    },
  };

  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = seed as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
    projectMoneyState.data = atRiskMoney;
    projectMoneyState.isPending = false;
    projectMoneyState.fetchStatus = 'fetching';
    projectMoneyState.isError = false;
    myTasksState.data = [];
    myTasksState.isPending = false;
    myTasksState.isError = false;
  });

  it.each([
    ['table', 'projects-table-container'],
    ['kanban', 'project-kanban-board'],
  ])('keeps the %s view and its scroll position during an at-risk money refresh', (view, testId) => {
    const path = `/projects?filter=at-risk&view=${view}`;
    const rendered = renderPage('Project Manager', path);
    const viewNode = screen.getByTestId(testId);
    viewNode.scrollTop = 180;
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();

    projectMoneyState.isPending = true;
    rendered.rerender(projectPage(path));

    expect(screen.getByTestId(testId)).toBe(viewNode);
    expect(viewNode.scrollTop).toBe(180);
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
  });

  it('keeps the calendar view mounted during an at-risk money refresh', () => {
    const path = '/projects?filter=at-risk&view=calendar';
    const rendered = renderPage('Project Manager', path);
    const calendarNode = screen.queryByTestId('calendar-month-grid') ?? screen.getByTestId('calendar-agenda');
    calendarNode.scrollTop = 120;

    projectMoneyState.isPending = true;
    rendered.rerender(projectPage(path));

    const refreshedCalendar = screen.queryByTestId('calendar-month-grid') ?? screen.getByTestId('calendar-agenda');
    expect(refreshedCalendar).toBe(calendarNode);
    expect(calendarNode.scrollTop).toBe(120);
  });

  it('keeps expanded phone project references open during an at-risk money refresh', async () => {
    projectsState.data = [{
      ...seed[0],
      pmo_project_number: 'PMO-26-0042',
      customer_contract_ref: 'CLIENT-PO-1',
    }] as unknown as ProjectWithRefs[];
    const path = '/projects?filter=at-risk&view=cards';
    const rendered = renderPage('Project Manager', path);
    const referencesToggle = screen.getByLabelText('More project references for Innovate Corp HQ Fit-Out');
    await userEvent.click(referencesToggle);
    const referencesDetails = referencesToggle.closest('details');
    expect(referencesDetails).toHaveAttribute('open');

    projectMoneyState.isPending = true;
    rendered.rerender(projectPage(path));

    expect(screen.getByLabelText('More project references for Innovate Corp HQ Fit-Out')).toBe(referencesToggle);
    expect(referencesDetails).toHaveAttribute('open');
    expect(screen.getByText('CLIENT-PO-1')).toBeInTheDocument();
  });

  it('keeps the My Projects table and its scroll position when the task read re-enters pending', () => {
    myTasksState.data = [{ project_id: 'p1' }];
    const path = '/projects?filter=My%20Projects&view=table';
    const rendered = renderPage('Engineer', path);
    const table = screen.getByTestId('projects-table-container');
    table.scrollTop = 160;
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();

    myTasksState.isPending = true;
    rendered.rerender(projectPage(path));

    expect(screen.getByTestId('projects-table-container')).toBe(table);
    expect(table.scrollTop).toBe(160);
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
  });
});

describe('Projects table — compact layout (#1)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = seed as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  it('renders each populated project table column with its row values', () => {
    const previousProjects = projectsState.data;
    const previousMoney = projectMoneyState.data;
    const previousMoneyPending = projectMoneyState.isPending;
    const previousMoneyError = projectMoneyState.isError;
    const previousDelivery = {
      p1: deliverySummaryState.p1,
      p2: deliverySummaryState.p2,
      p3: deliverySummaryState.p3,
      isError: deliverySummaryState.isError,
    };
    const previousViewerId = roleBox.viewerId;

    try {
      projectsState.data = [
        { ...seed[0], pmo_project_number: 'PMO-SYN-001', code: 'CLIENT-SYN-44', end_client: { name: 'Regional Services Client' } },
        { ...seed[1], project_manager_id: 'u-bob', pm: { full_name: 'Bob Manager' } },
        { ...seed[2], project_manager_id: 'u-carol', pm: { full_name: 'Carol Manager' } },
      ] as unknown as ProjectWithRefs[];
      roleBox.viewerId = 'u-viewer';
      deliverySummaryState.p1 = { deliveryPct: 50, committedSpend: 2_100_000, budget: 4_700_000 };
      projectMoneyState.data = {
        p1: {
          ledgerBasis: 'erp',
          actuals: {
            currency: 'USD', total: '125000.00', asOf: null, excludesRestrictedRows: false,
            categories: [{ category: 'Labor', mapped: true, amount: '125000.00' }],
          },
          activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true,
          budgetPosition: canonicalPosition(),
        },
      };
      projectMoneyState.isPending = false;
      projectMoneyState.isError = false;

      renderPage('Admin');

      const table = within(screen.getByTestId('projects-table-container'));
      for (const column of ['Project', 'PM', 'Status', 'Contract', 'Actual', 'Progress', 'Budget used']) {
        expect(table.getByRole('columnheader', { name: column })).toBeInTheDocument();
      }

      const row = screen.getByText('Innovate Corp HQ Fit-Out').closest('tr')!;
      expect(within(row).getByText('Innovate Corp')).toBeInTheDocument();
      expect(within(row).getByTitle('PMO-SYN-001 · CLIENT-SYN-44')).toHaveTextContent('PMO-SYN-001 · CLIENT-SYN-44');
      expect(within(row).getByText('Regional Services Client')).toBeInTheDocument();
      expect(within(row).getByText('Alice Manager')).toBeInTheDocument();
      expect(within(row).getByText('Ongoing')).toBeInTheDocument();
      expect(within(row).getByText('$5,000,000')).toBeInTheDocument();
      expect(within(row).getByText('$125,000')).toBeInTheDocument();
      expect(within(row).getByLabelText('Delivery 50%')).toBeInTheDocument();
      expect(within(row).getByText('50%')).toBeInTheDocument();
      expect(within(row).getByLabelText('25% of Active budget before tax')).toBeInTheDocument();
    } finally {
      projectsState.data = previousProjects;
      projectMoneyState.data = previousMoney;
      projectMoneyState.isPending = previousMoneyPending;
      projectMoneyState.isError = previousMoneyError;
      Object.assign(deliverySummaryState, previousDelivery);
      roleBox.viewerId = previousViewerId;
    }
  });

  it('RF-009: hides optional progress and budget columns when loaded data is absent', () => {
    const priorDelivery = { p1: deliverySummaryState.p1, p2: deliverySummaryState.p2, p3: deliverySummaryState.p3 };
    const priorMoney = projectMoneyState.data;
    try {
      deliverySummaryState.p1 = { deliveryPct: null, committedSpend: 0, budget: 0 };
      deliverySummaryState.p2 = { deliveryPct: null, committedSpend: 0, budget: 0 };
      deliverySummaryState.p3 = { deliveryPct: null, committedSpend: 0, budget: 0 };
      projectMoneyState.data = {};
      projectMoneyState.isError = false;
      renderPage();
      expect(screen.queryByRole('columnheader', { name: 'Progress' })).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Budget used' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /optional columns/i })).not.toBeInTheDocument();
    } finally {
      Object.assign(deliverySummaryState, priorDelivery);
      projectMoneyState.data = priorMoney;
    }
  });

  it('RF-009: a failed spending read hides the money column and says why once; a failed progress read keeps Progress', () => {
    const priorDelivery = { p1: deliverySummaryState.p1, p2: deliverySummaryState.p2, p3: deliverySummaryState.p3 };
    const priorDeliveryError = deliverySummaryState.isError;
    const priorMoney = projectMoneyState.data;
    const priorMoneyError = projectMoneyState.isError;
    try {
      deliverySummaryState.p1 = { deliveryPct: null, committedSpend: 0, budget: 0 };
      deliverySummaryState.p2 = { deliveryPct: null, committedSpend: 0, budget: 0 };
      deliverySummaryState.p3 = { deliveryPct: null, committedSpend: 0, budget: 0 };
      deliverySummaryState.isError = true;
      projectMoneyState.data = {};
      projectMoneyState.isError = true;
      renderPage();
      expect(screen.getByRole('columnheader', { name: 'Progress' })).toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Budget used' })).not.toBeInTheDocument();
      expect(screen.getByTestId('figures-hidden')).toHaveTextContent('1 figure hidden: spending could not be read');
    } finally {
      Object.assign(deliverySummaryState, priorDelivery, { isError: priorDeliveryError });
      projectMoneyState.data = priorMoney;
      projectMoneyState.isError = priorMoneyError;
    }
  });

  it('RF-011: an unassigned project is labelled, not rendered as a person avatar', () => {
    projectsState.data = [{ ...seed[0], project_manager_id: null, pm: null }] as unknown as ProjectWithRefs[];
    renderPage();
    const row = document.querySelector('tbody tr') as HTMLElement;
    expect(within(row).getByText('Unassigned')).toBeInTheDocument();
    expect(within(row).queryByRole('img')).not.toBeInTheDocument();
  });

  it('UX-020: near-complete delivery does not inherit a budget-risk danger threshold', () => {
    const previousDelivery = deliverySummaryState.p1;
    try {
      projectsState.data = [{ ...seed[0], status: 'Ongoing Project' }] as unknown as ProjectWithRefs[];
      deliverySummaryState.p1 = { deliveryPct: 95, committedSpend: 2_100_000, budget: 4_700_000 };
      renderPage();
      expect(screen.getByLabelText('Delivery 95%').querySelector('[data-testid="progress-fill"]')).toHaveClass('bg-primary');
    } finally {
      deliverySummaryState.p1 = previousDelivery;
    }
  });

  it('UX-020: completed delivery uses success styling rather than risk styling', () => {
    const previousDelivery = deliverySummaryState.p1;
    try {
      projectsState.data = [{ ...seed[0], status: 'Close Out' }] as unknown as ProjectWithRefs[];
      deliverySummaryState.p1 = { deliveryPct: 100, committedSpend: 2_100_000, budget: 4_700_000 };
      renderPage();
      expect(screen.getByLabelText('Delivery 100%').querySelector('[data-testid="progress-fill"]')).toHaveClass('bg-success');
    } finally {
      deliverySummaryState.p1 = previousDelivery;
    }
  });

  it('UX-019: project identity leads with name and customer; identifiers share one mono line with no disclosure', () => {
    projectsState.data = [{ ...seed[0], pmo_project_number: 'PMO-SYN-001', code: 'CLIENT-SYN-44', customer_contract_ref: 'CPO-SYN-9' }] as unknown as ProjectWithRefs[];
    renderPage();
    const row = document.querySelector('tbody tr') as HTMLElement;
    expect(within(row).getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(within(row).getByText('Innovate Corp')).toBeInTheDocument();
    expect(within(row).getByText('PMO-SYN-001 · CLIENT-SYN-44')).toBeVisible();
    expect(within(row).queryByLabelText(/More project references/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/CPO-SYN-9/)).not.toBeInTheDocument();
  });

  it('UX-018: one filter builder and transfer tools behind a labelled disclosure', () => {
    renderPage('Admin');
    expect(screen.getByRole('button', { name: /^Add filter$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^More actions/ })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: /status filter/i })).toBeVisible();
    expect(within(screen.getByTestId('list-page-header')).getByRole('tablist', { name: /projects view/i })).toBeVisible();
    expect(screen.getByPlaceholderText(/Search projects/i)).toBeVisible();
  });

  it('RF-013: status changes are absent from both the table action column and the project card (PL-B)', async () => {
    renderPage();
    expect(screen.queryByRole('columnheader', { name: /^Action$/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Cards/i }));
    expect(screen.queryByTestId('project-status-control')).not.toBeInTheDocument();
  });
});

describe('ProjectStatusControl integration (AC-1011 UI)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  it('AC-1011 (UI): the table keeps project identity concise; the Cards view carries no status control (PL-B: transitions live on the record)', async () => {
    projectsState.data = seedWithWon as unknown as ProjectWithRefs[];
    renderPage();
    expect(screen.queryByTestId('project-status-control')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Cards/i }));
    expect(screen.queryByTestId('project-status-control')).not.toBeInTheDocument();
    const wonCard = screen.getByText('Won Deal').closest<HTMLElement>('[data-testid="project-card"]')!;
    await userEvent.click(within(wonCard).getByText('More project references'));
    expect(within(wonCard).getByTitle('CPO-2026-999')).toBeVisible();
    projectsState.data = seed as unknown as ProjectWithRefs[];
  });

  it('AC-1011 (UI): the Cards view renders the contract ref on demand and no status control', async () => {
    projectsState.data = seedWithWon as unknown as ProjectWithRefs[];
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Cards/i }));
    expect(screen.getAllByTestId('project-card').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('project-status-control')).not.toBeInTheDocument();
    const wonCard = screen.getByText('Won Deal').closest<HTMLElement>('[data-testid="project-card"]')!;
    await userEvent.click(within(wonCard).getByText('More project references'));
    expect(within(wonCard).getByTitle('CPO-2026-999')).toBeVisible();
    projectsState.data = seed as unknown as ProjectWithRefs[];
  });
});

// ── New project create + RBAC gating (AC-PRJ-003 / AC-PRJ-007) ──────────────────
describe('Projects index — New project create + gating', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = seed as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
    roleBox.value = 'Project Manager';
    Object.values(projectMutations).forEach((m) => {
      m.mutateAsync.mockReset();
      m.mutateAsync.mockResolvedValue({ id: 'p9', name: 'New', status: 'Leads' });
      m.isPending = false;
    });
  });

  it('AC-PRJ-007: a delivery role (PM) sees the "New project" CTA', () => {
    renderPage('Project Manager');
    expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument();
  });

  it('AC-PRJ-007: Finance does NOT see "New project" (FE stricter than RLS — Finance owns money, not delivery)', () => {
    renderPage('Finance');
    expect(screen.queryByRole('button', { name: /new project/i })).not.toBeInTheDocument();
  });

  it('AC-PRJ-007: Engineer does NOT see "New project" (read-only index)', () => {
    renderPage('Engineer');
    expect(screen.queryByRole('button', { name: /new project/i })).not.toBeInTheDocument();
  });

  it('AC-PRJ-003: "New project" opens the one-step create page (no dialog), keeping this list as the return context', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /new project/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const probe = screen.getByTestId('location-probe');
    expect(probe).toHaveAttribute('data-pathname', '/projects/new');
    expect(JSON.parse(probe.getAttribute('data-state') ?? 'null')).toEqual(
      expect.objectContaining({ pmoListReturn: expect.objectContaining({ list: 'projects' }) }),
    );
    expect(projectMutations.create.mutateAsync).not.toHaveBeenCalled();
  });
});

// ── S-02: collection Actual is the same mapped ledger basis as Project finances ──
describe('Projects table — Actual uses the canonical collection money read (AC-S02-008)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = [{ ...seed[0], spent: 0 }] as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
    projectMoneyState.data = {
      p1: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '125000.00', asOf: '2026-10-01T00:00:00Z', excludesRestrictedRows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '125000.00' }] }, activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true,
        budgetPosition: canonicalPosition() },
    };
    projectMoneyState.isPending = false;
    projectMoneyState.isError = false;
  });

  afterEach(() => {
    projectsState.data = seed as unknown as ProjectWithRefs[];
    projectMoneyState.data = {};
    resetActiveLocale();
  });

  it('keeps an explicitly incomplete PMO position unknown in cards', () => {
    projectMoneyState.data = { p1: { ledgerBasis: 'pmo', actuals: { currency: 'USD', total: '950', asOf: null,
      excludesRestrictedRows: false, complete: false, categories: [] }, activeBudgetAmount: '1000', activeBudgetCurrency: 'USD', hasActiveBudget: true } };
    renderPage('Project Manager', '/projects?view=cards');
    expect(screen.getByTestId('project-card-actual')).toBeEmptyDOMElement();
    expect(screen.getByTestId('project-card-money-unavailable')).toBeInTheDocument();
    expect(screen.queryByLabelText('95% of Active budget before tax')).not.toBeInTheDocument();
  });

  it('keeps cached PMO figures unknown in cards and table after the project currency changes', async () => {
    projectMoneyState.data = { p1: { ledgerBasis: 'pmo', actuals: { currency: 'USD', total: '950', asOf: null,
      excludesRestrictedRows: false, complete: true, categories: [] }, activeBudgetAmount: '1000', activeBudgetCurrency: 'USD', hasActiveBudget: true,
      budgetPosition: canonicalPosition({ ledgerBasis: 'pmo', activeBudgetAmount: '1000', spent: '950', consumption: '950', usedRatio: '0.95', usedPercent: '95', consumptionVariance: '-50', atRisk: true }) } };
    renderPage('Project Manager', '/projects?view=cards');
    expect(screen.getByTestId('project-card-actual')).toHaveTextContent('$950');
    expect(screen.getByLabelText('95% of Active budget')).toBeInTheDocument();
    projectsState.data = [{ ...seed[0], currency: 'EUR' }] as unknown as ProjectWithRefs[];
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    expect(within(document.querySelector('tbody')!).queryByText('$950')).not.toBeInTheDocument();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('1 figure hidden: spending is not linked');
    await userEvent.click(screen.getByRole('tab', { name: /Cards/i }));
    expect(screen.getByTestId('project-card-actual')).toBeEmptyDOMElement();
    expect(screen.getByTestId('project-card-money-unavailable')).toBeInTheDocument();
    expect(screen.queryByLabelText('95% of Active budget before tax')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('project-card')).queryByText('At risk')).not.toBeInTheDocument();
  });

  it.each(['isError', 'isPending'] as const)('withholds cached card and table figures while money %s', async (state) => {
    projectMoneyState.data = { p1: { ledgerBasis: 'pmo', actuals: { currency: 'USD', total: '950', asOf: null,
      excludesRestrictedRows: false, complete: true, categories: [] }, activeBudgetAmount: '1000', activeBudgetCurrency: 'USD', hasActiveBudget: true } };
    renderPage('Project Manager', '/projects?view=cards');
    expect(screen.getByTestId('project-card-actual')).toHaveTextContent('$950');
    projectMoneyState[state] = true;
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    expect(within(document.querySelector('tbody')!).queryByText('$950')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Cards/i }));
    expect(screen.getByTestId('project-card-actual')).toBeEmptyDOMElement();
    expect(screen.getByTestId('project-card-active-budget')).toBeEmptyDOMElement();
    expect(screen.getByTestId('project-card-contract')).toHaveTextContent('$5,000,000');
    expect(screen.getByTestId('project-card-money-unavailable')).toBeInTheDocument();
    expect(screen.queryByLabelText('95% of Active budget before tax')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('project-card')).queryByText('At risk')).not.toBeInTheDocument();
    projectMoneyState[state] = false;
  });

  it('formats whole-unit Actual with the selected number locale rather than the translation language', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id', timezone: 'Asia/Jakarta' });
    renderPage();
    const body = document.querySelector('tbody')!;
    expect(within(body).getByText('US$125.000')).toBeInTheDocument();
  });

  it('explains an incomplete PMO currency position in the collection', () => {
    projectMoneyState.data = { p1: { ledgerBasis: 'pmo', actuals: { currency: 'USD', total: '125000', asOf: null,
      excludesRestrictedRows: false, complete: false, categories: [] }, activeBudgetAmount: '500000', activeBudgetCurrency: 'USD', hasActiveBudget: true } };
    renderPage();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('1 figure hidden: spending is not linked');
    expect(screen.queryByText('25%')).not.toBeInTheDocument();
  });

  it('does not relabel a cached PMO position in another currency', () => {
    projectMoneyState.data = { p1: { ledgerBasis: 'pmo', actuals: { currency: 'EUR', total: '125000', asOf: null,
      excludesRestrictedRows: false, complete: true, categories: [] }, activeBudgetAmount: '500000', activeBudgetCurrency: 'USD', hasActiveBudget: true } };
    renderPage();
    expect(within(document.querySelector('tbody')!).queryByText('$125,000')).not.toBeInTheDocument();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('1 figure hidden: spending is not linked');
  });

  it('AC-S02-008: displays canonical Actual, freshness and Active-budget utilization instead of committedSpend', () => {
    renderPage();
    expect(screen.getByRole('columnheader', { name: 'Actual' })).toBeInTheDocument();
    const body = document.querySelector('tbody')!;
    expect(within(body).getByText('$125,000')).toBeInTheDocument();
    const actualHeaderIndex = [...document.querySelectorAll('thead th')].findIndex((header) => header.textContent === 'Actual');
    const actualCell = body.querySelector('tr')!.cells[actualHeaderIndex];
    expect(actualCell.textContent).toContain('$125,000');
    // PL-A: the cell is the amount only — source and freshness are not repeated per row.
    expect(actualCell.querySelector('[title]')).toBeNull();
    expect(actualCell.textContent).not.toMatch(/ERP actual|Updated/);
    expect(within(body).queryByText('$2,100,000')).not.toBeInTheDocument();
    expect(within(body).getByLabelText(/25% of Active budget before tax/)).toBeInTheDocument();
  });

  it('#2060: the table shows the SAME Actual the cards show, on the collection read both views trust', async () => {
    // The live shape: the server's coverage verdict (over the ACTIVE BUDGET's categories) is
    // `complete`, while `actuals.categories` carries the whole budget_category enum — including
    // categories this org never mapped. The card read that verdict; the table re-derived coverage
    // from the enum and blanked every row. Same source in, same figure out.
    projectMoneyState.data = {
      p1: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '7200000.00', asOf: '2026-10-01T00:00:00Z',
        excludesRestrictedRows: false, complete: true,
        categories: [
          { category: 'Labor', mapped: true, amount: '7200000.00' },
          { category: 'Overheads', mapped: false, amount: null },
        ] }, activeBudgetAmount: '6900000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
    };
    renderPage('Project Manager', '/projects?view=cards');
    const expected = formatExactMoney('7200000.00', 'USD', getNumberLocale(), { wholeUnits: true });
    expect(screen.getByTestId('project-card-actual')).toHaveTextContent(expected!);
    const cardFigure = screen.getByTestId('project-card-actual').textContent;

    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    const body = document.querySelector('tbody')!;
    // `*` marks a column that carries the table-level caveat (#2060's partial/unknown note).
    const actualHeaderIndex = [...document.querySelectorAll('thead th')].findIndex((header) => header.textContent?.startsWith('Actual'));
    const actualCell = body.querySelector('tr')!.cells[actualHeaderIndex];
    expect(actualCell.textContent).toBe(cardFigure);
    expect(actualCell).toHaveTextContent('$7,200,000');
  });

  it('a role whose money read never runs (idle query) gets no endless placeholder and no money columns', () => {
    const prior = { data: projectMoneyState.data, isPending: projectMoneyState.isPending, fetchStatus: projectMoneyState.fetchStatus };
    projectMoneyState.data = undefined;
    projectMoneyState.isPending = true;
    projectMoneyState.fetchStatus = 'idle';
    try {
      renderPage();
      expect(screen.queryByRole('columnheader', { name: 'Actual' })).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Budget used' })).not.toBeInTheDocument();
      expect(within(document.querySelector('tbody')!).queryByText('…')).not.toBeInTheDocument();
      expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
    } finally {
      Object.assign(projectMoneyState, prior);
    }
  });

  it('#2060: an unknown Actual is an em dash when other rows have one, and the column is dropped when none does', () => {
    const unknown = { ledgerBasis: 'erp' as const, actuals: { currency: 'USD', total: '7200000.00', asOf: '2026-10-01T00:00:00Z',
      excludesRestrictedRows: false, complete: false, categories: [{ category: 'Labor', mapped: false, amount: null }] },
    activeBudgetAmount: '6900000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true };
    projectMoneyState.data = { p1: unknown };
    const { unmount } = renderPage();
    // Blank on every row: no Actual column, one page-level line says why.
    expect(screen.queryByRole('columnheader', { name: /Actual/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('1 figure hidden: spending is not linked');
    unmount();
    projectMoneyState.data = {
      p1: unknown,
      p2: { ledgerBasis: 'pmo', actuals: { currency: 'USD', total: '125000.00', asOf: null, excludesRestrictedRows: false, categories: [] },
        activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
    };
    projectsState.data = [seed[0], seed[1]] as unknown as ProjectWithRefs[];
    renderPage();
    const actualHeaderIndex = [...document.querySelectorAll('thead th')].findIndex((header) => header.textContent?.startsWith('Actual'));
    expect(document.querySelector('tbody')!.querySelector('tr')!.cells[actualHeaderIndex].textContent?.trim()).toBe('—');
  });

  it('AC-S02: shows a committed PMO Actual as the plain amount, with no per-row source label', () => {
    projectMoneyState.data = {
      p1: { ledgerBasis: 'pmo', actuals: { currency: 'USD', total: '125000.00', asOf: null, excludesRestrictedRows: false, categories: [] }, activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
    };
    renderPage();
    const body = document.querySelector('tbody')!;
    const actualHeaderIndex = [...document.querySelectorAll('thead th')].findIndex((header) => header.textContent === 'Actual');
    const actualCell = body.querySelector('tr')!.cells[actualHeaderIndex];
    expect(actualCell.querySelector('[title]')).toBeNull();
    expect(actualCell.textContent).toBe('$125,000');
  });

  it('AC-S02-009: unknown Actual and missing Active budget stay unavailable, never zero or at risk', async () => {
    projectMoneyState.data = {
      p1: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: null, asOf: null, excludesRestrictedRows: false,
        categories: [{ category: 'Labor', mapped: false, amount: null }] }, activeBudgetAmount: null, activeBudgetCurrency: null, hasActiveBudget: false },
      // another project has an Active budget, so the Budget used column exists to show p1's missing one
      p2: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '100.00', asOf: null, excludesRestrictedRows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '100.00' }] }, activeBudgetAmount: '1000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
    };
    projectsState.data = [{ ...seed[0], spent: 0 }, { ...seed[1], spent: 0 }] as unknown as ProjectWithRefs[];
    renderPage();
    const body = document.querySelector('tbody')!;
    const actualHeaderIndex = [...document.querySelectorAll('thead th')].findIndex((header) => header.textContent?.includes('Actual'));
    const budgetHeaderIndex = [...document.querySelectorAll('thead th')].findIndex((header) => header.textContent?.includes('Budget used'));
    const row = body.querySelector('tr')!;
    // #2060: an unknown Actual is the em dash (with the table note), never a blank cell.
    expect(row.cells[actualHeaderIndex]).toHaveTextContent('—');
    expect(row.cells[actualHeaderIndex].querySelector('[title]')).toBeNull();
    expect(row.cells[budgetHeaderIndex]).toHaveTextContent('—');
    expect(row.cells[budgetHeaderIndex]).not.toHaveTextContent('No active budget');
    expect(row.cells[budgetHeaderIndex].querySelector('[title]')).toBeNull();
    // Keep the absence reason once at page level while the cell stays a concise em dash.
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('No active budget');
    expect(within(body).queryByText('At risk')).not.toBeInTheDocument();
    expect(within(body).queryByText('$0')).not.toBeInTheDocument();
  });

  it('AC-MONEY-DISPLAY: a failed collection read drops the money columns and explains once', () => {
    projectMoneyState.data = {};
    projectMoneyState.isError = true;
    renderPage();
    const body = document.querySelector('tbody')!;
    expect(screen.queryByRole('columnheader', { name: /Actual/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Budget used/ })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('figures-hidden')).toHaveLength(1);
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('spending could not be read');
    expect(within(body).queryByText('Unavailable')).not.toBeInTheDocument();
  });

  it('AC-S02-012: known zero Actual is distinct from unavailable and uses the Active-budget denominator', () => {
    projectMoneyState.data = {
      p1: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '0.00', asOf: '2026-10-01T00:00:00Z', excludesRestrictedRows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '0.00' }] }, activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true,
        budgetPosition: canonicalPosition({ spent: '0.00', consumption: '0.00', usedRatio: '0', usedPercent: '0', consumptionVariance: '-500000.00' }) },
    };
    renderPage();
    const body = document.querySelector('tbody')!;
    expect(within(body).getByText('$0')).toBeInTheDocument();
    expect(within(body).queryByText('Unavailable')).not.toBeInTheDocument();
    expect(within(body).getByLabelText(/0% of Active budget before tax/)).toBeInTheDocument();
  });

  it('AC-S02: at-risk filtering shows loading and retryable error states instead of claiming nothing is at risk', async () => {
    projectMoneyState.isPending = true;
    const { unmount } = renderPage('Project Manager', '/projects?filter=at-risk');
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(screen.queryByText('Nothing at risk')).not.toBeInTheDocument();
    unmount();

    projectMoneyState.isPending = false;
    projectMoneyState.isError = true;
    const { unmount: unmountError } = renderPage('Project Manager', '/projects?filter=at-risk');
    expect(screen.getByText("Couldn't check project budget risk")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(projectMoneyState.refetch).toHaveBeenCalled();
    unmountError();
    projectMoneyState.isError = false;
  });

  it('AC-S02: partial and restricted Actual do not drive budget utilization or at-risk filtering', () => {
    for (const actuals of [
      { currency: 'USD', total: '450000.00', asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '450000.00' }, { category: 'Materials', mapped: false, amount: null }] },
      { currency: 'USD', total: '450000.00', asOf: null, excludesRestrictedRows: true, categories: [{ category: 'Labor', mapped: true, amount: '450000.00' }] },
    ]) {
      projectMoneyState.data = { p1: { ledgerBasis: 'erp', actuals, activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true } };
      const { unmount } = renderPage('Project Manager', '/projects?filter=at-risk');
      expect(screen.queryByText('Innovate Corp HQ Fit-Out')).not.toBeInTheDocument();
      unmount();
      const { unmount: unmountAll } = renderPage();
      const body = document.querySelector('tbody')!;
      expect(within(body).queryByLabelText(/90% of Active budget before tax/i)).not.toBeInTheDocument();
      const actualHeaderIndex = [...document.querySelectorAll('thead th')].findIndex((header) => header.textContent?.startsWith('Actual'));
      expect(body.textContent).not.toContain('$450,000');
      if (actuals.excludesRestrictedRows) {
        // Restricted rows have a row-level cause, so the tag stays.
        expect(body.querySelector('tr')!.cells[actualHeaderIndex]).toHaveTextContent('Restricted excluded');
      } else {
        // Withheld on every row: the column is dropped, the page-level line says why.
        expect(actualHeaderIndex).toBe(-1);
      }
      unmountAll();
    }
  });

  it('AC-S02: a known zero Active budget is an em dash with its reason on the hidden-figures line', () => {
    projectMoneyState.data = {
      p1: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '0.00', asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '0.00' }] }, activeBudgetAmount: '0.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
    };
    renderPage();
    const body = document.querySelector('tbody')!;
    const budgetHeaderIndex = [...document.querySelectorAll('thead th')].findIndex((header) => header.textContent?.includes('Budget used'));
    expect(body.querySelector('tr')!.cells[budgetHeaderIndex]).toHaveTextContent('—');
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('$0 Active budget; usage unavailable');
    expect(within(body).queryByText('No active budget')).not.toBeInTheDocument();
  });

  it('AC-S02-013: only mapped Actual at or above 90% of a same-currency Active budget is at risk', () => {
    projectMoneyState.data = {
      p1: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '450000.00', asOf: '2026-10-01T00:00:00Z', excludesRestrictedRows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '450000.00' }] }, activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true,
        budgetPosition: canonicalPosition({ spent: '450000.00', consumption: '450000.00', usedRatio: '0.9', usedPercent: '90', consumptionVariance: '-50000.00', atRisk: true }) },
    };
    renderPage();
    const utilization = screen.getByLabelText(/90% of Active budget before tax/);
    expect(utilization).toBeInTheDocument();
    const row = utilization.closest('tr')!;
    expect(within(row).getAllByText(/^At risk$/i)).toHaveLength(1);
    expect(within(row).getByText(/^At risk$/i)).toBeInTheDocument();
    expect(utilization.querySelector('[data-testid="progress-fill"]')).toHaveClass('bg-destructive');
  });

  it('AC-S02: does not classify cross-currency Actual and Active budget as at risk', () => {
    projectMoneyState.data = {
      p1: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '450000.00', asOf: '2026-10-01T00:00:00Z', excludesRestrictedRows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '450000.00' }] }, activeBudgetAmount: '500000.00', activeBudgetCurrency: 'EUR', hasActiveBudget: true },
    };
    renderPage('Project Manager', '/projects?filter=at-risk');
    expect(screen.getByText('Nothing at risk')).toBeInTheDocument();
    expect(screen.queryByText('Innovate Corp HQ Fit-Out')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// #548 / OD-TAX-1 §2 — the Contract column states each row's basis
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('#548 (OD-TAX-1): the Contract column carries each project’s tax basis', () => {
  // ⚑ MIXED ON PURPOSE. The list is exactly where a government/SOE contract quoted INCLUSIVE sits
  // one row above a commercial one quoted EXCLUSIVE — a column of bare numbers there reads as
  // comparable when it is not. A single-treatment fixture could not tell the label apart from a
  // hardcoded string (the DD-CUR-6 / #529 blind spot).
  const mixed = [
    { ...seed[0], tax_treatment: 'inclusive', tax_amount: 495000 },
    { ...seed[1], tax_treatment: 'exclusive', tax_amount: 132000 },
    { ...seed[2], contract_value: 0, tax_treatment: null, tax_amount: null },
  ];

  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = mixed as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  it('#548: each stated contract renders its OWN basis, and the unstated one renders none', () => {
    renderPage();
    const labels = screen.getAllByTestId('tax-basis');
    // Two projects state a basis; the third states none, so it gets no label at all.
    expect(labels.map((l) => l.getAttribute('data-tax-basis'))).toEqual(['inclusive', 'exclusive']);
    expect(labels[0]).toHaveTextContent('incl. PPN');
    expect(labels[1]).toHaveTextContent('excl. PPN');
    const contractColumn = [...document.querySelectorAll('thead th')].findIndex((header) => header.textContent?.includes('Contract'));
    const missingContractRow = [...document.querySelectorAll('tbody tr')].find((row) => row.textContent?.includes('Regional Services Program'))!;
    expect(missingContractRow.cells[contractColumn]).toHaveTextContent('—');
    expect(missingContractRow.cells[contractColumn]).not.toHaveTextContent('$0');
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('Contract value is not recorded');
  });

  it('AC-S02: a recorded zero contract value remains a visible zero', () => {
    projectsState.data = [{
      ...seed[0], contract_value: 0, contract_value_set_by: 'u-alice', contract_value_set_at: '2026-10-01T00:00:00Z',
    }] as unknown as ProjectWithRefs[];
    renderPage();
    const contractColumn = [...document.querySelectorAll('thead th')].findIndex((header) => header.textContent?.includes('Contract'));
    expect(document.querySelector('tbody tr')!.cells[contractColumn]).toHaveTextContent('$0');
  });
});

// list-working-set-return (#682): AC-LRC-001/002 for Projects — `filter`/`client`/`pm`/`q`/`view`
// are URL-owned. The owning pure-codec proof lives in src/lib/listWorkingSet.test.ts; here we prove
// the component renders the URL-backed working set and writes ONE replace per event.
describe('Projects list working set — AC-LRC-001/002', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = seed as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  const renderAt = (path: string, role = 'Project Manager') => {
    roleBox.value = role;
    return render(
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <ToastProvider>
          <Projects />
        </ToastProvider>
      </MemoryRouter>,
    );
  };

  it('AC-LRC-001: renders the URL-backed working set (filter + search + view) and refresh/copy reproduces it', () => {
    // p1 ("Innovate Corp HQ Fit-Out") is the only seed row that is BOTH Ongoing and matches the
    // search text, so it is the row that must render as a card under this combined URL state.
    renderAt('/projects?filter=Ongoing&q=Innovate&view=cards');
    // The URL-driven filter segment is selected.
    const statusTabs = screen.getByRole('tablist', { name: /status filter/i });
    expect(within(statusTabs).getByRole('tab', { name: /^Ongoing$/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The URL-driven search is present in the search box.
    expect(screen.getByPlaceholderText(/Search projects/i)).toHaveValue('Innovate');
    // The URL-driven view renders card carriers.
    expect(screen.getAllByTestId('project-card').length).toBeGreaterThan(0);
    // Re-rendering from the same URL (a refresh / copied link) reproduces the same controls.
    cleanup();
    renderAt('/projects?filter=Ongoing&q=Innovate&view=cards');
    expect(within(screen.getByRole('tablist', { name: /status filter/i })).getByRole('tab', { name: /^Ongoing$/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('AC-LRC-001: a control change writes ONE replace of the list URL (no history entry per click)', async () => {
    renderAt('/projects');
    const probe = screen.getByTestId('location-probe');
    await userEvent.click(screen.getByRole('tab', { name: /^Ongoing$/ }));
    expect(probe.dataset.search).toBe('?filter=Ongoing');
    // View change persists AND writes the URL in one event (kanban renders, the status filter
    // set moments earlier survives untouched — it is not a keystroke this event should drop).
    await userEvent.click(screen.getByRole('tab', { name: /Board/i }));
    expect(probe.dataset.search).toBe('?filter=Ongoing&view=kanban');
    expect(screen.getByTestId('project-kanban-board')).toBeInTheDocument();
    expect(sessionStorage.getItem('pmo.workspace.views')).toContain('kanban');
  });

  it('AC-LRC-002 (#683 carry-over): an Engineer default ?filter=My+Projects survives typing a search', async () => {
    renderAt('/projects?filter=My+Projects', 'Engineer');
    const probe = screen.getByTestId('location-probe');
    await userEvent.type(screen.getByPlaceholderText(/Search projects/i), 'Northwind');
    await waitFor(() => expect(probe.dataset.search).toContain('q=Northwind'));
    // The explicit default-valued filter key survives the search write (not widened to All).
    expect(probe.dataset.search).toContain('filter=My+Projects');
  });

  it('AC-LRC-002: a dashboard ?filter= drill link keeps its intended subset selected on later control changes', async () => {
    renderAt('/projects?filter=my+projects', 'Engineer');
    const statusTabs = screen.getByRole('tablist', { name: /status filter/i });
    // The dashboard drill lands on "My Projects" for an Engineer, and it stays the effective
    // filter (an inch-scrollable source) even after an unrelated URL edit is written.
    expect(within(statusTabs).getByRole('tab', { name: /My Projects/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('filter round-trips through the URL (R2-c2b)', async () => {
    renderAt('/projects?filter=Ongoing');
    const statusTabs = screen.getByRole('tablist', { name: /status filter/i });
    expect(within(statusTabs).getByRole('tab', { name: /^Ongoing$/ })).toHaveAttribute('aria-selected', 'true');

    const probe = screen.getByTestId('location-probe');
    await userEvent.click(within(statusTabs).getByRole('tab', { name: /^Completed$/ }));
    await waitFor(() => expect(probe.dataset.search).toBe('?filter=Completed'));
  });
});

describe('#758 — End customer column + filter on the Projects list (AC-EC-003)', () => {
  // UUIDs: the URL working set only accepts a reference value that parses as a UUID.
  const END_A = '9c9c9c9c-0000-4000-8000-0000000000a1';
  const END_B = '9c9c9c9c-0000-4000-8000-0000000000b2';
  const withEnd = [
    { ...seed[0], end_client_id: END_A, end_client: { name: 'Asset Owner Alpha' } },
    { ...seed[1], end_client_id: END_B, end_client: { name: 'Site Owner Beta' } },
    { ...seed[2], end_client_id: null, end_client: null },
  ];

  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = withEnd as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
    companiesState.data = [
      { id: END_A, name: 'Asset Owner Alpha', type: 'Client' },
      { id: END_B, name: 'Site Owner Beta', type: 'Vendor' },
    ];
  });
  afterEach(() => {
    companiesState.data = [];
  });

  it('AC-EC-003: each project’s end customer shows once on its project cell, with no End customer column', () => {
    renderPage();
    expect(screen.queryByRole('columnheader', { name: /^End customer$/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('Asset Owner Alpha')).toHaveLength(1);
    expect(screen.getAllByText('Site Owner Beta')).toHaveLength(1);
  });

  it('RF-012: end-customer choices come from project associations, not unrelated companies', async () => {
    companiesState.data = [
      ...companiesState.data,
      { id: '9c9c9c9c-0000-4000-8000-0000000000c3', name: 'Unrelated Supplier', type: 'Vendor' },
    ];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Add filter$/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'End customer' }));
    await userEvent.click(await screen.findByRole('option', { name: 'is' }));
    expect(await screen.findByRole('option', { name: 'Asset Owner Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Unrelated Supplier' })).not.toBeInTheDocument();
  });

  it('RF-009: no optional-columns control exists, with rows or when filters leave none', async () => {
    projectsState.data = seed as unknown as ProjectWithRefs[];
    renderPage();
    expect(screen.queryByRole('button', { name: /optional columns|hide empty columns/i })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: /search projects/i }), 'no matching project');
    expect(screen.getByText('No projects match these filters')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /optional columns|hide empty columns/i })).not.toBeInTheDocument();
  });

  it('RF-009: no optional-columns control exists when no projects exist', () => {
    projectsState.data = [] as unknown as ProjectWithRefs[];
    renderPage();
    expect(screen.getByText('No projects yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /optional columns/i })).not.toBeInTheDocument();
  });

  it('UX-021: columns with no data are omitted, with no restore control to click', () => {
    projectsState.data = withEnd.map((project) => ({ ...project, end_client_id: null, end_client: null })) as unknown as ProjectWithRefs[];
    renderPage();
    expect(screen.queryByRole('columnheader', { name: /end customer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^Budget used$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /optional columns/i })).not.toBeInTheDocument();
  });

  it('AC-EC-003: ?endClient=<id> narrows the list to that end customer’s projects', () => {
    renderPage('Project Manager', `/projects?filter=All&endClient=${END_B}`);
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.queryByText('Innovate Corp HQ Fit-Out')).not.toBeInTheDocument();
    expect(screen.queryByText('Regional Services Program')).not.toBeInTheDocument();
  });

  it('AC-EC-003: choosing an end customer in the filter narrows the rows and writes endClient to the URL', async () => {
    renderPage('Project Manager', '/projects?filter=All');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Add filter$/ }));
    await user.click(await screen.findByRole('option', { name: 'End customer' }));
    await user.click(await screen.findByRole('option', { name: 'is' }));
    // Includes linked end customers regardless of company type (Site Owner Beta is a Vendor).
    expect(await screen.findByRole('option', { name: 'Site Owner Beta' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Asset Owner Alpha' }));
    expect(screen.getByTestId('location-probe').dataset.search).toContain(`endClient=${END_A}`);
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.queryByText('Northwind ERP Rollout')).not.toBeInTheDocument();
    expect(screen.queryByText('Regional Services Program')).not.toBeInTheDocument();
  });
});

it('AC-TAG-002 Projects intersects classification controls, preserves URL and clears the actual result', async () => {
  projectsState.data = seed.map((p, i) => ({ ...p, service_line: i === 0 ? 'Engineering' : 'Advisory', sector: 'Energy', location: 'West Java', award_type: 'tender', bidding_entity: 'alone' })) as unknown as ProjectWithRefs[];
  const user = userEvent.setup(); renderPage('Project Manager', '/projects?view=table');
  await addBuilderFilter(user, 'Service line', { value: 'Engineering' });
  expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();
  expect(screen.queryByText('Northwind ERP Rollout')).toBeNull();
  expect(screen.getByTestId('location-probe').getAttribute('data-search')).toContain('serviceLine=Engineering');
  await removeBuilderFilter(user, 'Service line');
  expect(await screen.findByText('Northwind ERP Rollout')).toBeVisible();
});

it('AC-TAG-002 Engineer classification filters remain available without manager-only customer controls', async () => {
  projectsState.data = seed.map((p) => ({ ...p, service_line: 'Engineering' })) as unknown as ProjectWithRefs[];
  renderPage('Engineer', '/projects?filter=All&view=table');
  await userEvent.click(screen.getByRole('button', { name: /^Add filter$/ }));
  expect(await screen.findByRole('option', { name: 'Service line' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Customer' })).toBeNull();
});

it('AC-PRJ-FINDINGS: each finding clause filters the current project list', async () => {
  const findingsSeed = [
    { ...seed[0], id: 'risk', name: 'At risk project', end_date: '2030-12-31' },
    { ...seed[0], id: 'over', name: 'Over budget project', end_date: '2030-12-31' },
    { ...seed[0], id: 'late', name: 'Late project', end_date: '2000-01-01' },
    { ...seed[0], id: 'safe', name: 'Healthy project', end_date: '2030-12-31' },
  ];
  projectsState.data = findingsSeed as unknown as ProjectWithRefs[];
  projectMoneyState.data = {
    risk: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '950.00', asOf: null, excludesRestrictedRows: false, categories: [] }, activeBudgetAmount: '1000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true,
      budgetPosition: canonicalPosition({ projectId: 'risk', activeBudgetAmount: '1000.00', spent: '950.00', consumption: '950.00', usedPercent: '95', consumptionVariance: '-50.00', atRisk: true }) },
    over: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '1200.00', asOf: null, excludesRestrictedRows: false, categories: [] }, activeBudgetAmount: '1000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true,
      budgetPosition: canonicalPosition({ projectId: 'over', activeBudgetAmount: '1000.00', spent: '1200.00', consumption: '1200.00', usedPercent: '120', consumptionVariance: '200.00', atRisk: false }) },
  };
  projectMoneyState.isPending = false;
  projectMoneyState.isError = false;
  const user = userEvent.setup();
  renderPage('Project Manager', '/projects?filter=All');

  await user.click(await screen.findByRole('button', { name: '1 of 4 at risk' }));
  expect(screen.getByText('At risk project')).toBeInTheDocument();
  expect(screen.queryByText('Over budget project')).not.toBeInTheDocument();
  expect(screen.getByTestId('location-probe').dataset.search).toContain('finding=at-risk');

  await user.click(screen.getByRole('button', { name: '1 over budget' }));
  expect(screen.getByText('Over budget project')).toBeInTheDocument();
  expect(screen.queryByText('At risk project')).not.toBeInTheDocument();
  expect(screen.getByTestId('location-probe').dataset.search).toContain('finding=over-budget');

  await user.click(screen.getByRole('button', { name: '1 late' }));
  expect(screen.getByText('Late project')).toBeInTheDocument();
  expect(screen.queryByText('Healthy project')).not.toBeInTheDocument();
  expect(screen.getByTestId('location-probe').dataset.search).toContain('finding=late');

  projectMoneyState.data = {};
});
