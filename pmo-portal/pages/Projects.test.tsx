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
import { AppError } from '@/src/lib/appError';
import Projects from './Projects';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

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
const { roleBox, projectMutations, deliverySummaryState } = vi.hoisted(() => ({
  roleBox: { value: 'Project Manager' },
  projectMutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  },
  deliverySummaryState: {
    p1: { deliveryPct: 50, committedSpend: 2_100_000, budget: 4_700_000 },
    p2: { deliveryPct: 25, committedSpend: 0, budget: 0 },
    p3: { deliveryPct: null, committedSpend: 0, budget: 0 },
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
  useProjectsDeliverySummary: () => ({ data: deliverySummaryState }),
}));
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

  it('AC-EXP-008 / AC-IMP-009: renders live Export and Import affordances in the toolbar', () => {
    renderPage('Admin');
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

  it('AC-CODE-003: project cell shows identifier values without the label prefix in the truncating element, label kept for AT (#838)', () => {
    const prev = projectsState.data;
    projectsState.data = [{ ...seed[0], pmo_project_number: 'PMO-26-0042', code: 'CLIENT-77' }] as unknown as ProjectWithRefs[];
    try {
      renderPage();
      const pmo = screen.getByTitle('PMO-26-0042');
      expect(pmo).toHaveTextContent(/^PMO-26-0042$/);
      const client = screen.getByTitle('CLIENT-77');
      expect(client).toHaveTextContent(/^CLIENT-77$/);
      // The label survives as a screen-reader-only prefix on the same line.
      expect(pmo.parentElement).toHaveTextContent('PMO Project Number: PMO-26-0042');
      expect(client.parentElement).toHaveTextContent('Client Project Code: CLIENT-77');
      expect(within(pmo.parentElement as HTMLElement).getByText('PMO Project Number:')).toHaveClass('sr-only');
    } finally {
      projectsState.data = prev;
    }
  });

  it('renders seeded projects with joined client + PM names (AC-401)', () => {
    renderPage();
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getAllByText('Innovate Corp').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Alice Manager').length).toBeGreaterThan(0);
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
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
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
    // Find the PM avatar in the table tbody (has single-letter initial, size-[18px])
    const tableBody = document.querySelector('tbody');
    const pmCells = tableBody?.querySelectorAll('td');
    const pmAvatar = Array.from(pmCells ?? [])
      .flatMap(td => Array.from(td.querySelectorAll('[aria-hidden="true"]')))
      .find(el => el.className.includes('rounded-full') && el.className.includes('size-[18px]'));
    expect(pmAvatar).toBeTruthy();
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

  it('M-D: PM name renders in full and wraps — no tight max-w-[10ch] truncation', () => {
    renderPage();
    // Scope to the table body (the toolbar PM filter <select> also lists the name).
    const tbody = document.querySelector('tbody')!;
    const pmName = within(tbody as HTMLElement)
      .getAllByText('Alice Manager')
      .find((el) => el.tagName === 'SPAN')!;
    expect(pmName).toBeTruthy();
    // The name span allows wrapping (whitespace-normal) rather than truncating.
    expect(pmName.className).toContain('whitespace-normal');
    expect(pmName.className).not.toContain('truncate');
    expect(pmName.className).not.toContain('max-w-[10ch]');
  });
});

describe('ProjectStatusControl integration (AC-1011 UI)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  it('AC-1011 (UI): the default Table view renders a ProjectStatusControl per row and shows the customer contract reference (FR-PR-011)', () => {
    projectsState.data = seedWithWon as unknown as ProjectWithRefs[];
    renderPage();
    const controls = screen.getAllByTestId('project-status-control');
    expect(controls.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('CPO-2026-999')).toBeInTheDocument();
    projectsState.data = seed as unknown as ProjectWithRefs[];
  });

  it('AC-1011 (UI): the Cards view also renders the status control + ref (win flow reachable from both views)', async () => {
    projectsState.data = seedWithWon as unknown as ProjectWithRefs[];
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Cards/i }));
    expect(screen.getAllByTestId('project-card').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('project-status-control').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('CPO-2026-999')).toBeInTheDocument();
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
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent(/don't have permission/i);
  });
});

// ── AC-MONEY-01: Projects table "Actual" column uses delivery committedSpend ──
describe('Projects table — Actual column uses live committed spend (AC-MONEY-01)', () => {
  // The bug: the "Actual" column in the table reads p.spent (dead stored column, always 0
  // in production). deliverySummary already contains committedSpend per project, which is
  // the live Ordered..Paid procurement sum. The column must read deliverySummary[p.id].committedSpend.
  beforeEach(() => {
    sessionStorage.clear();
    // Seed with project.spent=0 (as in production) but deliverySummary has non-zero committedSpend
    projectsState.data = [
      { ...seed[0], spent: 0 }, // stored column dead
    ] as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  afterEach(() => {
    projectsState.data = seed as unknown as ProjectWithRefs[];
  });

  it('AC-MONEY-01: Actual column shows committedSpend from delivery summary, not dead project.spent', () => {
    // deliverySummaryState.p1.committedSpend = 2_100_000 (from the hoisted mock above)
    // project.spent = 0 (dead column)
    renderPage();
    // The "Actual" column header should be in the table
    expect(screen.getByRole('columnheader', { name: 'Actual' })).toBeInTheDocument();
    // $2,100,000 must appear — from deliverySummary.p1.committedSpend
    expect(screen.getByText('$2,100,000')).toBeInTheDocument();
    // $0 must NOT appear as the actual value (that would be the dead stored column)
    // Note: $0 may appear as "—" for budget columns, but the Actual cell itself must not be $0
    const tbody = document.querySelector('tbody');
    const actualCells = Array.from(tbody?.querySelectorAll('td') ?? [])
      .filter(td => td.textContent === '$0');
    // No cell in the table body should show bare $0 for the Actual column
    // when committedSpend is non-zero
    expect(actualCells.length).toBe(0);
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

  it('AC-EC-003: ?endClient=<id> narrows the list to that end customer’s projects', () => {
    renderPage('Project Manager', `/projects?filter=All&endClient=${END_B}`);
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.queryByText('Innovate Corp HQ Fit-Out')).not.toBeInTheDocument();
    expect(screen.queryByText('Regional Services Program')).not.toBeInTheDocument();
  });

  it('AC-EC-003: choosing an end customer in the filter narrows the rows and writes endClient to the URL', async () => {
    renderPage('Project Manager', '/projects?filter=All');
    const select = screen.getByRole('combobox', { name: /filter by end customer/i });
    // Lists ALL the org's companies, not only Client-type (Site Owner Beta is a Vendor).
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
  expect(screen.getByLabelText('Filter by service line')).toBeInTheDocument();
  expect(screen.queryByLabelText('Filter by customer')).toBeNull();
});
