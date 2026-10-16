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
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import { AppError } from '@/src/lib/appError';
import Projects from './Projects';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

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
const { roleBox, projectMutations, deliverySummaryState, projectMoneyState } = vi.hoisted(() => ({
  roleBox: { value: 'Project Manager' },
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
    data: {} as Record<string, { ledgerBasis?: 'erp' | 'pmo'; actuals: { currency: string; total: string | null; asOf: string | null; excludesRestrictedRows: boolean; categories: { category: string; mapped: boolean; amount: string | null }[] }; activeBudgetAmount: string | null; activeBudgetCurrency: string | null; hasActiveBudget: boolean }> | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));
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
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: roleBox.value }),
}));
// B-11 fix: Projects now reads the caller's tasks to scope an Engineer's "My Projects".
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => ({ data: deliverySummaryState, isError: deliverySummaryState.isError, isPending: false }),
}));
vi.mock('@/src/hooks/useProjectsMoneyCollection', () => ({ useProjectsMoneyCollection: () => projectMoneyState }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: roleBox.value, realRole: roleBox.value, canImpersonate: false, viewAs: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
  usePipelineStageConfig: () => ({ data: [], isSuccess: true }),
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
const renderPage = (role = 'Project Manager', initialPath = '/projects') => {
  roleBox.value = role;
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <ToastProvider>
        <Projects />
      </ToastProvider>
    </MemoryRouter>,
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
    // the view-switcher is right-aligned (filter-vs-view trap)
    expect(screen.getByTestId('list-page-view')).toBeInTheDocument();
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
      const pmo = screen.getByTitle('PMO-26-0042');
      expect(pmo).toHaveTextContent(/^PMO-26-0042$/);
      await userEvent.click(screen.getByText('More project references'));
      expect(screen.getByTitle('CLIENT-77')).toBeInTheDocument();
      expect(within(pmo.parentElement as HTMLElement).getByText('PMO Project Number:')).toHaveClass('sr-only');
    } finally {
      projectsState.data = prev;
    }
  });

  it('renders seeded projects with joined client + PM names (AC-401)', () => {
    renderPage();
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getAllByText('Innovate Corp').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'Alice Manager' }).length).toBeGreaterThan(0);
  });

  it('keeps contract basis concise while exposing the complete qualifier to assistive technology', () => {
    const previous = projectsState.data;
    projectsState.data = [{
      ...seed[0], tax_treatment: 'exclusive', tax_rate: 11,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }] as unknown as ProjectWithRefs[];
    try {
      renderPage();
      const visibleBasis = screen.getByText('excl. PPN');
      expect(visibleBasis).toBeVisible();
      expect(visibleBasis).toHaveClass('whitespace-normal', 'break-words', 'max-w-full');
      expect(visibleBasis).not.toHaveClass('whitespace-nowrap');
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

  it('renders status as a StatusPill (dot + text), not a legacy badge (AC-C)', () => {
    renderPage();
    const pill = screen.getAllByText('Ongoing Project')[0];
    // The StatusPill carries a 6px dot sibling (color-not-only).
    expect(pill.querySelector('[data-pill-dot]')).not.toBeNull();
  });

  it('CW-7: a zero/missing-budget project renders an em-dash, never literal NaN% or $NaN', () => {
    // Seed p2/p3 carry budget 0 (zero-divide) — the budget-used cell must guard the math.
    renderPage();
    // No NaN leaks anywhere on the rendered index.
    expect(document.body.textContent).not.toMatch(/NaN/);
    // The zero-budget rows fall back to a muted em-dash in the Budget used column.
    expect(screen.getByRole('button', { name: /show optional columns/i })).toBeInTheDocument();
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

describe('Projects table — compact layout (#1)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = seed as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  it('#1: PM column avatar is 18px (compact) — not 22px — to fit at 1180px', () => {
    renderPage();
    const tableBody = document.querySelector('tbody')!;
    const pmAvatar = within(tableBody as HTMLElement).getAllByRole('img', { name: 'Alice Manager' })[0];
    expect(pmAvatar).toHaveClass('rounded-full', 'size-[18px]');
  });

  it('#1: Progress column cell uses compact ProgressBar (min-w-[80px] wrapper) to fit narrow columns', () => {
    renderPage();
    // The progressbar role should be in the table and have a compact constrained wrapper
    const progressbars = screen.getAllByRole('progressbar');
    expect(progressbars.length).toBeGreaterThan(0);
    // The outer wrapper span should have min-w-[80px] (compact mode)
    const bar = progressbars[0];
    expect(bar).toHaveAttribute('aria-label', 'Delivery 50%');
    expect(screen.getByText('50%')).toBeInTheDocument();
    const wrapper = bar.closest('span')?.parentElement;
    expect(wrapper).toBeTruthy();
    // The outermost span container should use compact sizing (min-w-[80px])
    const outerSpan = bar.closest('span[class*="min-w-[80px]"]') ??
      bar.parentElement?.closest('span[class*="min-w-[80px]"]');
    expect(outerSpan).not.toBeNull();
  });

  it('M-D: PM initials are visible while the full name remains accessible', () => {
    renderPage();
    const tbody = document.querySelector('tbody')!;
    const avatar = within(tbody as HTMLElement).getAllByRole('img', { name: 'Alice Manager' })[0];
    expect(avatar).toHaveTextContent('AM');
    expect(avatar).toHaveAttribute('title', 'Alice Manager');
    expect(within(tbody as HTMLElement).queryByText('Alice Manager')).not.toBeInTheDocument();
  });

  it('RF-009: failed summary reads keep optional columns visible for unavailable-state recovery', () => {
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
      expect(screen.getByRole('columnheader', { name: 'Budget used' })).toBeInTheDocument();
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

  it('UX-020: completed delivery uses success styling rather than risk styling', () => {
    projectsState.data = [{ ...seed[0], status: 'Close Out' }] as unknown as ProjectWithRefs[];
    deliverySummaryState.p1 = { deliveryPct: 100, committedSpend: 2_100_000, budget: 4_700_000 };
    renderPage();
    expect(screen.getByLabelText('Delivery 100%').querySelector('[data-testid="progress-fill"]')).toHaveClass('bg-success');
  });

  it('UX-019: project identity leads with name and customer while secondary references are disclosed', async () => {
    projectsState.data = [{ ...seed[0], pmo_project_number: 'PMO-SYN-001', code: 'CLIENT-SYN-44', customer_contract_ref: 'CPO-SYN-9' }] as unknown as ProjectWithRefs[];
    renderPage();
    const row = document.querySelector('tbody tr') as HTMLElement;
    expect(within(row).getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(within(row).getByText('Innovate Corp')).toBeInTheDocument();
    expect(within(row).getByText('PMO-SYN-001')).toBeInTheDocument();
    expect(within(row).getByTitle('CLIENT-SYN-44')).not.toBeVisible();
    await userEvent.click(within(row).getByText('More project references'));
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-pathname', '/projects');
    expect(within(row).getByTitle('CLIENT-SYN-44')).toBeVisible();
  });

  it('UX-018: secondary filters and transfer tools are grouped behind labelled disclosures', () => {
    renderPage('Admin');
    expect(screen.getByRole('button', { name: /^Filters/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^More actions/ })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: /status filter/i })).toBeVisible();
    expect(screen.getByTestId('list-page-view')).toBeVisible();
    expect(screen.getByPlaceholderText(/Search projects/i)).toBeVisible();
  });

  it('RF-013: status changes remain available from the project card while absent from the table action column', async () => {
    renderPage();
    expect(screen.queryByRole('columnheader', { name: /^Action$/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Cards/i }));
    expect(screen.getAllByTestId('project-status-control').length).toBeGreaterThan(0);
  });
});

describe('ProjectStatusControl integration (AC-1011 UI)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  it('AC-1011 (UI): the table keeps project identity concise and status transitions available in the Cards view', async () => {
    projectsState.data = seedWithWon as unknown as ProjectWithRefs[];
    renderPage();
    expect(screen.queryByTestId('project-status-control')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Cards/i }));
    expect(screen.getAllByTestId('project-status-control').length).toBeGreaterThanOrEqual(1);
    const wonCard = screen.getByText('Won Deal').closest<HTMLElement>('[data-testid="project-card"]')!;
    await userEvent.click(within(wonCard).getByText('More project references'));
    expect(within(wonCard).getByTitle('CPO-2026-999')).toBeVisible();
    projectsState.data = seed as unknown as ProjectWithRefs[];
  });

  it('AC-1011 (UI): the Cards view also renders the status control + ref (win flow reachable from both views)', async () => {
    projectsState.data = seedWithWon as unknown as ProjectWithRefs[];
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Cards/i }));
    expect(screen.getAllByTestId('project-card').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('project-status-control').length).toBeGreaterThanOrEqual(1);
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

  it('AC-PRJ-003: "New project" opens the create modal; blank required name + client keep submit disabled (F8 readiness)', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /new project/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // F8 (AC-IXD-FORM-F8): the blank required name + client disable submit, so the user
    // cannot silently submit a blank project and no create mutation fires.
    const submit = screen.getByRole('button', { name: /^Create project$/i });
    expect(submit).toBeDisabled();
    await userEvent.click(submit);
    expect(projectMutations.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-PRJ-003: a valid create submits name/status/client/PM/value to the mutation (origination = Leads)', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /new project/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/project name/i), 'Harborside Terminal');
    // Client company is a Combobox FK picker — open, search, select.
    await userEvent.click(within(dialog).getByRole('combobox', { name: /client company/i }));
    const listbox = await screen.findByRole('listbox', { name: /compan/i });
    await userEvent.click(within(listbox).getByRole('option', { name: /Innovate Corp/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: /^Create project$/i }));
    await waitFor(() =>
      expect(projectMutations.create.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Harborside Terminal',
          status: 'Leads',
          client_id: 'c2',
        }),
      ),
    );
  });

  it('AC-PRJ-003: the origination select offers only Leads + Internal Project (never on-hand)', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /new project/i }));
    const dialog = screen.getByRole('dialog');
    const select = within(dialog).getByLabelText(/origination stage/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(['Leads', 'Internal Project']);
    expect(options).not.toContain('Ongoing Project');
    expect(options).not.toContain('Won, Pending KoM');
  });

  it('AC-PRJ-003: a create rejected by RLS (42501) surfaces a classified warning toast', async () => {
    projectMutations.create.mutateAsync.mockRejectedValue(new AppError('not permitted', '42501'));
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /new project/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/project name/i), 'Blocked Project');
    await userEvent.click(within(dialog).getByRole('combobox', { name: /client company/i }));
    const listbox = await screen.findByRole('listbox', { name: /compan/i });
    await userEvent.click(within(listbox).getByRole('option', { name: /Innovate Corp/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: /^Create project$/i }));
    const toast = await findToastAnnouncement('alert', /don't have permission/i);
    expect(toast).toHaveTextContent(/don't have permission/i);
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
        categories: [{ category: 'Labor', mapped: true, amount: '125000.00' }] }, activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
    };
    projectMoneyState.isPending = false;
    projectMoneyState.isError = false;
  });

  afterEach(() => {
    projectsState.data = seed as unknown as ProjectWithRefs[];
    projectMoneyState.data = {};
    resetActiveLocale();
  });

  it('formats exact Actual with the selected number locale rather than the translation language', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id', timezone: 'Asia/Jakarta' });
    renderPage();
    const body = document.querySelector('tbody')!;
    expect(within(body).getByText('US$125.000,00')).toBeInTheDocument();
  });

  it('AC-S02-008: displays canonical Actual, freshness and Active-budget utilization instead of committedSpend', () => {
    renderPage();
    expect(screen.getByRole('columnheader', { name: 'Actual' })).toBeInTheDocument();
    const body = document.querySelector('tbody')!;
    expect(within(body).getByText('$125,000.00')).toBeInTheDocument();
    expect(within(body).getByText('ERP actual')).toBeInTheDocument();
    expect(within(body).queryByText('$2,100,000')).not.toBeInTheDocument();
    expect(within(body).getByText(/Updated/)).toBeInTheDocument();
    expect(within(body).getByLabelText(/25% of Active budget/)).toBeInTheDocument();
  });

  it('AC-S02: labels committed PMO Actual separately from ERP ledger Actual', () => {
    projectMoneyState.data = {
      p1: { ledgerBasis: 'pmo', actuals: { currency: 'USD', total: '125000.00', asOf: null, excludesRestrictedRows: false, categories: [] }, activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
    };
    renderPage();
    const body = document.querySelector('tbody')!;
    expect(within(body).getByText('Committed POs')).toBeInTheDocument();
    expect(within(body).queryByText('ERP actual')).not.toBeInTheDocument();
  });

  it('AC-S02-009: unknown Actual and missing Active budget stay unavailable, never zero or at risk', async () => {
    projectMoneyState.data = {
      p1: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: null, asOf: null, excludesRestrictedRows: false,
        categories: [{ category: 'Labor', mapped: false, amount: null }] }, activeBudgetAmount: null, activeBudgetCurrency: null, hasActiveBudget: false },
    };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /show optional columns/i }));
    const body = document.querySelector('tbody')!;
    expect(within(body).getByText('Unavailable')).toBeInTheDocument();
    expect(within(body).getByText('No active budget')).toBeInTheDocument();
    expect(within(body).getByText('Incomplete source coverage')).toBeInTheDocument();
    expect(within(body).queryByText('At risk')).not.toBeInTheDocument();
    expect(within(body).queryByText('$0')).not.toBeInTheDocument();
  });

  it('AC-S02-012: known zero Actual is distinct from unavailable and uses the Active-budget denominator', () => {
    projectMoneyState.data = {
      p1: { actuals: { currency: 'USD', total: '0.00', asOf: '2026-10-01T00:00:00Z', excludesRestrictedRows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '0.00' }] }, activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
    };
    renderPage();
    const body = document.querySelector('tbody')!;
    expect(within(body).getByText('$0.00')).toBeInTheDocument();
    expect(within(body).queryByText('Unavailable')).not.toBeInTheDocument();
    expect(within(body).getByLabelText(/0% of Active budget/)).toBeInTheDocument();
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
      projectMoneyState.data = { p1: { actuals, activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true } };
      const { unmount } = renderPage('Project Manager', '/projects?filter=at-risk');
      expect(screen.queryByText('Innovate Corp HQ Fit-Out')).not.toBeInTheDocument();
      unmount();
      const { unmount: unmountAll } = renderPage();
      const body = document.querySelector('tbody')!;
      expect(within(body).queryByLabelText(/90% of Active budget/i)).not.toBeInTheDocument();
      expect(within(body).getAllByText(actuals.excludesRestrictedRows ? 'Restricted rows excluded' : 'Incomplete source coverage').length).toBeGreaterThan(0);
      unmountAll();
    }
  });

  it('AC-S02: missing freshness is explicit when Actual is known', () => {
    projectMoneyState.data = {
      p1: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '125.00', asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '125.00' }] }, activeBudgetAmount: '500.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
    };
    renderPage();
    const body = document.querySelector('tbody')!;
    expect(within(body).getByText('Update time unavailable')).toBeInTheDocument();
  });

  it('AC-S02: a known zero Active budget remains distinct from no Active budget', () => {
    projectMoneyState.data = {
      p1: { actuals: { currency: 'USD', total: '0.00', asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '0.00' }] }, activeBudgetAmount: '0.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
    };
    renderPage();
    const body = document.querySelector('tbody')!;
    expect(within(body).getByText('$0 Active budget; usage unavailable')).toBeInTheDocument();
    expect(within(body).queryByText('No active budget')).not.toBeInTheDocument();
  });

  it('AC-S02-013: only mapped Actual at or above 90% of a same-currency Active budget is at risk', () => {
    projectMoneyState.data = {
      p1: { actuals: { currency: 'USD', total: '450000.00', asOf: '2026-10-01T00:00:00Z', excludesRestrictedRows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '450000.00' }] }, activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
    };
    renderPage();
    const utilization = screen.getByLabelText(/90% of Active budget/);
    expect(utilization).toBeInTheDocument();
    expect(utilization.parentElement?.parentElement).toHaveTextContent('At risk');
  });

  it('AC-S02: does not classify cross-currency Actual and Active budget as at risk', () => {
    projectMoneyState.data = {
      p1: { actuals: { currency: 'USD', total: '450000.00', asOf: '2026-10-01T00:00:00Z', excludesRestrictedRows: false,
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

  it('AC-EC-003: the table shows an End customer column with each project’s end customer', () => {
    renderPage();
    expect(screen.getByRole('columnheader', { name: /^End customer$/ })).toBeInTheDocument();
    expect(screen.getAllByText('Asset Owner Alpha').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Site Owner Beta').length).toBeGreaterThan(0);
  });

  it('UX-021: end-customer choices come from project associations, not unrelated companies', async () => {
    companiesState.data = [
      ...companiesState.data,
      { id: '9c9c9c9c-0000-4000-8000-0000000000c3', name: 'Unrelated Supplier', type: 'Vendor' },
    ];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    const scopedSelect = screen.getByRole('combobox', { name: /filter by end customer/i });
    expect(within(scopedSelect).getByRole('option', { name: 'Asset Owner Alpha' })).toBeInTheDocument();
    expect(within(scopedSelect).queryByRole('option', { name: 'Unrelated Supplier' })).not.toBeInTheDocument();
  });

  it('UX-021: all-empty optional columns hide with a discoverable restore control', async () => {
    projectsState.data = withEnd.map((project) => ({ ...project, end_client_id: null, end_client: null })) as unknown as ProjectWithRefs[];
    renderPage();
    expect(screen.queryByRole('columnheader', { name: /end customer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^Budget used$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show optional columns/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /show optional columns/i }));
    expect(screen.getByRole('columnheader', { name: /end customer/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /^Budget used$/i })).toBeInTheDocument();
  });

  it('AC-EC-003: ?endClient=<id> narrows the list to that end customer’s projects', () => {
    renderPage('Project Manager', `/projects?filter=All&endClient=${END_B}`);
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.queryByText('Innovate Corp HQ Fit-Out')).not.toBeInTheDocument();
    expect(screen.queryByText('Regional Services Program')).not.toBeInTheDocument();
  });

  it('AC-EC-003: choosing an end customer in the filter narrows the rows and writes endClient to the URL', async () => {
    renderPage('Project Manager', '/projects?filter=All');
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    const select = screen.getByRole('combobox', { name: /filter by end customer/i });
    // Includes linked end customers regardless of company type (Site Owner Beta is a Vendor).
    expect(within(select).getByRole('option', { name: 'Site Owner Beta' })).toBeInTheDocument();
    await userEvent.selectOptions(select, END_A);
    expect(screen.getByTestId('location-probe').dataset.search).toContain(`endClient=${END_A}`);
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.queryByText('Northwind ERP Rollout')).not.toBeInTheDocument();
    expect(screen.queryByText('Regional Services Program')).not.toBeInTheDocument();
  });
});

it('AC-TAG-002 Projects intersects classification controls, preserves URL and clears the actual result', async () => {
  projectsState.data = seed.map((p, i) => ({ ...p, service_line: i === 0 ? 'Engineering' : 'Advisory', sector: 'Energy', location: 'West Java', award_type: 'tender', bidding_entity: 'alone' })) as unknown as ProjectWithRefs[];
  const user = userEvent.setup(); renderPage('Project Manager', '/projects?view=table');
  await user.click(screen.getByRole('button', { name: /^Classification$/ }));
  await user.selectOptions(screen.getAllByLabelText('Filter by service line')[0], 'Engineering');
  expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();
  expect(screen.queryByText('Northwind ERP Rollout')).toBeNull();
  expect(screen.getByTestId('location-probe').getAttribute('data-search')).toContain('serviceLine=Engineering');
  await user.selectOptions(screen.getAllByLabelText('Filter by service line')[0], '');
  expect(await screen.findByText('Northwind ERP Rollout')).toBeVisible();
});

it('AC-TAG-002 Engineer classification filters remain available without manager-only customer controls', async () => {
  projectsState.data = seed.map((p) => ({ ...p, service_line: 'Engineering' })) as unknown as ProjectWithRefs[];
  renderPage('Engineer', '/projects?filter=All&view=table');
  await userEvent.click(screen.getByRole('button', { name: /^Classification$/ }));
  expect(screen.getByLabelText('Filter by service line')).toBeInTheDocument();
  expect(screen.queryByLabelText('Filter by customer')).toBeNull();
});
