/**
 * AC-EXP-008 (in-page wiring): Companies, Incidents, Procurement, and SalesPipeline each
 * render a live (enabled) Export button in their toolbar when data is available. The
 * canonical AC-EXP-008 stub-gone proof lives in SalesPipeline.export.test.tsx; this file
 * confirms the shared <ExportButton> is wired into every v1 page's toolbar.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

// ── Stub the export seam so no real serialization/download happens in tests ──
vi.mock('@/src/components/export/useExport', () => ({
  useExport: () => ({ exportXlsx: vi.fn(), busy: false }),
}));

// ── Shared mocks ─────────────────────────────────────────────────────────────
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-admin', org_id: 'org-1' }, role: 'Admin' }),
}));

// ── Companies mocks ──────────────────────────────────────────────────────────
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({
    data: [{ id: '1', name: 'Acme', type: 'Client' }],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCompanyMutations: () => ({
    create: { mutateAsync: vi.fn() },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

// ── Incidents mocks ──────────────────────────────────────────────────────────
vi.mock('@/src/hooks/useIncidents', () => ({
  useIncidents: () => ({
    data: [
      {
        id: 'i1',
        type: 'Slip',
        severity: 'Low',
        status: 'Open',
        incident_date: '2026-01-01',
        location: 'Site A',
        description: '',
      },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useIncidentMutations: () => ({
    create: { mutateAsync: vi.fn() },
    update: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

// ── Procurement mocks ──────────────────────────────────────────────────────
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({
    data: [
      {
        id: 'p1',
        title: 'Widgets',
        code: 'PR-001',
        status: 'Draft',
        total_value: 5000,
        created_at: '2026-01-01T00:00:00Z',
        project: { name: 'Project A' },
        requested_by: { full_name: 'Alice', id: 'u1' },
        requested_by_id: 'u1',
      },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useProcurementView', () => ({
  useProcurementView: () => ['table', vi.fn()],
}));

// ── SalesPipeline mocks ───────────────────────────────────────────────────────
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({
    data: {
      stages: [],
      projects: [
        {
          id: 'sp1',
          name: 'Deal 1',
          client_name: 'Client A',
          status: 'Qualified',
          contract_value: 10000,
          win_probability: 0.5,
        },
      ],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useLostDeals: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/usePipelineView', () => ({
  usePipelineView: () => ['table', vi.fn()],
}));
// ── Projects mocks ────────────────────────────────────────────────────────────
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({
    data: [
      { id: 'p1', name: 'Alpha Build', code: 'PRJ-001', status: 'Ongoing Project',
        client_id: 'c1', project_manager_id: 'u1', contract_value: 1_000_000,
        budget: 900_000, spent: 500_000, end_date: null, client: { name: 'Acme' },
        pm: { full_name: 'Alice PM' }, customer_contract_ref: null,
        contract_date: null, decided_at: null },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
  useProjectsMilestoneDates: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjectView', () => ({ useProjectView: () => ['table', vi.fn()] }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => ({ data: {} }),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
  usePipelineStageConfig: () => ({ data: [], isSuccess: true }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  ImpersonationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useEffectiveRole: () => ({ effectiveRole: 'Admin', realRole: 'Admin', canImpersonate: false, viewAs: vi.fn() }),
}));

// ── render helper ─────────────────────────────────────────────────────────────
const wrap = (ui: React.ReactElement) =>
  render(
    <ImpersonationProvider realRole="Admin">
      <MemoryRouter>
        <ToastProvider>{ui}</ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

// ── lazy page imports (dynamic import avoids circular-ref issues in test isolation)
let Companies: React.ComponentType;
let Incidents: React.ComponentType;
let ProcurementPage: React.ComponentType;
let SalesPipeline: React.ComponentType;
let ProjectsPage: React.ComponentType;

beforeAll(async () => {
  ({ default: Companies } = await import('../Companies'));
  ({ default: Incidents } = await import('../Incidents'));
  ({ default: ProcurementPage } = await import('../Procurement'));
  ({ default: SalesPipeline } = await import('../SalesPipeline'));
  ({ default: ProjectsPage } = await import('../Projects'));
});

describe('Page-level Export button integration (AC-EXP-008)', () => {
  it('AC-EXP-008: Companies page renders a live (enabled) Export button', () => {
    wrap(<Companies />);
    const btn = screen.getByRole('button', { name: /export/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('AC-EXP-008: Incidents page renders a live (enabled) Export button', () => {
    wrap(<Incidents />);
    const btn = screen.getByRole('button', { name: /export/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('AC-EXP-008: Procurement page renders a live (enabled) Export button', () => {
    wrap(<ProcurementPage />);
    const btn = screen.getByRole('button', { name: /export/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('AC-EXP-008: SalesPipeline Export is now a live button, not the disabled Reports stub', () => {
    wrap(<SalesPipeline />);
    const btn = screen.getByRole('button', { name: /export/i });
    expect(btn).toBeInTheDocument();
    // Key assertion: it must be ENABLED (not the disabled "arrives with Reports" stub)
    expect(btn).not.toBeDisabled();
  });

  it('AC-EXP-008: Projects page renders a live (enabled) Export button', () => {
    wrap(<ProjectsPage />);
    const btn = screen.getByRole('button', { name: /export/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });
});
