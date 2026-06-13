/**
 * AC-EXP-008: Companies, Incidents, Procurement, and SalesPipeline each render a live
 * (enabled) Export button in their toolbar when data is available, and the SalesPipeline
 * Export is no longer the disabled "arrives with Reports" stub.
 *
 * AC-EXP-005 (page-level): the Export button in each page is enabled (not disabled) when
 * the page has data.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

// ── Mock exportToXlsx so no file download happens in tests ──────────────────
vi.mock('@/src/lib/export/exportToXlsx', () => ({
  exportToXlsx: vi.fn().mockResolvedValue(undefined),
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
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
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

beforeAll(async () => {
  ({ default: Companies } = await import('../Companies'));
  ({ default: Incidents } = await import('../Incidents'));
  ({ default: ProcurementPage } = await import('../Procurement'));
  ({ default: SalesPipeline } = await import('../SalesPipeline'));
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
});
