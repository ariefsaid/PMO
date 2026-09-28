/**
 * AC-LRC-012 — empty collection vs. zero matches, for all six adopting lists (Projects, Sales,
 * Procurement, Companies, Contacts, Meetings). Each list must distinguish:
 *   - the GENUINE empty state (the collection itself has no rows) — its existing copy + create
 *     action, no clear-filter action (there is nothing to clear);
 *   - a FILTERED ZERO-MATCH state (rows exist, but the active search/filter excludes all of
 *     them) — distinct copy plus a "Clear filters" action that restores the rows.
 *
 * `list-working-set-return` (#683). See `docs/specs/list-working-set-return.spec.md` FR-LRC-007.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

// ── Shared hoisted fixture state, one object per entity the six pages read. ──────────────────
const {
  companiesState,
  contactsState,
  meetingsState,
  projectsState,
  pipelineState,
  lostState,
  procurementsState,
} = vi.hoisted(() => ({
  companiesState: { data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn() },
  contactsState: { data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn() },
  meetingsState: { data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn() },
  projectsState: { data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn() },
  pipelineState: {
    data: { stages: [], projects: [] } as { stages: unknown[]; projects: Array<Record<string, unknown>> },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  lostState: { data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn() },
  procurementsState: { data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn() },
}));

const noopMutations = () => ({
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
});

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
// Projects' table row status control needs a QueryClientProvider this suite doesn't mount —
// stubbed exactly as pages/__tests__/Projects.atRiskFilter.test.tsx does (rendering, not status
// transitions, is under test here).
vi.mock('../../components/ProjectStatusControl', () => ({ default: () => null }));

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => companiesState,
  useCompanyMutations: () => ({
    create: noopMutations(),
    update: noopMutations(),
    archive: noopMutations(),
    remove: noopMutations(),
  }),
}));

vi.mock('@/src/hooks/useContacts', () => ({
  useContacts: () => contactsState,
  useContactMutations: () => ({
    create: noopMutations(),
    update: noopMutations(),
    archive: noopMutations(),
    remove: noopMutations(),
  }),
}));

vi.mock('@/src/hooks/useMeetings', () => ({
  // Meetings' project/search narrowing is a SERVER query (DD-MTG-5) — simulate that so a
  // filtered-to-zero result is observable through the rendered page, not just a spy call.
  useMeetings: (params: { projectId?: string; search?: string } = {}) => ({
    ...meetingsState,
    data: params.projectId || params.search ? [] : meetingsState.data,
  }),
  useMeetingMutations: () => ({
    create: noopMutations(),
    archive: noopMutations(),
    remove: noopMutations(),
  }),
}));

// `@/src/hooks/useProjects` is read by Meetings (project filter options), Projects (its own rows
// + filter option lists) and SalesPipeline (create mutation + filter option lists) — one merged
// mock satisfies every caller (compatible shapes, no caller-specific behavior needed).
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
  useProjectsMilestoneDates: () => ({ data: [], isPending: false }),
  useProjectMutations: () => ({
    create: noopMutations(),
    updateHeader: noopMutations(),
    update: noopMutations(),
    archive: noopMutations(),
  }),
}));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => ({ data: {}, isPending: false, isError: false }),
}));

vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => pipelineState,
  useLostDeals: () => lostState,
}));
// usePipelineView/useProcurementView stay REAL (sessionStorage-backed, cleared in beforeEach) —
// Procurement's real default is already 'table'; SalesPipeline's real default is 'kanban', so
// its own test clicks the Table toggle first.

vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procurementsState }));
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => noopMutations(),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }),
}));

import Companies from '../Companies';
import Contacts from '../Contacts';
import Meetings from '../Meetings';
import Projects from '../Projects';
import SalesPipeline from '../SalesPipeline';
import Procurement from '../Procurement';

const CLIENT_CO = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';

const renderList = (Page: React.ComponentType, role = 'Admin') =>
  render(
    <ImpersonationProvider realRole={role as never}>
      <MemoryRouter>
        <ToastProvider>
          <Page />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  companiesState.data = [];
  companiesState.isPending = false;
  companiesState.isError = false;
  contactsState.data = [];
  contactsState.isPending = false;
  contactsState.isError = false;
  meetingsState.data = [];
  meetingsState.isPending = false;
  meetingsState.isError = false;
  projectsState.data = [];
  projectsState.isPending = false;
  projectsState.isError = false;
  pipelineState.data = { stages: [], projects: [] };
  pipelineState.isPending = false;
  pipelineState.isError = false;
  lostState.data = [];
  lostState.isPending = false;
  lostState.isError = false;
  procurementsState.data = [];
  procurementsState.isPending = false;
  procurementsState.isError = false;
});

// ── Companies ──────────────────────────────────────────────────────────────────────────────
describe('AC-LRC-012 — Companies', () => {
  it('a genuinely empty collection shows the create-first-record copy, no Clear filters action', () => {
    companiesState.data = [];
    renderList(Companies);
    expect(screen.getByText(/No companies yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /New company/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: /Clear filters/i })).not.toBeInTheDocument();
  });

  it('a filtered zero-match shows distinct copy + Clear filters, which restores the rows', async () => {
    companiesState.data = [
      { id: CLIENT_CO, name: 'Cascade Port Authority', type: 'Client', org_id: 'org-1', archived_at: null },
    ];
    renderList(Companies);
    await userEvent.type(screen.getByLabelText(/Search companies/i), 'no-such-company');
    expect(await screen.findByText(/No companies match your filters/i)).toBeInTheDocument();
    const clear = screen.getByRole('button', { name: /Clear filters/i });
    await userEvent.click(clear);
    expect(screen.getByText('Cascade Port Authority')).toBeInTheDocument();
  });
});

// ── Contacts ───────────────────────────────────────────────────────────────────────────────
describe('AC-LRC-012 — Contacts', () => {
  it('a genuinely empty collection shows the create-first-record copy, no Clear filters action', () => {
    contactsState.data = [];
    companiesState.data = [];
    renderList(Contacts);
    expect(screen.getByText(/No contacts yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add your first contact/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clear filters/i })).not.toBeInTheDocument();
  });

  it('a filtered zero-match shows distinct copy + Clear filters, which restores the rows', async () => {
    companiesState.data = [{ id: CLIENT_CO, name: 'Cascade Port Authority', type: 'Client' }];
    contactsState.data = [
      { id: 'ct1', full_name: 'Jane Doe', company_id: CLIENT_CO, title: null, email: null, phone: null, notes: null, archived_at: null },
    ];
    renderList(Contacts);
    await userEvent.type(screen.getByLabelText(/Search contacts/i), 'no-such-contact');
    expect(await screen.findByText(/No contacts match your filters/i)).toBeInTheDocument();
    const clear = screen.getByRole('button', { name: /Clear filters/i });
    await userEvent.click(clear);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });
});

// ── Meetings ───────────────────────────────────────────────────────────────────────────────
describe('AC-LRC-012 — Meetings', () => {
  it('a genuinely empty collection shows the create-first-record copy, no Clear filters action', () => {
    meetingsState.data = [];
    projectsState.data = [];
    renderList(Meetings);
    expect(screen.getByText('No meetings yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /New meeting/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: /Clear filters/i })).not.toBeInTheDocument();
  });

  it('a filtered (server) zero-match shows distinct copy + Clear filters, which restores the rows', async () => {
    projectsState.data = [{ id: PROJECT_ID, name: 'Harbour Upgrade' }];
    meetingsState.data = [
      { id: 'm1', title: 'Kickoff', occurred_at: '2026-08-20T09:00:00Z', location: null, project_id: null, project: null, created_by_id: 'u1', archived_at: null, notes: [] },
    ];
    renderList(Meetings);
    await userEvent.selectOptions(screen.getByLabelText(/Filter by project/i), PROJECT_ID);
    expect(await screen.findByText(/No meetings match/i)).toBeInTheDocument();
    const clear = screen.getByRole('button', { name: /Clear filters/i });
    await userEvent.click(clear);
    expect(await screen.findByText('Kickoff')).toBeInTheDocument();
  });
});

// ── Projects ───────────────────────────────────────────────────────────────────────────────
describe('AC-LRC-012 — Projects', () => {
  it('a genuinely empty collection shows the create-first-record copy, no Clear filters action', () => {
    projectsState.data = [];
    renderList(Projects);
    expect(screen.getByText(/No projects yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^New project$/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: /Clear filters/i })).not.toBeInTheDocument();
  });

  it('a filtered zero-match shows distinct copy + Clear filters, which restores the rows', async () => {
    projectsState.data = [
      { id: 'p1', name: 'Harbour Upgrade', code: 'P-001', status: 'Ongoing Project', project_manager_id: 'pm-1', client_id: 'c1', contract_value: 100000, currency: 'USD', budget: 80000, spent: 10000, customer_contract_ref: null, client: { id: 'c1', name: 'Acme' }, pm: { id: 'pm-1', full_name: 'Alice PM' } },
    ];
    renderList(Projects);
    await userEvent.type(screen.getByLabelText(/Search projects/i), 'no-such-project');
    expect(await screen.findByText(/No projects match these filters/i)).toBeInTheDocument();
    const clear = screen.getByRole('button', { name: /Clear filters/i });
    await userEvent.click(clear);
    expect(await screen.findByText('Harbour Upgrade')).toBeInTheDocument();
  });
});

// ── Sales Pipeline ─────────────────────────────────────────────────────────────────────────
describe('AC-LRC-012 — Sales Pipeline', () => {
  it('a genuinely empty collection (no open AND no lost deals) shows the empty copy, no Clear filters action', () => {
    pipelineState.data = { stages: [], projects: [] };
    lostState.data = [];
    renderList(SalesPipeline);
    expect(screen.getByText(/No projects yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clear filters/i })).not.toBeInTheDocument();
  });

  it('a filtered zero-match shows distinct copy + Clear filters, which restores the rows', async () => {
    pipelineState.data = {
      stages: [],
      projects: [
        { id: 'op1', name: 'Northwind ERP', client_name: 'Northwind', status: 'Tender Submitted', contract_value: 100000, currency: 'USD', win_probability: 0.5 },
      ],
    };
    lostState.data = [];
    renderList(SalesPipeline);
    // SalesPipeline's real default view is 'kanban' — switch to Table to see the zero-match state.
    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    await userEvent.type(screen.getByLabelText(/Search projects/i), 'no-such-deal');
    expect(await screen.findByText(/No projects match your search/i)).toBeInTheDocument();
    const clear = screen.getByRole('button', { name: /Clear filters/i });
    await userEvent.click(clear);
    expect(await screen.findByText('Northwind ERP')).toBeInTheDocument();
  });
});

// ── Procurement ────────────────────────────────────────────────────────────────────────────
describe('AC-LRC-012 — Procurement', () => {
  it('a genuinely empty collection shows the create-first-record copy, no Clear filters action', () => {
    procurementsState.data = [];
    renderList(Procurement);
    expect(screen.getByText(/No purchase requests yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Raise request/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: /Clear filters/i })).not.toBeInTheDocument();
  });

  it('a filtered zero-match shows distinct copy + Clear filters, which restores the rows', async () => {
    procurementsState.data = [
      { id: 'pr1', title: 'Crane hire', code: 'PR-001', status: 'Requested', total_value: 5000, currency: 'USD', created_at: '2026-06-01T00:00:00Z', project: { name: 'Harbour' }, requested_by_id: 'u1', requested_by: { full_name: 'Alice' } },
    ];
    renderList(Procurement);
    await userEvent.type(screen.getByLabelText(/Filter requests/i), 'no-such-request');
    expect(await screen.findByText(/No requests match your filters/i)).toBeInTheDocument();
    const clear = screen.getByRole('button', { name: /Clear filters/i });
    await userEvent.click(clear);
    expect(await screen.findByText('Crane hire')).toBeInTheDocument();
  });
});
