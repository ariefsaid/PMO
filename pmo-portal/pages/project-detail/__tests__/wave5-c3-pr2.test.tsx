/**
 * AC-IXD-PROJ-W5-C3 — Wave-5 Cluster-3 PR-2:
 *   D15 role-adaptive header (finance-forward vs delivery-forward)
 *   N10 post-transition wayfinding (Back to Sales Pipeline + focus)
 *   D9-pipeline PQ → Pre-Qualification label
 *
 * Owning layer: Vitest/RTL render-by-role (the delivery-forward/finance-forward split is pure FE).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

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
  useClientCompanies: () => ({ data: [], isError: false }),
  useProjectManagers: () => ({ data: [], isError: false }),
}));
vi.mock('@/src/lib/db/opportunity', () => ({
  useOpportunity: () => ({ data: undefined, isPending: false }),
}));
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
const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
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
    expect(screen.getByText('Committed')).toBeInTheDocument();
    expect(screen.getByText('On-hand margin')).toBeInTheDocument();
    // The contract-value SoD row is also in the header (not demoted).
    expect(screen.getByTestId('contract-value-sod')).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-02: Finance (finance-forward) sees the finance StatTiles in the header', () => {
    renderHeader('Finance');
    expect(screen.getByText('Contract')).toBeInTheDocument();
    expect(screen.getByText('On-hand margin')).toBeInTheDocument();
    expect(screen.getByTestId('contract-value-sod')).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-03: Executive (finance-forward) sees the finance StatTiles in the header', () => {
    renderHeader('Executive');
    expect(screen.getByText('Contract')).toBeInTheDocument();
    expect(screen.getByText('On-hand margin')).toBeInTheDocument();
    expect(screen.getByTestId('contract-value-sod')).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-04: Admin (finance-forward) sees the finance StatTiles in the header', () => {
    renderHeader('Admin');
    expect(screen.getByText('Contract')).toBeInTheDocument();
    expect(screen.getByText('On-hand margin')).toBeInTheDocument();
    expect(screen.getByTestId('contract-value-sod')).toBeInTheDocument();
  });

  // ── Delivery-forward (Engineer) — tiles leave the header ──────────────────
  it('AC-IXD-PROJ-W5-C3-05: Engineer (delivery-forward) does NOT see finance StatTiles directly in the page header', () => {
    const { container } = renderHeader('Engineer');
    // The financial summary aside contains the tiles (that's the correct relocation)
    const aside = container.querySelector('[data-testid="financial-summary"]') as HTMLElement | null;
    expect(aside).not.toBeNull(); // aside is present
    // But the StatTiles strip is INSIDE the aside, NOT floating outside it at the page-header level.
    // Verify: no StatTile label appears outside the aside (i.e. only one instance in the doc — inside the aside).
    const allOnHandMargin = screen.getAllByText('On-hand margin');
    // All instances must be descendants of the aside
    for (const el of allOnHandMargin) {
      expect(aside!.contains(el)).toBe(true);
    }
    // Likewise for 'Committed'
    const allCommitted = screen.getAllByText('Committed');
    for (const el of allCommitted) {
      expect(aside!.contains(el)).toBe(true);
    }
    // The contract-value SoD row exists but is inside the aside, not bare in the header
    const sodRow = container.querySelector('[data-testid="contract-value-sod"]') as HTMLElement | null;
    expect(sodRow).not.toBeNull();
    expect(aside!.contains(sodRow!)).toBe(true);
  });

  it('AC-IXD-PROJ-W5-C3-06: Engineer still sees the project name and status (delivery meta stays)', () => {
    renderHeader('Engineer');
    expect(screen.getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
    expect(screen.getByText('Ongoing Project')).toBeInTheDocument();
  });

  // ── Financial summary card in Overview for Engineer ───────────────────────
  it('AC-IXD-PROJ-W5-C3-07: Engineer Overview has a labelled "Financial summary" aside with the finance data', () => {
    const { container } = renderHeader('Engineer');
    // The financial summary aside is present for Engineer (data stays reachable)
    const aside = container.querySelector('[data-testid="financial-summary"]') as HTMLElement | null;
    expect(aside).not.toBeNull();
    // The aside has a visible heading
    expect(within(aside!).getByText(/financial summary/i)).toBeInTheDocument();
    // The finance tile labels appear inside the aside (not in the header)
    expect(within(aside!).getByText('Contract')).toBeInTheDocument();
    expect(within(aside!).getByText('On-hand margin')).toBeInTheDocument();
    // The contract-value SoD row is inside the aside, read-only
    expect(within(aside!).getByTestId('contract-value-sod')).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-08: Financial summary aside has the correct ARIA landmark role + label', () => {
    const { container } = renderHeader('Engineer');
    const aside = container.querySelector('[data-testid="financial-summary"]') as HTMLElement | null;
    expect(aside).not.toBeNull();
    // The aside element (or its outermost el) must expose aria-label="Financial summary"
    // so screen readers announce the region.
    expect(aside!.getAttribute('aria-label')).toMatch(/financial summary/i);
  });

  it('AC-IXD-PROJ-W5-C3-09: Engineer sees the Read-only lock pill on the contract-value SoD row (no edit for Engineer)', () => {
    const { container } = renderHeader('Engineer');
    const aside = container.querySelector('[data-testid="financial-summary"]') as HTMLElement | null;
    expect(aside).not.toBeNull();
    // The SoD row shows Read-only (never an Edit contract value button for Engineer)
    expect(within(aside!).getByText(/Read-only/i)).toBeInTheDocument();
    expect(within(aside!).queryByRole('button', { name: /Edit contract value/i })).not.toBeInTheDocument();
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
  it('AC-IXD-PROJ-W5-C3-13: "Back to Sales Pipeline" link is present in the Next-actions card at rest (before any transition)', () => {
    renderLens();
    // A persistent quiet link must always be visible in the Next-actions card
    const link = screen.getByRole('link', { name: /back to sales pipeline/i });
    expect(link).toBeInTheDocument();
    // It must point to the Sales Pipeline route
    expect(link).toHaveAttribute('href', '/sales');
  });

  it('AC-IXD-PROJ-W5-C3-14: "Back to Sales Pipeline" link is keyboard-reachable (tabIndex not negative)', () => {
    renderLens();
    const link = screen.getByRole('link', { name: /back to sales pipeline/i });
    // Should not have tabIndex=-1 (keyboard-reachable)
    expect(link.getAttribute('tabIndex')).not.toBe('-1');
  });

  it('AC-IXD-PROJ-W5-C3-15: after Advance transition the "Back to Sales Pipeline" link remains present', async () => {
    renderLens();
    await userEvent.click(screen.getByRole('button', { name: /Advance to/i }));
    // Wait for transition to settle (the link should still be present)
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /back to sales pipeline/i })).toBeInTheDocument();
    });
  });

  it('AC-IXD-PROJ-W5-C3-16: after Mark-lost transition, the "Back to Sales Pipeline" link is present', async () => {
    renderLens();
    await userEvent.click(screen.getByRole('button', { name: /Mark lost/i }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Mark lost/i }));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /back to sales pipeline/i })).toBeInTheDocument();
    });
  });

  it('AC-IXD-PROJ-W5-C3-17: on a terminal/lost stage, the Next-actions card body has enriched copy naming the next step', () => {
    const lostRow = { ...pipelineRow, status: 'Loss Tender' } as unknown as ProjectWithRefs;
    renderLens(lostRow);
    // Terminal lost copy — the gate notice names the outcome
    expect(screen.getByText(/marked lost/i)).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-18: "Back to Sales Pipeline" link uses text-primary + hover:underline (One Blue, no solid fill)', () => {
    renderLens();
    const link = screen.getByRole('link', { name: /back to sales pipeline/i });
    // Token-compliant: text-primary link style (no btn-primary class which would be a solid blue button)
    expect(link.className).toMatch(/text-primary/);
    // Must not be a solid primary button
    expect(link.className).not.toMatch(/bg-primary\b/);
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
    const journey = screen.getByRole('list', { name: /Deal stage journey/i });
    expect(within(journey).getByText('Pre-Qualification')).toBeInTheDocument();
  });
});
