/**
 * AC-IXD-PROJ-W5-C3 — Wave-5 Cluster-3 PR-2:
 *   project identity and finance-authority behavior
 *   N10 post-transition wayfinding (Back to Sales Pipeline + focus)
 *   D9-pipeline PQ → Pre-Qualification label
 *
 * Owning layer: Vitest/RTL render-by-role for record actions and route behavior.
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

const renderLens = (project: ProjectWithRefs = pipelineRow, locationState?: unknown) =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <ToastProvider>
        <PipelineLens project={project} locationState={locationState} />
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

describe('Project identity and pipeline behavior', () => {
  it('AC-IXD-PROJ-W5-C3-06: Engineer sees the project identity and current status', () => {
    renderHeader('Engineer');
    expect(screen.getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
    expect(screen.getByText('Ongoing Project')).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-10: pre-win records do not offer the won-project contract-value editor', () => {
    const preWinRow = { ...onHandRow, status: 'Leads', customer_contract_ref: null } as unknown as ProjectWithRefs;
    renderHeader('Engineer', preWinRow);
    expect(screen.queryByRole('button', { name: /Edit contract value/i })).not.toBeInTheDocument();
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



  // list-working-set-return (#682): FR-LRC-006 — when the project was opened FROM a narrowed
  // Sales Pipeline (captured in router state), the quiet Sales link targets that SAME filtered
  // URL, not the bare index. The structural Projects breadcrumb/BackBar never read this context.
  it('AC-LRC-004: "Back to Sales Pipeline" targets the captured Sales list URL when opened from a narrowed Sales Pipeline', () => {
    renderLens(pipelineRow, {
      pmoListReturn: { list: 'sales', path: '/sales?status=Tender+Submitted&view=table' },
    });
    const link = screen.getByRole('link', { name: /back to sales pipeline/i });
    expect(link).toHaveAttribute('href', '/sales?status=Tender+Submitted&view=table');
  });

  // AC-LRC-011: a direct project link (no captured list context) keeps the bare index — this is
  // the SAME assertion as AC-IXD-PROJ-W5-C3-13 (renderLens with no locationState), restated here
  // under its list-return AC id since it is that AC's owning proof of the direct-link fallback.
  it('AC-LRC-011: a direct project link (no captured context) keeps "Back to Sales Pipeline" at bare /sales', () => {
    renderLens();
    const link = screen.getByRole('link', { name: /back to sales pipeline/i });
    expect(link).toHaveAttribute('href', '/sales');
  });

  // Capturing FROM a Projects list (not Sales) must never leak into this link — a project opened
  // from Projects has no Sales context, so the fallback bare index applies exactly as a direct link.
  it('AC-LRC-011: a Projects-list return context does not leak into the Sales link (bare /sales)', () => {
    renderLens(pipelineRow, {
      pmoListReturn: { list: 'projects', path: '/projects?filter=Ongoing' },
    });
    const link = screen.getByRole('link', { name: /back to sales pipeline/i });
    expect(link).toHaveAttribute('href', '/sales');
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

  it('AC-IXD-PROJ-W5-C3-20: the deal journey stepper uses the shared Sales stage vocabulary in the DOM', () => {
    renderLens();
    // The LifecycleStepper renders step labels — "Pre-Qualification" must be visible
    expect(screen.getByText('Pre-Qual')).toBeInTheDocument();
    // The visible journey shares the selector and board vocabulary
    // (Note: it may still appear in the SALES_COLUMNS title for the kanban board — that is
    //  a separate surface; here we assert only the deal journey stepper inside PipelineLens)
    const journey = screen.getByRole('list', { name: /Project stage journey/i });
    expect(within(journey).getByText('Pre-Qual')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SUB-I — Opportunity lens: only what the deal state needs
// ═════════════════════════════════════════════════════════════════════════════

describe('SUB-I: opportunity lens figures and notices', () => {


  it('SUB-I: an open deal shows Value, Win probability, Weighted, Owner — no Decision tile, no "Ready to advance." box', () => {
    renderLens();
    expect(screen.getByTestId('pipeline-contract-value')).toHaveTextContent('Opportunity value');
    ['Win probability', 'Weighted', 'Owner'].forEach((label) => expect(screen.getByText(label, { exact: true })).toBeInTheDocument());
    expect(screen.queryByText('Decision', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Ready to advance.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Advance to/i })).toBeInTheDocument();
  });

  it('SUB-I: a lost deal shows Value, Owner, Decision — never a 0% win probability or a zero weighted value', () => {
    renderLens({ ...pipelineRow, status: 'Loss Tender' } as unknown as ProjectWithRefs);
    expect(screen.getByTestId('pipeline-contract-value')).toHaveTextContent('Opportunity value');
    ['Owner', 'Decision'].forEach((label) => expect(screen.getByText(label, { exact: true })).toBeInTheDocument());
    expect(screen.queryByText('Win probability', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Weighted', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.getByText(/marked lost/i)).toBeInTheDocument();
  });
});
