/**
 * AC-IXD-PROJ-W5-C3 — Wave-5 Cluster-3 PR-2:
 *   D15 role-adaptive header (finance-forward vs delivery-forward)
 *   N10 post-transition wayfinding (Back to Sales Pipeline + focus)
 *   D9-pipeline PQ → Pre-Qualification label
 *
 * Owning layer: Vitest/RTL render-by-role (the delivery-forward/finance-forward split is pure FE).
 *
 * D15 render-position tests (AC-IXD-PROJ-W5-C3-D15-POS-*) assert RENDERED DOM ORDER in the
 * full ProjectDetail page — not just existence in the isolated header. This is the exact blind
 * spot the original tests had: they asserted the aside *existed* in a header render, but missed
 * that the header renders ABOVE the tablist in the full page (the defect).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
vi.mock('@/pages/project-detail/ProjectFinancesSection', () => ({ ProjectFinancesSection: () => null }));

vi.mock('@/src/hooks/useProjectVatEditability', () => ({ useProjectVatEditability: () => ({ data: { eligible: true, reason: null, hasInvoices: false }, isPending: false, isFetching: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectFinances', () => ({ useProjectFinances: () => ({ data: undefined, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD', useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-12', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useFxRates', () => ({ useFxRate: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));

// ── Shared mocks ────────────────────────────────────────────────────────────

const { transitionProject } = vi.hoisted(() => ({
  transitionProject: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/db/projectTransitions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, transitionProject };
});

vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({
    data: {
      stages: [],
      projects: [
        {
          id: 'd1',
          name: 'Acme Tender Bid',
          status: 'Tender Submitted',
          contract_value: 1_200_000,
          win_probability: 0.5,
        },
      ],
    },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

// Header mutations
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  }),
  useProjects: () => ({ data: [], isPending: false }),
  // #840: the detail route reads ONE project by id (any stage), never the whole list.
  useProject: (id: string) => {
    const l = (({ data: [], isPending: false })) as { data?: { id: string }[] | null; isPending?: boolean; isError?: boolean; refetch?: () => void };
    return { isPending: false, isError: false, refetch: vi.fn(), ...l, data: (l.data ?? []).find((p) => p.id === id) ?? null };
  },
  useClientCompanies: () => ({ data: [], isError: false }),
  useProjectManagers: () => ({ data: [], isError: false }),
}));
vi.mock('@/src/lib/db/opportunity', () => ({
  useOpportunity: () => ({ data: undefined, isPending: false }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({ useSalesInvoices: () => ({ data: [] }) })); // OD-TAX-4: header reads the project's invoices (VAT flag lock)
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetVersions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetMutations: () => ({
    createVersion: { mutateAsync: vi.fn() }, activate: { mutateAsync: vi.fn() },
    archive: { mutateAsync: vi.fn() }, cloneVersion: { mutateAsync: vi.fn() },
    deleteDraft: { mutateAsync: vi.fn() }, createLineItem: { mutateAsync: vi.fn() },
    deleteLineItem: { mutateAsync: vi.fn() },
  }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useAssignableProfiles: () => ({ data: [], isPending: false, isError: false }),
  useTaskMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false }, update: { mutateAsync: vi.fn(), isPending: false },
    updateStatus: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false },
    addDependency: { mutateAsync: vi.fn(), isPending: false }, removeDependency: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useDocumentMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false }, update: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
const navigate = vi.fn();
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

// ── Fixture rows ─────────────────────────────────────────────────────────────

const onHandRow: ProjectWithRefs = {
  id: 'p1',
  name: 'Innovate Corp HQ Fit-Out',
  code: 'PRJ-001',
  status: 'Ongoing Project',
  client_id: 'c2',
  project_manager_id: 'u-alice',
  contract_value: 5_000_000,
  currency: 'USD',
  budget: 4_700_000,
  spent: 2_100_000,
  start_date: '2026-01-01',
  end_date: '2026-12-18',
  contract_date: '2026-01-10',
  customer_contract_ref: 'CPO-2026-001',
  client: { name: 'Innovate Corp' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

const pipelineRow: ProjectWithRefs = {
  id: 'd1',
  name: 'Acme Tender Bid',
  code: 'OPP-0042',
  status: 'Tender Submitted',
  client_id: 'c1',
  project_manager_id: 'u-alice',
  contract_value: 1_200_000,
  currency: 'USD',
  budget: 0,
  spent: 0,
  start_date: null,
  end_date: null,
  contract_date: null,
  decided_at: null,
  customer_contract_ref: null,
  client: { name: 'Acme' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

// ── Render helpers ────────────────────────────────────────────────────────────

import ProjectDetailHeader from '../ProjectDetailHeader';
import PipelineLens from '../PipelineLens';

const renderHeader = (realRole: Role, project: ProjectWithRefs = onHandRow) =>
  render(
    <ImpersonationProvider realRole={realRole}>
      <ToastProvider>
        <MemoryRouter>
          <ProjectDetailHeader project={project} />
        </MemoryRouter>
      </ToastProvider>
    </ImpersonationProvider>,
  );

const renderLens = (project: ProjectWithRefs = pipelineRow) =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <ToastProvider>
        <PipelineLens project={project} />
      </ToastProvider>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  transitionProject.mockClear();
  transitionProject.mockResolvedValue(undefined);
  navigate.mockClear();
});

// ═════════════════════════════════════════════════════════════════════════════
// D15 — Role-adaptive header
// ═════════════════════════════════════════════════════════════════════════════

describe('AC-IXD-PROJ-W5-C3 D15: role-adaptive header', () => {
  // ── Finance-forward roles keep the header unchanged ────────────────────────
  it('AC-IXD-PROJ-W5-C3-01: PM (finance-forward) sees the finance StatTiles in the header', () => {
    renderHeader('Project Manager');
    // The 5-tile strip remains in the header for finance-forward roles.
    expect(screen.getByText('Contract')).toBeInTheDocument();
    expect(screen.getByText('Actual')).toBeInTheDocument();
    // The contract-value SoD row is also in the header (not demoted).
    expect(screen.getByTestId('contract-value-sod')).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-02: Finance (finance-forward) sees the finance StatTiles in the header', () => {
    renderHeader('Finance');
    expect(screen.getByText('Contract')).toBeInTheDocument();
    expect(screen.getByText('Actual')).toBeInTheDocument();
    expect(screen.getByTestId('contract-value-sod')).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-03: Executive (finance-forward) sees the finance StatTiles in the header', () => {
    renderHeader('Executive');
    expect(screen.getByText('Contract')).toBeInTheDocument();
    expect(screen.getByText('Actual')).toBeInTheDocument();
    expect(screen.getByTestId('contract-value-sod')).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-04: Admin (finance-forward) sees the finance StatTiles in the header', () => {
    renderHeader('Admin');
    expect(screen.getByText('Contract')).toBeInTheDocument();
    expect(screen.getByText('Actual')).toBeInTheDocument();
    expect(screen.getByTestId('contract-value-sod')).toBeInTheDocument();
  });

  // ── Delivery-forward (Engineer) — tiles leave the header entirely ──────────
  // D15 fix: the header renders NO finance block at all for Engineer. The aside
  // was removed from ProjectDetailHeader; it now lives in OverviewTab (below the
  // tab bar). The rendered-position assertions are in wave5-c3-pr2-position.test.tsx.
  it('AC-IXD-PROJ-W5-C3-05: Engineer (delivery-forward) header does NOT contain the financial-summary aside or any finance StatTile labels', () => {
    const { container } = renderHeader('Engineer');
    // The header must NOT contain the financial-summary aside (it moved to OverviewTab).
    expect(container.querySelector('[data-testid="financial-summary"]')).toBeNull();
    // Finance StatTile labels must not appear in the isolated header render.
    expect(screen.queryByText('Contract remaining after cost')).not.toBeInTheDocument();
    expect(screen.queryByText('PMO purchase orders')).not.toBeInTheDocument();
    // The contract-value SoD row is also absent from the header.
    expect(container.querySelector('[data-testid="contract-value-sod"]')).toBeNull();
  });

  it('AC-IXD-PROJ-W5-C3-06: Engineer still sees the project name and status (delivery meta stays)', () => {
    renderHeader('Engineer');
    expect(screen.getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
    expect(screen.getByText('Ongoing Project')).toBeInTheDocument();
  });

  // ── Financial summary lives in OverviewTab (not the isolated header) ────────
  // D15 fix: the aside moved OUT of ProjectDetailHeader and INTO OverviewTab.
  // The isolated header render (renderHeader) no longer contains it. The full-page
  // assertions (with a11y + content + DOM position) live in wave5-c3-pr2-position.test.tsx.
  it('AC-IXD-PROJ-W5-C3-07: Engineer header does NOT contain the "Financial summary" aside (it is in OverviewTab, not the header)', () => {
    const { container } = renderHeader('Engineer');
    // The header isolation render must not contain the financial-summary aside.
    // It has moved into OverviewTab (see wave5-c3-pr2-position.test.tsx for full-page assertions).
    expect(container.querySelector('[data-testid="financial-summary"]')).toBeNull();
    // Finance tile labels are absent from the header.
    expect(screen.queryByText('Contract')).not.toBeInTheDocument();
    expect(screen.queryByText('Contract remaining after cost')).not.toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-08: the "Financial summary" aside (in OverviewTab) has aria-label and is an aside element — verified in position tests', () => {
    // The a11y properties of the aside (aria-label, element tag) are asserted in
    // wave5-c3-pr2-position.test.tsx (AC-IXD-PROJ-W5-C3-D15-POS-10) against the full-page
    // render where the aside actually appears. In the isolated header render the aside is absent.
    const { container } = renderHeader('Engineer');
    expect(container.querySelector('[data-testid="financial-summary"]')).toBeNull();
  });

  it('AC-IXD-PROJ-W5-C3-09: Engineer header has no contract-value SoD row; the Read-only lock is in the OverviewTab aside', () => {
    const { container } = renderHeader('Engineer');
    // The SoD row is absent from the header isolation render (it's in OverviewTab now).
    expect(container.querySelector('[data-testid="contract-value-sod"]')).toBeNull();
    // The Read-only lock pill is also not in the header.
    expect(screen.queryByText(/Read-only/i)).not.toBeInTheDocument();
    // The Edit contract value button has never been offered to Engineer.
    expect(screen.queryByRole('button', { name: /Edit contract value/i })).not.toBeInTheDocument();
  });

  // ── Pre-win (pipeline) is unaffected (D15 only applies to delivery lens) ──
  it('AC-IXD-PROJ-W5-C3-10: pre-win record does not render the financial summary aside (pre-win is unaffected by D15)', () => {
    const preWinRow = { ...onHandRow, status: 'Leads', customer_contract_ref: null } as unknown as ProjectWithRefs;
    const { container } = renderHeader('Engineer', preWinRow);
    // Pre-win: the delivery lens (StatTiles + SoD row + financial summary) is not mounted at all
    expect(container.querySelector('[data-testid="financial-summary"]')).toBeNull();
    expect(screen.queryByTestId('contract-value-sod')).not.toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// D15 — hasFinanceView predicate + default tab logic
// ═════════════════════════════════════════════════════════════════════════════

// Note: we do not import ProjectDetail here because the default-tab behavior
// (Engineer → Tasks) requires injecting per-role data into the useProjects mock
// which is static at top-level. The predicate tests below verify the role-classification
// logic directly; the default-tab behavior is covered in a separate test module
// (ProjectDetail.defaultTab.test.tsx, to be authored if the Director decides to add a
// dedicated default-tab acceptance test beyond the predicate check here).

describe('AC-IXD-PROJ-W5-C3 D15: hasFinanceView predicate', () => {
  it('AC-IXD-PROJ-W5-C3-11: hasFinanceView is true for Admin, Executive, Finance, Project Manager', async () => {
    // Import the predicate to verify the role-classification logic directly.
    const { hasFinanceView } = await import('../ProjectDetailHeader');
    expect(hasFinanceView('Admin')).toBe(true);
    expect(hasFinanceView('Executive')).toBe(true);
    expect(hasFinanceView('Finance')).toBe(true);
    expect(hasFinanceView('Project Manager')).toBe(true);
  });

  it('AC-IXD-PROJ-W5-C3-12: hasFinanceView is false for Engineer (delivery-forward role)', async () => {
    const { hasFinanceView } = await import('../ProjectDetailHeader');
    expect(hasFinanceView('Engineer')).toBe(false);
    expect(hasFinanceView(null)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// N10 — Post-transition wayfinding (PipelineLens)
// ═════════════════════════════════════════════════════════════════════════════

describe('AC-IXD-PROJ-W5-C3 N10: post-transition wayfinding', () => {
  it('SUB-I (was AC-IXD-PROJ-W5-C3-13..16,18 / AC-LRC-004,011): the Next-actions card has no "Back to Sales Pipeline" link — the breadcrumb/BackBar owns return wayfinding — at rest or after a transition', async () => {
    renderLens();
    expect(screen.queryByRole('link', { name: /back to sales pipeline/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Advance to/i }));
    await waitFor(() => expect(transitionProject).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /back to sales pipeline/i })).not.toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-17: on a terminal/lost stage, the Next-actions card body has enriched copy naming the next step', () => {
    const lostRow = { ...pipelineRow, status: 'Loss Tender' } as unknown as ProjectWithRefs;
    renderLens(lostRow);
    // Terminal lost copy — the gate notice names the outcome
    expect(screen.getByText(/marked lost/i)).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// D9-pipeline — "PQ" → "Pre-Qualification" label
// ═════════════════════════════════════════════════════════════════════════════

describe('AC-IXD-PROJ-W5-C3 D9-pipeline: PQ → Pre-Qualification label', () => {
  it('AC-IXD-PROJ-W5-C3-19: dealJourneySteps uses "Pre-Qualification" (not "Pre-Qual") as the step label', async () => {
    const { dealJourneySteps } = await import('../../../components/salesPipeline');
    const steps = dealJourneySteps('PQ Submitted' as Parameters<typeof dealJourneySteps>[0]);
    const labels = steps.map((s) => s.label);
    // The second label (index 1) must be the full word
    expect(labels[1]).toBe('Pre-Qualification');
    // Must not contain the short acronym "Pre-Qual" as the visible label
    expect(labels[1]).not.toBe('Pre-Qual');
  });

  it('AC-IXD-PROJ-W5-C3-20: the deal journey stepper renders "Pre-Qualification" in the DOM', () => {
    renderLens();
    // The LifecycleStepper renders step labels — "Pre-Qualification" must be visible
    expect(screen.getByText('Pre-Qualification')).toBeInTheDocument();
    // "Pre-Qual" should not appear as a rendered node label
    // (Note: it may still appear in the SALES_COLUMNS title for the kanban board — that is
    //  a separate surface; here we assert only the deal journey stepper inside PipelineLens)
    const journey = screen.getByRole('list', { name: /Project stage journey/i });
    expect(within(journey).getByText('Pre-Qualification')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SUB-I — Opportunity lens: only what the deal state needs
// ═════════════════════════════════════════════════════════════════════════════

describe('SUB-I: opportunity lens figures and notices', () => {
  const tileLabels = () => screen.getAllByTestId('stat-tile').map((tile) => tile.firstElementChild?.textContent);

  it('SUB-I: an open deal shows Value, Win probability, Weighted, Owner — no Decision tile, no "Ready to advance." box', () => {
    renderLens();
    expect(tileLabels()).toEqual(['Value', 'Win probability', 'Weighted', 'Owner']);
    expect(screen.queryByText('Ready to advance.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Advance to/i })).toBeInTheDocument();
  });

  it('SUB-I: a lost deal shows Value, Owner, Decision — never a 0% win probability or a zero weighted value', () => {
    renderLens({ ...pipelineRow, status: 'Loss Tender' } as unknown as ProjectWithRefs);
    expect(tileLabels()).toEqual(['Value', 'Owner', 'Decision']);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.getByText(/marked lost/i)).toBeInTheDocument();
  });
});
