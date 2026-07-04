/**
 * Enforcement guard — record pages render advance/decide verbs through RecordActionZone.
 *
 * These are the ANTI-REGRESSION tests. Each record page that has an advance/approve
 * action MUST render it inside a `data-testid="record-action-zone"` element. If a
 * future record forks the verb into an ad-hoc placement, these tests fail.
 *
 * Covered pages:
 *   1. ProcurementDetails — the "Approve" / "Submit Request" / lifecycle actions
 *   2. IncidentDetail — the "Start Investigating" / "Close Incident" advance button
 *   3. PipelineLens (pre-win) — the "Advance" / "Mark won" / "Mark lost" buttons
 *
 * ProjectDetail (delivery) has no delivery-advance verb at the record level
 * (delivery progress is tracked via tasks/milestone stepper, not a status button),
 * so it is intentionally omitted from this enforcement guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../../components/ui';
import { ImpersonationProvider } from '../../../auth/impersonation';

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

// ─────────────────────────────────────────────────────────────────────────────
// 1. ProcurementDetails
// ─────────────────────────────────────────────────────────────────────────────

const { procDetailState, procMutations } = vi.hoisted(() => ({
  procDetailState: {
    data: undefined as Record<string, unknown> | null | undefined,
    isPending: false,
    isError: false,
    error: null as (Error & { code?: string }) | null,
    refetch: vi.fn(),
  },
  procMutations: {
    transition: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    createQuotation: { mutateAsync: vi.fn(), isPending: false },
    createReceipt: { mutateAsync: vi.fn(), isPending: false },
    createInvoice: { mutateAsync: vi.fn(), isPending: false },
    captureVendorInvoice: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => procDetailState,
  useProcurementMutations: () => procMutations,
}));
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useProcurementCrudMutations: () => ({
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    createItem: { mutateAsync: vi.fn(), isPending: false },
    updateItem: { mutateAsync: vi.fn(), isPending: false },
    deleteItem: { mutateAsync: vi.fn(), isPending: false },
    selectQuote: { mutateAsync: vi.fn(), isPending: false },
    createDocument: { mutateAsync: vi.fn(), isPending: false },
    deleteDocument: { mutateAsync: vi.fn(), isPending: false },
  }),
  useProcurementDocuments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/auth/impersonation', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) };
});
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Admin' }),
}));
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 1000000, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));
vi.mock('@/pages/procurement/ProcurementFilesSubsection', () => ({
  ProcurementFilesSubsection: () => null,
}));

const procRecord = {
  id: 'pr1',
  title: 'Office Supplies',
  code: 'PR-001',
  pr_number: 'PR-001',
  status: 'Draft',
  total_value: '5000',
  project_id: 'p1',
  project: { name: 'HQ Fit-Out' },
  vendor_id: null,
  vendor: null,
  po_number: null,
  vq_number: null,
  requested_by_id: 'u-other',
  requested_by: { full_name: 'Other User' },
  approved_by_id: null,
  approval_notes: null,
  rejection_notes: null,
  items: [{ id: 'li1', name: 'Desk', qty: 1, unit_price: '5000', total_price: '5000' }],
  quotations: [],
  receipts: [],
  invoices: [],
};

import ProcurementDetails from '../../../../pages/ProcurementDetails';

describe('Enforcement: ProcurementDetails renders advance verbs through RecordActionZone', () => {
  beforeEach(() => {
    procDetailState.data = procRecord;
    procDetailState.isPending = false;
    procDetailState.isError = false;
  });

  it('AC-ENFORCE-PROC: the lifecycle action buttons live inside data-testid="record-action-zone"', () => {
    const qc = makeClient();
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/procurement/pr1']}>
            <Routes>
              <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    // The decision-card (and its action buttons) must live within the RecordActionZone.
    const zone = screen.getByTestId('record-action-zone');
    expect(zone).toBeInTheDocument();
    // The Submit Request primary action is inside the zone.
    const submitBtn = within(zone).getByRole('button', { name: /Submit Request/i });
    expect(submitBtn).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. IncidentDetail
// ─────────────────────────────────────────────────────────────────────────────

const { incidentState, incidentMutations } = vi.hoisted(() => ({
  incidentState: {
    data: undefined as Record<string, unknown> | null | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  incidentMutations: {
    update: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    transition: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  },
}));

vi.mock('@/src/hooks/useIncidents', () => ({
  useIncident: () => incidentState,
  useIncidentMutations: () => incidentMutations,
}));

// IncidentDetail resolves the linked project's name via the project FK options. Partial-mock
// (keep the other FK-option hooks real for ProcurementDetails) — IncidentDetail is rendered
// without a QueryClientProvider, so its useProjectOptions is stubbed to a resolved empty list.
vi.mock('@/src/hooks/useFkOptions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useProjectOptions: () => ({ data: [] }) };
});

const incidentRecord = {
  id: 'i1',
  org_id: 'org-1',
  incident_date: '2026-03-15',
  type: 'Near Miss',
  severity: 'High',
  location: 'Site A',
  description: 'Slip hazard',
  status: 'Open',
  reported_by: 'u1',
  created_at: '2026-03-15T00:00:00Z',
};

import IncidentDetail from '../../../../pages/IncidentDetail';

describe('Enforcement: IncidentDetail renders advance verbs through RecordActionZone', () => {
  beforeEach(() => {
    incidentState.data = incidentRecord;
    incidentState.isPending = false;
    incidentState.isError = false;
  });

  it('AC-ENFORCE-INC: the incident advance button lives inside data-testid="record-action-zone"', () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/incidents/i1']}>
          <Routes>
            <Route path="/incidents/:incidentId" element={<IncidentDetail />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    const zone = screen.getByTestId('record-action-zone');
    expect(zone).toBeInTheDocument();
    // The advance action ("Start Investigating") must be inside the zone.
    const advanceBtn = within(zone).getByTestId('incident-advance');
    expect(advanceBtn).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. PipelineLens
// ─────────────────────────────────────────────────────────────────────────────

const { pipelineMock, pipelineTransitionMock } = vi.hoisted(() => ({
  pipelineMock: {
    data: {
      stages: [],
      projects: [
        {
          id: 'd1',
          name: 'Acme Deal',
          status: 'Tender Submitted',
          contract_value: 1000000,
          win_probability: 0.5,
        },
      ],
    },
  },
  pipelineTransitionMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => pipelineMock }));
vi.mock('@/src/lib/db/projectTransitions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, transitionProject: pipelineTransitionMock };
});
vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

const pipelineProject = {
  id: 'd1',
  name: 'Acme Deal',
  code: 'OPP-001',
  status: 'Tender Submitted',
  client_id: 'c1',
  project_manager_id: 'u1',
  contract_value: 1000000,
  budget: 0,
  spent: 0,
  start_date: null,
  end_date: null,
  contract_date: null,
  decided_at: null,
  customer_contract_ref: null,
  client: { name: 'Acme' },
  pm: { full_name: 'PM User' },
} as never;

import PipelineLens from '../../../../pages/project-detail/PipelineLens';

describe('Enforcement: PipelineLens renders advance verbs through RecordActionZone', () => {
  it('AC-ENFORCE-PIPE: Advance / Mark won / Mark lost buttons live inside data-testid="record-action-zone"', () => {
    render(
      <ImpersonationProvider realRole="Project Manager">
        <ToastProvider>
          <PipelineLens project={pipelineProject} />
        </ToastProvider>
      </ImpersonationProvider>,
    );
    const zone = screen.getByTestId('record-action-zone');
    expect(zone).toBeInTheDocument();
    // The primary action buttons must live inside the zone.
    expect(within(zone).getByRole('button', { name: /Advance to/i })).toBeInTheDocument();
    expect(within(zone).getByRole('button', { name: /Mark won/i })).toBeInTheDocument();
    expect(within(zone).getByRole('button', { name: /Mark lost/i })).toBeInTheDocument();
  });
});
