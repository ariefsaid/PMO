import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import 'jest-axe/extend-expect'; // global registration moved out of test/setup.ts (unit-speed #1584)
import React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider, useToast } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import { BahasaProvider } from '@/test/bahasa';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { BudgetActivationPrecheckResult } from '@/src/lib/budget/budgetGate';

// ---------------------------------------------------------------------------
// Mutable mock state (mirrors Procurement.test.tsx pattern)
// ---------------------------------------------------------------------------
const budgetState = {
  data: undefined as number | undefined,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
const versionsState = {
  data: undefined as unknown[] | undefined,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
const budgetDistributionState = {
  data: null as unknown,
  isPending: false,
  isFetching: false,
  isError: false,
  refetch: vi.fn(),
};
const activationModeState = { data: 'allowed' as string | undefined, isPending: false, isFetching: false, isError: false };
const readyActivationPrecheck: BudgetActivationPrecheckResult = {
  status: 'ready',
  erpCheck: 'available',
  fiscalYearNames: ['2026', '2027'],
  fiscalYears: [
    { name: '2026', start: '2026-01-01', end: '2026-12-31' },
    { name: '2027', start: '2027-01-01', end: '2027-12-31' },
  ],
  issues: [],
};
const activationPrecheckState: {
  data: BudgetActivationPrecheckResult | null;
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = {
  data: readyActivationPrecheck,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
const archiveTargetsState = {
  data: [] as Array<Record<string, unknown>>,
  refetch: vi.fn(),
};
// #1462 — the archive DIALOG's inventory now comes from the server RPC, not from the banner read.
const mockListArchiveTargets = vi.hoisted(() => vi.fn().mockResolvedValue([]));
archiveTargetsState.refetch.mockImplementation(() => Promise.resolve({ data: archiveTargetsState.data, error: null }));
const positionState = { isPending: false, isError: false, refetch: vi.fn(), hasBudget: true, canSeeActual: true, rows: [] as unknown[], unknown: 0 };
const procurementsState = { data: [] as unknown[], isPending: false, isError: false };
const budgetPushState = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
const mockBudgetRepository = vi.hoisted(() => ({ getDistribution: vi.fn().mockResolvedValue(null), createLineItem: vi.fn() }));
const mockRefreshBudgetQueries = vi.hoisted(() => vi.fn());

const mockActivate = vi.fn().mockResolvedValue({ pushState: 'queued' });
const mockArchive = vi.fn().mockResolvedValue({ cancelErp: false, liveTargetCount: 0, queuedCount: 0 });
const mockReturn = vi.fn().mockResolvedValue(undefined);
const mockResubmit = vi.fn().mockResolvedValue(undefined);
const mockClone = vi.fn().mockResolvedValue('v-clone');
const mockDeleteDraft = vi.fn().mockResolvedValue(undefined);
const mockCreateVersion = vi.fn().mockResolvedValue({ id: 'v-new' });
const mockCreateLineItem = vi.fn().mockResolvedValue({ id: 'li-new' });
const mockDeleteLineItem = vi.fn().mockResolvedValue(undefined);
const mockUpdateLineItem = vi.fn().mockResolvedValue(undefined);
const mockSwitchBudgetDraftMode = vi.fn().mockResolvedValue(undefined);
const mockSaveBudgetDistribution = vi.fn().mockResolvedValue(undefined);

vi.mock('@/src/hooks/useBudget', () => ({
  refreshBudgetQueries: (...args: unknown[]) => mockRefreshBudgetQueries(...args),
  useProjectBudget: () => budgetState,
  useBudgetVersions: () => versionsState,
  // Like the real hook: disabled (no data) without a version id.
  useBudgetDistribution: (_projectId: string, versionId?: string) => (versionId ? budgetDistributionState : { ...budgetDistributionState, data: undefined }),
  useBudgetActivationMode: () => activationModeState,
  useBudgetActivationPrecheck: () => activationPrecheckState,
  useBudgetArchiveTargets: () => archiveTargetsState,
  useBudgetMutations: () => ({
    createVersion: { mutateAsync: mockCreateVersion, isPending: false },
    cloneVersion: { mutateAsync: mockClone, isPending: false },
    activate: { mutateAsync: mockActivate, isPending: false },
    archive: { mutateAsync: mockArchive, isPending: false },
    returnVersion: { mutateAsync: mockReturn, isPending: false },
    resubmitVersion: { mutateAsync: mockResubmit, isPending: false },
    deleteDraft: { mutateAsync: mockDeleteDraft, isPending: false },
    createLineItem: { mutateAsync: mockCreateLineItem, isPending: false },
    updateLineItem: { mutateAsync: mockUpdateLineItem, isPending: false },
    deleteLineItem: { mutateAsync: mockDeleteLineItem, isPending: false },
    switchDraftMode: { mutateAsync: mockSwitchBudgetDraftMode, isPending: false },
    saveDistribution: { mutateAsync: mockSaveBudgetDistribution, isPending: false },
  }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProjectProcurements: () => procurementsState }));
vi.mock('@/src/hooks/useProjectPosition', () => ({ useBudgetPosition: () => positionState }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [], isPending: false }) }));
vi.mock('@/src/hooks/useErpnextBinding', () => ({ useErpnextBinding: () => ({ data: { status: 'active' }, isPending: false }) }));
vi.mock('@/src/lib/repositories/budgetProjection', () => ({
  fetchActiveBudgetCategoryPhasing: vi.fn().mockResolvedValue({ years: {}, unphased: {} }),
  fetchBudgetComparison: vi.fn().mockResolvedValue([]),
  fetchBudgetProjection: vi.fn().mockResolvedValue([]),
  fetchBudgetPushStatus: () => Promise.resolve(budgetPushState.rows),
  fetchProjectFiscalCalendar: vi.fn().mockResolvedValue({ status: 'bad-project-dates', project: { start: null, end: null } }),
  listBudgetFiscalYears: vi.fn().mockResolvedValue([]),
  upsertBudgetProjectionEtc: vi.fn().mockResolvedValue(undefined),
  retryActiveBudgetPush: vi.fn(),
  releaseActiveBudgetPushHold: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    // #2065: a failed ledger-mode read now shows a notice, so the connection read must resolve (org not on Odoo).
    odoo: { getConnection: () => Promise.resolve(null) },
    budget: {
      ...mockBudgetRepository,
      listArchiveTargets: (...args: unknown[]) => mockListArchiveTargets(...args),
    },
  },
}));
vi.mock('@/src/components/m365/BudgetDocumentLinks', () => ({
  BudgetDocumentLinks: ({ versionId }: { versionId: string }) => <div data-testid={`evidence-${versionId}`}>Evidence documents</div>,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
const roleState: { realRole: string; effectiveRole?: string } = { realRole: 'Project Manager' };
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole: roleState.effectiveRole ?? roleState.realRole,
    realRole: roleState.realRole,
    canImpersonate: false,
    viewAs: vi.fn(),
  }),
}));

import ProjectBudget from './ProjectBudget';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';

// The toast library's store replays still-active toasts into the next provider — clear them.
afterEach(() => {
  act(() => { sonnerToast.dismiss(); });
});


const EN_LOCALE = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID_LOCALE = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

const project = { id: 'p-1', currency: 'USD', tax_treatment: 'exclusive', start_date: '2026-01-01', end_date: '2027-12-31' } as unknown as ProjectWithRefs;
const renderPage = (projectId = 'p-1') => {
  const result = render(
    <FinanceI18nTestProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <ToastProvider>
            <ProjectBudget projectId={projectId} project={project} />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </FinanceI18nTestProvider>
  );
  // Existing lifecycle/editor proofs exercise the line editor itself. The new composed tab keeps it
  // behind the draft banner, so open that disclosure for this behavior-focused suite.
  if (versionsState.data?.some((version) => (version as { status?: string }).status === 'Draft')) {
    const editDraft = screen.queryByRole('button', { name: /^(Edit draft|Ubah draf)$/i });
    if (editDraft) fireEvent.click(editDraft);
  }
  return result;
};

const UnresolvedErrorToast: React.FC = () => {
  const { toast } = useToast();
  return <button onClick={() => toast('Unresolved error', 'Retry the failed operation', 'error')}>Show unresolved error</button>;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const draftVersion = {
  id: 'v-draft',
  status: 'Draft' as const,
  name: 'Draft v2',
  version: 2,
  project_id: 'p-1',
  org_id: 'org-1',
  currency: 'USD',
  created_at: '2026-01-01T00:00:00Z',
  // OD-BUDGET-6: drafted by someone other than the signed-in user (u1), so u1 may activate it.
  created_by: 'u2' as string | null,
  activation_basis: null,
  line_items: [
    {
      id: 'li-1',
      budget_version_id: 'v-draft',
      category: 'Labor',
      description: 'Developers',
      budgeted_amount: 200000,
      actual_amount: 0,
      org_id: 'org-1',
    },
  ],
  total: 200000,
};

const activeVersion = {
  id: 'v-active',
  status: 'Active' as const,
  name: 'Version 1',
  version: 1,
  budget_mode: 'per_year',
  project_id: 'p-1',
  org_id: 'org-1',
  currency: 'USD',
  created_at: '2026-01-01T00:00:00Z',
  activated_at: '2026-01-01T00:00:00Z',
  activation_basis: null,
  line_items: [
    { id: 'active-labor', budget_version_id: 'v-active', category: 'Labor', description: 'Project team', budgeted_amount: 2000000, actual_amount: 0, org_id: 'org-1' },
    { id: 'active-materials', budget_version_id: 'v-active', category: 'Materials', description: 'Materials', budgeted_amount: 1700000, actual_amount: 0, org_id: 'org-1' },
    { id: 'active-contingency', budget_version_id: 'v-active', category: 'Contingency', description: 'Contingency', budgeted_amount: 1000000, actual_amount: 0, org_id: 'org-1' },
  ],
  total: 4700000,
};

const activeSuccessorVersion = {
  ...activeVersion,
  line_items: [{
    id: 'li-active-successor',
    budget_version_id: 'v-active',
    category: 'Labor',
    description: 'Current labor plan',
    budgeted_amount: 4700000,
    actual_amount: 0,
    org_id: 'org-1',
  }],
};

const archivedVersion = {
  id: 'v-arch',
  status: 'Archived' as const,
  name: 'Old v0',
  version: 0,
  project_id: 'p-1',
  org_id: 'org-1',
  currency: 'USD',
  created_at: '2026-01-01T00:00:00Z',
  activated_at: '2025-12-01T00:00:00Z',
  activation_basis: null,
  line_items: [],
  total: 0,
};

function resetState() {
  budgetState.data = undefined;
  budgetState.isPending = false;
  budgetState.isError = false;
  budgetState.refetch.mockReset().mockImplementation(() => Promise.resolve({ data: budgetState.data, isError: budgetState.isError }));
  versionsState.data = undefined;
  versionsState.isPending = false;
  versionsState.isError = false;
  versionsState.refetch.mockReset().mockImplementation(() => Promise.resolve({ data: versionsState.data, isError: versionsState.isError }));
  budgetDistributionState.data = null;
  budgetDistributionState.isPending = false;
  budgetDistributionState.isFetching = false;
  budgetDistributionState.isError = false;
  budgetDistributionState.refetch.mockReset().mockImplementation(() => Promise.resolve({ data: budgetDistributionState.data, isError: budgetDistributionState.isError }));
  activationModeState.data = 'allowed';
  activationModeState.isPending = false;
  activationModeState.isFetching = false;
  activationModeState.isError = false;
  activationPrecheckState.data = readyActivationPrecheck;
  activationPrecheckState.isPending = false;
  activationPrecheckState.isError = false;
  activationPrecheckState.refetch = vi.fn().mockImplementation(() => Promise.resolve({ data: activationPrecheckState.data, isError: activationPrecheckState.isError }));
  archiveTargetsState.data = [];
  archiveTargetsState.refetch = vi.fn().mockImplementation(() => Promise.resolve({ data: archiveTargetsState.data, error: null }));
  mockListArchiveTargets.mockReset();
  mockListArchiveTargets.mockResolvedValue([]);
  positionState.isPending = false;
  positionState.isError = false;
  positionState.refetch = vi.fn();
  positionState.hasBudget = true;
  positionState.canSeeActual = true;
  positionState.rows = [];
  positionState.unknown = 0;
  procurementsState.data = [];
  procurementsState.isPending = false;
  procurementsState.isError = false;
  budgetPushState.rows = [];
  mockBudgetRepository.getDistribution.mockReset().mockResolvedValue(null);
  mockBudgetRepository.createLineItem.mockReset().mockResolvedValue({ id: 'li-pasted' });
  mockRefreshBudgetQueries.mockReset().mockResolvedValue(undefined);
  roleState.realRole = 'Project Manager';
  roleState.effectiveRole = undefined;
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetState();
  setActiveLocale(EN_LOCALE);
  await financeTestI18n.changeLanguage('en');
});
afterEach(() => resetActiveLocale());

// ---------------------------------------------------------------------------
// Core states (AC-726, NFR-BV-UI-001)
// ---------------------------------------------------------------------------
describe('ProjectBudget Bahasa confirmation copy (BU-2)', () => {
  it('renders all six confirmation descriptions in Bahasa in an id locale session', async () => {
    await financeTestI18n.changeLanguage('id');
    roleState.realRole = 'Finance';
    const cases = [
      { versions: [], trigger: /Buat anggaran/i, fill: true, confirm: /^Buat$/i, body: 'Ini membuat versi anggaran Draf baru bernama' },
      { versions: [draftVersion], trigger: /Activate v2|Aktifkan v2/i, confirm: /Aktifkan versi/i, body: 'Ini menjadikan Draft v2 (v2) sebagai anggaran aktif' },
      { versions: [activeVersion], trigger: /Perbarui anggaran/i, confirm: /Salin versi/i, body: 'Ini menyalin Version 1 (v1) menjadi Draf baru' },
      { versions: [activeVersion], trigger: /Arsipkan/i, confirm: /Arsipkan versi/i, body: 'Ini menonaktifkan Version 1 (v1) sebagai anggaran aktif', openVersions: true, waitForArchiveInventory: true },
      { versions: [draftVersion], trigger: /Hapus draf/i, confirm: /Hapus draf/i, body: 'Ini menghapus draf Draft v2 (v2) secara permanen', openVersions: true },
      { versions: [draftVersion], trigger: /Hapus item anggaran/i, confirm: /^Hapus$/i, body: 'Ini menghapus item anggaran dari draf secara permanen' },
    ];
    for (const scenario of cases) {
      budgetState.data = 0;
      versionsState.data = scenario.versions;
      const view = renderPage();
      if (scenario.fill) {
        await userEvent.click(screen.getByRole('button', { name: scenario.trigger }));
        await userEvent.type(screen.getByPlaceholderText(/nama versi/i), 'Anggaran baru');
      } else {
        if (scenario.openVersions) await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
        await userEvent.click(screen.getByRole('button', { name: scenario.trigger }));
      }
      if (scenario.waitForArchiveInventory) await screen.findByRole('alertdialog');
      if (scenario.fill) await userEvent.click(screen.getByRole('button', { name: scenario.confirm }));
      const dialog = screen.queryByRole('dialog') ?? screen.getByRole('alertdialog');
      expect(dialog).toHaveTextContent(scenario.body);
      view.unmount();
    }
  });
});

describe('budget confirmation cancellation', () => {
  it.each([
    { kind: 'create', versions: [], trigger: /^Create budget$/, form: true, drawer: false },
    { kind: 'activate', versions: [draftVersion], trigger: /^Activate v2$/, form: false, drawer: false },
    { kind: 'clone', versions: [activeVersion], trigger: /^Update budget$/, form: false, drawer: false },
    { kind: 'archive', versions: [activeVersion], trigger: /^Archive$/, form: false, drawer: true },
    { kind: 'delete draft', versions: [draftVersion], trigger: /^Delete draft$/, form: false, drawer: true },
    { kind: 'delete line', versions: [draftVersion], trigger: /Delete line item Labor/i, form: false, drawer: false },
  ])('cancelling $kind closes its confirmation without writing', async ({ versions, trigger, form, drawer }) => {
    roleState.realRole = 'Finance';
    budgetState.data = 0;
    versionsState.data = versions;
    renderPage();
    if (drawer) await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    await userEvent.click(screen.getByRole('button', { name: trigger }));
    if (form) {
      await userEvent.type(screen.getByPlaceholderText(/Version name/i), '  Revision  ');
      await userEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    }
    const dialog = screen.queryByRole('alertdialog') ?? screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Cancel$/i }));
    expect(dialog).not.toBeInTheDocument();
    for (const mutation of [mockCreateVersion, mockActivate, mockClone, mockArchive, mockDeleteDraft, mockDeleteLineItem]) {
      expect(mutation).not.toHaveBeenCalled();
    }
    if (form) expect(screen.getByPlaceholderText(/Version name/i)).toHaveValue('  Revision  ');
  });
});

describe('ProjectBudget (AC-726, NFR-BV-UI-001)', () => {
  it('offers Update budget when an active version has no draft, and it asks before creating the revision', async () => {
    budgetState.data = activeVersion.total;
    versionsState.data = [activeVersion];
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Update budget' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('T5: the budget line-item table is named, its column widths are keyboard-resizable, and axe is clean', async () => {
    budgetState.data = draftVersion.total;
    versionsState.data = [draftVersion];
    const { container } = renderPage();
    expect(screen.getByRole('table', { name: 'Line items' })).toBeInTheDocument();
    expect(screen.getAllByRole('separator')[0]).toHaveAttribute('tabindex', '0');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('BU-3: amount validation message is Indonesian in an id locale session', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    await financeTestI18n.changeLanguage('id');
    renderPage();
    await userEvent.click(screen.getByText(/Tambah item anggaran/i));
    await userEvent.type(screen.getByPlaceholderText(/Jumlah/i), '0');
    await userEvent.click(screen.getByRole('button', { name: /^Simpan$/i }));
    expect(await screen.findByText('Jumlah harus lebih besar dari 0')).toBeInTheDocument();
  });

  it('AC-L10N-B01 renders the actual Indonesian empty state from the shipped catalogue', async () => {
    budgetState.data = 0;
    versionsState.data = [];
    await financeTestI18n.changeLanguage('id');
    renderPage();
    expect(screen.getByText('Belum ada versi anggaran')).toBeInTheDocument();
  });

  it('loading skeleton while pending (AC-726)', () => {
    budgetState.isPending = true;
    versionsState.isPending = true;
    renderPage();
    expect(screen.getByTestId('budget-loading')).toBeInTheDocument();
    resetState();
  });

  it('empty state when zero versions (AC-726)', () => {
    budgetState.data = 0;
    versionsState.data = [];
    renderPage();
    expect(screen.getByTestId('budget-empty')).toBeInTheDocument();
    resetState();
  });

  it('error + Retry re-runs both queries (AC-726)', () => {
    budgetState.isError = true;
    versionsState.isError = true;
    const refetchSpy = vi.fn();
    budgetState.refetch = refetchSpy;
    versionsState.refetch = refetchSpy;
    renderPage();
    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(refetchSpy).toHaveBeenCalled();
    resetState();
  });

  it('renders active budget KPIs before the budget-by-category table', () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    const table = screen.getByRole('table', { name: 'Budget vs actual by category' });
    expect(screen.getAllByText(/4,700,000/).length).toBeGreaterThan(0);
    // Spending is unknown here, so the table drops the blank Spent column; the tile still names it.
    expect(within(table).queryByRole('columnheader', { name: 'Spent' })).not.toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Committed' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Left' })).not.toBeInTheDocument();
    expect(within(table).getAllByText(/2,000,000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/USD/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('tax-basis')).toBeInTheDocument();
    resetState();
  });

  it('AC-1530 renders PMO paid category spending without the ledger-link prompt', () => {
    budgetState.data = activeVersion.total;
    versionsState.data = [activeVersion];
    positionState.rows = [
      { category: 'Labor', budget: 2000000, actual: 55 },
      { category: 'Materials', budget: 1700000, actual: 0 },
      { category: 'Contingency', budget: 1000000, actual: 0 },
    ];
    renderPage();

    const table = screen.getByRole('table', { name: 'Budget vs actual by category' });
    expect(within(table).getByRole('row', { name: /Labor/ })).toHaveTextContent('55');
    expect(screen.queryByText(/Spending isn't linked yet\./)).not.toBeInTheDocument();
  });

  it('shows the source remedy once while keeping unknown spending visibly unavailable', () => {
    budgetState.data = activeVersion.total;
    versionsState.data = [activeVersion];
    positionState.unknown = 3;
    renderPage();

    const table = screen.getByRole('table', { name: 'Budget vs actual by category' });
    // Unknown spending is not a column of dashes: the column is dropped and the reason is said once.
    expect(within(table).queryByRole('columnheader', { name: 'Spent' })).not.toBeInTheDocument();
    // One line on the page names what is hidden and why, instead of dashes in every row.
    const hidden = screen.getByTestId('figures-hidden');
    expect(hidden).toHaveTextContent(/2 figures hidden: spending is not linked/);
    expect(screen.getAllByTestId('figures-hidden')).toHaveLength(1);
  });

  it('places the accounting-system notice after the budget table for Admin and Finance, and hides it from PMs', async () => {
    budgetState.data = activeVersion.total;
    versionsState.data = [activeVersion];
    budgetPushState.rows = [
      { pushState: 'pushed', pushError: null, unmappedCategories: null, erpBudgetName: 'BUDGET-1', fiscalYear: '2026', pushedAt: null, holdReleasable: false, staleAttribution: false },
      { pushState: 'pending', pushError: null, unmappedCategories: null, erpBudgetName: null, fiscalYear: '2027', pushedAt: null, holdReleasable: false, staleAttribution: false },
    ];
    roleState.realRole = 'Admin';
    const adminView = renderPage();
    await userEvent.click(screen.getByText('Sources and budget enforcement'));
    const notice = await screen.findByTestId('budget-erp-notice');
    const table = screen.getByRole('table', { name: 'Budget vs actual by category' });
    expect(table).toBeInTheDocument();
    expect(table.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.querySelectorAll('p')).toHaveLength(0);
    adminView.unmount();

    roleState.realRole = 'Finance';
    const financeView = renderPage();
    await userEvent.click(screen.getByText('Sources and budget enforcement'));
    expect(await screen.findByTestId('budget-erp-notice')).toBeInTheDocument();
    financeView.unmount();

    // #1402 limits budget enforcement state to Finance and Admin.
    roleState.realRole = 'Project Manager';
    renderPage();
    expect(screen.queryByText('Sources and budget enforcement')).not.toBeInTheDocument();
    expect(screen.queryByTestId('budget-erp-notice')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SUB-D — budget tab subtraction (owner 2026-10-20: simpler, net-negative)
// ---------------------------------------------------------------------------
describe('ProjectBudget T5 DataTable adoption', () => {
  const priced = (amount: number, fiscal_year: string | null = 'FY26') => ({
    id: 'li-p', budget_version_id: 'v-active', category: 'Labor', description: 'Priced', budgeted_amount: amount,
    actual_amount: 0, org_id: 'org-1', fiscal_year,
  });

  it('the active category table keeps the FULL amount (OD-MONEY-FMT)', () => {
    budgetState.data = 1234.5;
    versionsState.data = [{ ...activeVersion, total: 1234.5, line_items: [priced(1234.5)] }];
    renderPage();
    const table = screen.getByRole('table', { name: 'Budget vs actual by category' });
    // C5: one table-money shape — whole units, no ".00" tail, and never the short $1.2K form. The
    // full figure is still shown (ux/1110 F1a moved table cells onto `formatCurrency`, which rounds to
    // whole units by design; the old `formatNumberMax2` printed the stray ".5").
    expect(within(table).getAllByText('$1,235').length).toBeGreaterThan(0);
    expect(within(table).queryByText(/\.00\b/)).not.toBeInTheDocument();
    expect(within(table).queryByText(/1\.2K/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId('dt-table-branch').length).toBeGreaterThan(0);
  });

  it('the Draft editor total is a <tfoot> row inside the table, with the full amount', () => {
    budgetState.data = 0;
    versionsState.data = [{ ...draftVersion, total: 200000.25, line_items: [{ ...draftVersion.line_items[0], budgeted_amount: 200000.25 }] }];
    renderPage();
    const total = screen.getByTestId('budget-edit-total');
    expect(total).toHaveTextContent('$200,000.25');
    expect(total.closest('tfoot')).not.toBeNull();
  });

  it('the Draft editor still edits a row inline and saves through the same write path', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Edit line item Labor' }));
    const amount = screen.getByLabelText('Amount');
    await userEvent.clear(amount);
    await userEvent.type(amount, '250000');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockUpdateLineItem).toHaveBeenCalledWith({ id: 'li-1', patch: expect.objectContaining({ budgeted_amount: 250000 }) }));
  });

  it('on a phone the line items render as stacked cards, each still reachable', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
    try {
      budgetState.data = 0;
      versionsState.data = [draftVersion];
      renderPage();
      expect(within(screen.getByTestId('budget-draft-editor')).getByTestId('dt-card-branch')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit line item Labor' })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('ProjectBudget SUB-D subtraction', () => {
  it('zero versions offer the Create budget action', () => {
    budgetState.data = 0;
    versionsState.data = [];
    renderPage();
    expect(screen.getByRole('button', { name: 'Create budget' })).toBeInTheDocument();
  });

  it('the Draft editor keeps the Fiscal year column even when every line is Un-phased', () => {
    budgetState.data = 0;
    versionsState.data = [{ ...draftVersion, line_items: [{ ...draftVersion.line_items[0], fiscal_year: null }] }];
    renderPage();
    expect(screen.getByRole('columnheader', { name: 'Fiscal year' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Version status badges
// ---------------------------------------------------------------------------
describe('ProjectBudget version status display', () => {
  it('AC-1050-08 shows the sole-operator provenance chip and omits it for standard or legacy versions', async () => {
    budgetState.data = activeVersion.total;
    versionsState.data = [{ ...activeVersion, activation_basis: 'sole_operator' }];
    const soleView = renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(screen.getByText('Activated by sole member')).toBeInTheDocument();
    soleView.unmount();

    versionsState.data = [{ ...activeVersion, activation_basis: 'standard' }];
    const standardView = renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(screen.queryByText('Activated by sole member')).not.toBeInTheDocument();
    standardView.unmount();

    await financeTestI18n.changeLanguage('id');
    versionsState.data = [{ ...activeVersion, activation_basis: 'sole_operator' }];
    const idSoleView = renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(screen.getByText('Diaktifkan oleh anggota tunggal')).toBeInTheDocument();
    idSoleView.unmount();

    versionsState.data = [{ ...activeVersion, activation_basis: null }];
    const legacyView = renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(screen.queryByText('Diaktifkan oleh anggota tunggal')).not.toBeInTheDocument();
    legacyView.unmount();
  });
  it('shows Draft status in the Versions drawer', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(within(screen.getByRole('dialog', { name: 'Budget versions' })).getByText('Draft')).toBeInTheDocument();
    resetState();
  });

  it('shows Active status in the Versions drawer', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(within(screen.getByRole('dialog', { name: 'Budget versions' })).getByText('Active')).toBeInTheDocument();
    resetState();
  });

  it('shows Archived status in the Versions drawer', async () => {
    budgetState.data = 0;
    versionsState.data = [archivedVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(within(screen.getByRole('dialog', { name: 'Budget versions' })).getByText('Archived')).toBeInTheDocument();
    resetState();
  });
});

// ---------------------------------------------------------------------------
// Draft actions
// ---------------------------------------------------------------------------
describe('ProjectBudget Draft version actions', () => {
  it('SP-5 Finance sees Activate and Delete draft in the Versions drawer', async () => {
    roleState.realRole = 'Finance';
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    expect(screen.getByRole('button', { name: /Activate/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(screen.getByRole('button', { name: /Delete draft/i })).toBeInTheDocument();
    resetState();
  });

  it('B2: Activate opens a default-tone confirm; mutation fires only on Confirm; toasts on resolve', async () => {
    roleState.realRole = 'Finance';
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Activate v2$/i }));
    // Owner rule: nothing mutates on the first click.
    expect(mockActivate).not.toHaveBeenCalled();
    // Default tone => role=dialog.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Activate version/i }));
    expect(mockActivate).toHaveBeenCalledWith('v-draft');
    expect(await findToastAnnouncement('status', /.+/)).toBeInTheDocument();
    resetState();
  });

  it('AC-1413-UI1: an eligible approver sees Return next to Activate; the dialog needs a reason and sends it trimmed', async () => {
    roleState.realRole = 'Finance';
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    expect(screen.getByRole('button', { name: /^Activate v2$/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Return$/i }));
    expect(mockReturn).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /^Return$/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: /Reason for returning/i }), '  Split labour by quarter ');
    await userEvent.click(confirm);
    expect(mockReturn).toHaveBeenCalledWith({ versionId: 'v-draft', reason: 'Split labour by quarter' });
    resetState();
  });

  it('AC-1413-UI2: Return is not offered to the drafter or to a non-approver role', () => {
    roleState.realRole = 'Finance';
    budgetState.data = 0;
    versionsState.data = [{ ...draftVersion, created_by: 'u1', editor_ids: ['u1'] }];
    const { unmount } = renderPage();
    expect(screen.queryByRole('button', { name: /^Return$/i })).not.toBeInTheDocument();
    unmount();
    roleState.realRole = 'Project Manager';
    versionsState.data = [draftVersion];
    renderPage();
    expect(screen.queryByRole('button', { name: /^Return$/i })).not.toBeInTheDocument();
    resetState();
  });

  it('AC-1413-UI3: a returned draft shows its reason, drops the waiting banner and Activate, and offers Resubmit', async () => {
    roleState.realRole = 'Finance';
    budgetState.data = 0;
    versionsState.data = [{ ...draftVersion, returned_at: '2026-01-02T00:00:00Z', returned_by: 'u3', return_reason: 'Split labour' }];
    renderPage();
    expect(screen.getByTestId('budget-returned-banner')).toHaveTextContent('Split labour');
    expect(screen.queryByTestId('budget-draft-banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Activate v2$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Return$/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Resubmit for approval$/i }));
    expect(mockResubmit).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Resubmit for approval$/i }));
    expect(mockResubmit).toHaveBeenCalledWith('v-draft');
    resetState();
  });

  it('keeps an unresolved error when New version is opened and cancelled', async () => {
    budgetState.data = 0;
    versionsState.data = [activeVersion];
    render(
      <FinanceI18nTestProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <ToastProvider>
            <UnresolvedErrorToast />
            <ProjectBudget projectId="p-1" project={project} />
          </ToastProvider>
        </MemoryRouter>
        </QueryClientProvider>
      </FinanceI18nTestProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Show unresolved error' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Unresolved error Retry the failed operation');
    await userEvent.click(screen.getByRole('button', { name: /New version/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Unresolved error Retry the failed operation');
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Unresolved error Retry the failed operation');
    resetState();
  });

  // ⚑ #1030: `activateVersion` resolves `pushState: 'queued'` unconditionally (ADR-0062), so the
  // 'nothing-to-push' / 'pending-cancellation' / 'failed' ACTIVATION toasts are unreachable and were
  // removed by 43d0e8f2e. The #1413 merge (fb7d9b954) restored this file's pre-43d0e8f2e side along
  // with the toasts, so its two pinning tests came back with them; they mock a result the repository
  // seam can never return. Their goal oracles ("nothing was sent" is never announced as a push; a
  // cancellation-pending push reads as QUEUED, never as a clean success) live on the surface that now
  // owns the outcome — pages/project-detail/budget/BudgetErpNotice.test.tsx:172 ("a retry with nothing
  // to push says so — never that ERPNext is enforcing the budget") and :182 ("rm-1472/M-3 a retry
  // while an earlier cancellation is still settling says the push is QUEUED"), plus :91 for the
  // 'pending' → "Queued" label and src/hooks/useBudget.queuedPush.test.tsx for the #1030 seed.

  it('requires the current mode while confirming a sole-operator activation', async () => {
    roleState.realRole = 'Finance';
    budgetState.data = 100;
    versionsState.data = [{ ...draftVersion, created_by: 'u1', editor_ids: ['u1'] }];
    activationModeState.data = 'sole_operator';
    const view = renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Activate v2$/i }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const refresh = () => view.rerender(<FinanceI18nTestProvider><QueryClientProvider client={client}><MemoryRouter><ToastProvider><ProjectBudget projectId="p-1" project={project} /></ToastProvider></MemoryRouter></QueryClientProvider></FinanceI18nTestProvider>);
    activationModeState.isFetching = true; refresh();
    expect(screen.getByText('Checking activation eligibility…')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: /Activate version/i })).toBeDisabled();
    activationModeState.isFetching = false; activationModeState.isError = true; refresh();
    expect(screen.getByText('Activation eligibility is unavailable. Refresh this page and try again.')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: /Activate version/i })).toBeDisabled();
    activationModeState.isError = false; activationModeState.data = 'blocked_editor'; refresh();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: /Activate version/i })).toBeDisabled();
    expect(mockActivate).not.toHaveBeenCalled();
    activationModeState.data = 'sole_operator'; refresh();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Activate version/i }));
    expect(mockActivate).toHaveBeenCalledWith('v-draft');
  });

  it('AC-1050-07: sole operator sees Activate and must confirm the exception before activation', async () => {
    roleState.realRole = 'Finance';
    budgetState.data = 100;
    versionsState.data = [{ ...draftVersion, created_by: 'u1', editor_ids: ['u1'] }];
    activationModeState.data = 'sole_operator';
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /^Activate v2$/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent("You're the only person in this organisation, so you can activate a budget you prepared yourself.");
    expect(mockActivate).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: /Activate version/i }));
    expect(mockActivate).toHaveBeenCalledWith('v-draft');
  });

  it.each(['Project Manager', 'Executive'] as const)(
    'explains the missing drafter to a sole %s editor when the server blocks activation',
    (role) => {
      roleState.realRole = role;
      versionsState.data = [{ ...draftVersion, created_by: null, editor_ids: ['u1'] }];
      activationModeState.data = 'blocked_no_drafter';
      renderPage();
      expect(screen.queryByRole('button', { name: /^Activate v2$/i })).not.toBeInTheDocument();
      expect(screen.getByText('No drafter is recorded for this version. Ask an Admin or Finance user to activate it.')).toBeInTheDocument();
    },
  );

  it('OD-BUDGET-6: the drafter sees approval guidance instead of an Activate button', async () => {
    budgetState.data = 0;
    versionsState.data = [{ ...draftVersion, created_by: 'u1' }];
    renderPage();
    expect(screen.queryByRole('button', { name: /^Activate v2$/i })).not.toBeInTheDocument();
    expect(screen.getByText('You drafted or edited this version, so someone else must activate it.')).toBeInTheDocument();
    // The drafter keeps every other Draft affordance.
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(screen.getByRole('button', { name: /Delete draft/i })).toBeInTheDocument();
  });

  it('DD-BUDGET-7: a line editor who is not the drafter also sees the editor reason, not Activate', () => {
    budgetState.data = 0;
    // u2 drafted; the signed-in u1 edited a line, so u1 may not activate either.
    versionsState.data = [{ ...draftVersion, created_by: 'u2', editor_ids: ['u1'] }];
    renderPage();
    expect(screen.queryByRole('button', { name: /^Activate v2$/i })).not.toBeInTheDocument();
    expect(screen.getByText('You drafted or edited this version, so someone else must activate it.')).toBeInTheDocument();
  });

  it('SP-5 PM cannot activate an unedited draft', () => {
    roleState.realRole = 'Project Manager';
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    expect(screen.queryByRole('button', { name: /^Activate v2$/i })).not.toBeInTheDocument();
  });

  it('OD-BUDGET-6: a PM sees that a version with no recorded drafter needs Admin or Finance', () => {
    budgetState.data = 0;
    versionsState.data = [{ ...draftVersion, created_by: null }];
    renderPage();
    expect(screen.queryByRole('button', { name: /^Activate v2$/i })).not.toBeInTheDocument();
    expect(screen.getByText('No drafter is recorded for this version. Ask an Admin or Finance user to activate it.')).toBeInTheDocument();
  });

  it('OD-BUDGET-6: Finance may activate a version with no recorded drafter', () => {
    roleState.realRole = 'Finance';
    budgetState.data = 0;
    versionsState.data = [{ ...draftVersion, created_by: null }];
    renderPage();
    expect(screen.getByRole('button', { name: /^Activate v2$/i })).toBeInTheDocument();
    expect(screen.queryByText('No drafter is recorded for this version. Ask an Admin or Finance user to activate it.')).not.toBeInTheDocument();
  });

  it('OD-BUDGET-6: the drafter reason renders from the shipped Indonesian catalogue', async () => {
    budgetState.data = 0;
    versionsState.data = [{ ...draftVersion, created_by: 'u1' }];
    await financeTestI18n.changeLanguage('id');
    renderPage();
    expect(screen.getByText('Anda menyusun atau mengedit versi ini, jadi orang lain harus mengaktifkannya.')).toBeInTheDocument();
  });

  it('B5: Delete draft opens a DESTRUCTIVE modal; deleteDraft fires only on Confirm', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    await userEvent.click(screen.getByRole('button', { name: /Delete draft/i }));
    expect(mockDeleteDraft).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    // The confirm button label is "Delete draft" (verb + object).
    const confirms = screen.getAllByRole('button', { name: /Delete draft/i });
    // The last one is the dialog's confirm (the trigger is also still labelled "Delete draft").
    await userEvent.click(confirms[confirms.length - 1]);
    expect(mockDeleteDraft).toHaveBeenCalledWith('v-draft');
    resetState();
  });

  it('shows line-item row from the draft', () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    expect(screen.getByText('Developers')).toBeInTheDocument();
    resetState();
  });

  it('delete-line-item opens a DESTRUCTIVE modal; deleteLineItem fires only on Confirm', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    const deleteBtn = screen.getByRole('button', { name: /Delete line item Labor/i });
    await userEvent.click(deleteBtn);
    // Owner rule: the row's Delete click stages a confirm, does not write.
    expect(mockDeleteLineItem).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Delete$/i }));
    expect(mockDeleteLineItem).toHaveBeenCalledWith('li-1');
    resetState();
  });

  it('shows Add line item button in draft', () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    expect(screen.getByText(/\+ Add line item/i)).toBeInTheDocument();
    resetState();
  });

  it.each([
    { code: 'budget-category-unmapped', expected: /map.*budget categories/i },
    { code: 'budget-fiscal-year-invalid', expected: /fiscal year listed by ERPNext/i },
    { code: 'budget-fiscal-year-out-of-span', expected: /fiscal year outside the project dates/i },
    { code: 'budget-fiscal-year-ambiguous', expected: /overlapping fiscal years/i },
    { code: 'budget-project-start-date-missing', expected: /add a project start date/i },
    { code: 'budget-fiscal-year-unresolved', expected: /no fiscal year for the project end date/i, datePart: 'end' as const },
    { code: 'unknown-readiness-issue', expected: /readiness check found an issue/i },
  ])('explains readiness issue $code before activation', ({ code, expected, datePart }) => {
    roleState.realRole = 'Finance';
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    activationPrecheckState.data = { status: 'blocked', erpCheck: 'available', fiscalYearNames: ['2026'], fiscalYears: readyActivationPrecheck.fiscalYears, issues: [{ code, datePart, categories: ['Labor'], lines: [{ category: 'Labor', fiscalYear: '2026' }], date: '2026-01-01', fiscalYears: ['FY1', 'FY2'] }] };
    renderPage();
    expect(screen.getByTestId('budget-readiness-summary')).toHaveTextContent(expected);
  });

  it('issue #1421: lists missing readiness on the Draft and disables confirmation until fixed', async () => {
    roleState.realRole = 'Finance';
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    activationPrecheckState.data = {
      status: 'blocked',
      erpCheck: 'available',
      fiscalYearNames: ['2026', '2027'],
      fiscalYears: readyActivationPrecheck.fiscalYears,
      issues: [{
        code: 'budget-multi-fiscal-year-unphased',
        categories: ['Materials'],
        startFiscalYear: '2026',
        endFiscalYear: '2027',
      }],
    };
    renderPage();

    expect(screen.getByTestId('budget-readiness-summary')).toHaveTextContent(/Materials/i);
    await userEvent.click(screen.getByRole('button', { name: /^Activate v2$/i }));
    expect(activationPrecheckState.refetch).toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: /Activate version/i });
    expect(screen.getByRole('dialog')).toHaveTextContent(/Materials/i);
    expect(confirm).toBeDisabled();
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it('issue #1421: a native budget activates without ERP findings', async () => {
    roleState.realRole = 'Finance';
    versionsState.data = [{ ...draftVersion, line_items: [{ ...draftVersion.line_items[0], fiscal_year: null }] }];
    activationPrecheckState.data = { status: 'ready', erpCheck: 'not-required', fiscalYearNames: null, fiscalYears: null, issues: [] };
    renderPage();
    expect(screen.getByTestId('budget-readiness-summary')).toBeEmptyDOMElement();
    await userEvent.click(screen.getByRole('button', { name: /^Activate v2$/i }));
    const confirm = screen.getByRole('button', { name: /Activate version/i });
    expect(confirm).toBeEnabled();
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/ERPNext/);
    await userEvent.click(confirm);
    expect(mockActivate).toHaveBeenCalledWith('v-draft');
  });

  it.each([
    ['en', /checked again when the budget is pushed/i],
    ['id', /pemeriksaan akan dilakukan lagi saat anggaran dikirim/i],
  ] as const)('issue #1421: %s outage copy describes the next push check', (locale, message) => {
    versionsState.data = [draftVersion];
    activationPrecheckState.data = { status: 'erp-unavailable', erpCheck: 'unavailable', fiscalYearNames: null, fiscalYears: null, issues: [] };
    render(<BahasaProvider locale={locale}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ToastProvider><ProjectBudget projectId="p-1" project={project} /></ToastProvider></MemoryRouter></QueryClientProvider></BahasaProvider>);
    expect(screen.getByTestId('budget-readiness-summary')).toHaveTextContent(message);
  });

  it('issue #1421: clearly reports an unavailable ERP check and still permits PMO activation', async () => {
    roleState.realRole = 'Finance';
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    activationPrecheckState.data = {
      status: 'erp-unavailable',
      erpCheck: 'unavailable',
      fiscalYearNames: null,
      fiscalYears: null,
      issues: [],
    };
    renderPage();

    expect(screen.getByTestId('budget-readiness-summary')).toHaveTextContent(/couldn't check ERPNext/i);
    await userEvent.click(screen.getByRole('button', { name: /^Activate v2$/i }));
    const confirm = screen.getByRole('button', { name: /Activate version/i });
    expect(screen.getByRole('dialog')).toHaveTextContent(/checked again when the budget is pushed/i);
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/push will retry/i);
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(mockActivate).toHaveBeenCalledWith('v-draft');
  });
});

// ---------------------------------------------------------------------------
// Active version actions
// ---------------------------------------------------------------------------
describe('ProjectBudget Active version actions', () => {
  it('shows Update budget in the header and Archive in the Versions drawer', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    expect(screen.getByRole('button', { name: 'Update budget' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(screen.getByRole('button', { name: /^Archive$/i })).toBeInTheDocument();
    resetState();
  });

  it('B4: Archive opens a DESTRUCTIVE modal then calls mutation on Confirm', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    await screen.findByRole('alertdialog');
    // Owner rule: nothing mutates on the first click; a destructive modal appears.
    expect(mockArchive).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Archive version/i }));
    expect(mockArchive).toHaveBeenCalledWith({ versionId: 'v-active', cancelErp: false });
    resetState();
  });

  it('offers a default-on ERPNext cancellation choice for live archived budgets and submits the selected choice', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    mockListArchiveTargets.mockResolvedValue([
      { source_kind: 'account', fiscal_year: '2026', erp_budget_name: 'BUD-1', eligible: true, reason: 'eligible', push_state: 'pushed', erp_docstatus: 1 },
      { source_kind: 'account', fiscal_year: '2027', erp_budget_name: 'BUD-2', eligible: true, reason: 'eligible', push_state: 'pushed', erp_docstatus: 1 },
    ]);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByRole('checkbox', { name: 'Also cancel 2 Budget documents in ERPNext' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(confirm).getByRole('checkbox', { name: 'Also cancel 2 Budget documents in ERPNext' }));
    await userEvent.click(within(confirm).getByRole('button', { name: /Archive version/i }));

    expect(mockArchive).toHaveBeenCalledWith({ versionId: 'v-active', cancelErp: false });
  });

  it('keeps the archive decision open when cancellation is refused so the operator can archive without it', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    mockListArchiveTargets.mockResolvedValue([
      { source_kind: 'account', fiscal_year: '2026', erp_budget_name: 'BUD-1', eligible: true, reason: 'eligible', push_state: 'pushed', erp_docstatus: 1 },
    ]);
    mockArchive
      .mockRejectedValueOnce(new Error('An ERPNext Budget command is unsettled; retry after it completes.'))
      .mockResolvedValueOnce({ cancelErp: false, liveTargetCount: 1, queuedCount: 0 });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    const dialog = await screen.findByRole('alertdialog');
    const cancelChoice = within(dialog).getByRole('checkbox', { name: 'Also cancel 1 Budget document in ERPNext' });
    expect(cancelChoice).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(dialog).getByRole('button', { name: /Archive version/i }));

    expect(await findToastAnnouncement('alert', /ERPNext Budget command is unsettled/i)).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await userEvent.click(cancelChoice);
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Archive version/i }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(mockArchive).toHaveBeenNthCalledWith(1, { versionId: 'v-active', cancelErp: true });
    expect(mockArchive).toHaveBeenNthCalledWith(2, { versionId: 'v-active', cancelErp: false });
  });

  it('uses the committed live-target count when archived inventory changes before the archive transaction', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    mockListArchiveTargets.mockResolvedValue([
      { source_kind: 'account', fiscal_year: '2026', erp_budget_name: 'BUD-1', eligible: true, reason: 'eligible', push_state: 'pushed', erp_docstatus: 1 },
    ]);
    mockArchive.mockResolvedValueOnce({ cancelErp: false, liveTargetCount: 2, queuedCount: 0 });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Also cancel 1 Budget document in ERPNext' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /Archive version/i }));

    const toast = await findToastAnnouncement('alert', /Budget document/);
    expect(toast).toHaveTextContent('2 Budget documents');
  });

  it('warns from the archive result when a target appears after an empty inventory read', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    mockListArchiveTargets.mockResolvedValue([]);
    mockArchive.mockResolvedValueOnce({ cancelErp: false, liveTargetCount: 1, queuedCount: 0 });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    await screen.findByRole('alertdialog');
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Archive version/i }));

    const toast = await findToastAnnouncement('alert', /Budget document/);
    expect(toast).toHaveTextContent('1 Budget document');
  });

  it('reports zero live targets when the server declines an archive cancellation for a now-resolved target', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    mockListArchiveTargets.mockResolvedValue([
      { source_kind: 'account', fiscal_year: '2026', erp_budget_name: 'BUD-1', eligible: true, reason: 'eligible', push_state: 'pushed', erp_docstatus: 1 },
    ]);
    mockArchive.mockResolvedValueOnce({ cancelErp: true, liveTargetCount: 0, queuedCount: 0 });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    await screen.findByRole('alertdialog');
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Archive version/i }));

    const toast = await findToastAnnouncement('alert', /no ERPNext cancellation was queued/i);
    expect(toast).toHaveTextContent('0 Budget documents');
    expect(toast).not.toHaveTextContent('1 Budget document');
  });

  it('discloses an OLDER-push legacy document by year and name while v16 shape evidence is unavailable', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    mockListArchiveTargets.mockResolvedValue([
      { source_kind: 'legacy', fiscal_year: '2026', erp_budget_name: 'BUD-OLD', eligible: false, reason: 'legacy-v16-shape-unproven', push_state: 'pushed', erp_docstatus: 1 },
    ]);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText(/BUD-OLD/)).toBeInTheDocument();
    expect(within(confirm).getByText(/2026/)).toBeInTheDocument();
    expect(within(confirm).getByText(/older push/i)).toBeInTheDocument();
    expect(within(confirm).queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: /Archive version/i }));

    expect(mockArchive).toHaveBeenCalledWith({ versionId: 'v-active', cancelErp: false });
  });

  it('discloses both fiscal-year endpoints for an eligible range target before offering cancellation', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    mockListArchiveTargets.mockResolvedValue([
      { source_kind: 'account', fiscal_year: 'FY/Alpha', to_fiscal_year: 'FY:Beta', erp_budget_name: 'BUD-RANGE', eligible: true, reason: 'eligible', push_state: 'pushed', erp_docstatus: 1 },
    ]);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('FY/Alpha–FY:Beta — BUD-RANGE')).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: /Also cancel 1 Budget document in ERPNext/ })).toBeInTheDocument();
  });

  it('never opens the archive dialog out of a failed inventory read', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    mockListArchiveTargets.mockRejectedValue(new Error('inventory unavailable'));
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(mockArchive).not.toHaveBeenCalled();
    expect(await findToastAnnouncement('alert', /inventory unavailable/i)).toBeInTheDocument();
  });

  it('does not offer ERP cancellation when the active ERPNext v16 binding is unavailable', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    mockListArchiveTargets.mockResolvedValue([
      { source_kind: 'account', fiscal_year: '2026', erp_budget_name: 'BUD-1', eligible: false, reason: 'binding-unavailable', push_state: 'pushed', erp_docstatus: 1 },
    ]);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: /Archive version/i }));

    expect(mockArchive).toHaveBeenCalledWith({ versionId: 'v-active', cancelErp: false });
  });

  it('shows an action-required banner when no budget is active and an archived ERPNext budget remains live', () => {
    budgetState.data = 0;
    versionsState.data = [archivedVersion];
    archiveTargetsState.data = [{
      id: 'mirror-arch', budget_version_id: 'v-arch', fiscal_year: '2026', erp_account: 'Labor',
      erp_budget_name: 'BUD-OLD', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'held', budget_intent: 'ensure',
      activated_at_witness: archivedVersion.activated_at,
    }];
    renderPage();

    expect(screen.getByText('ERPNext is still enforcing an archived budget for this project. Cancel the ERPNext Budget documents or activate a new PMO budget.'))
      .toHaveAttribute('role', 'alert');
    expect(screen.getByRole('list', { name: 'ERPNext Budget documents that may still be live' }))
      .toHaveTextContent('2026 — BUD-OLD');
    expect(screen.getByRole('list', { name: 'ERPNext Budget documents that may still be live' }))
      .toHaveTextContent('On hold');
  });

  it('shows the exact year and name of a live archived legacy target without inventing an account', () => {
    budgetState.data = 0;
    versionsState.data = [archivedVersion];
    archiveTargetsState.data = [{
      id: 'legacy-mirror-arch', budget_version_id: 'v-arch', fiscal_year: '2026', erp_account: '',
      erp_budget_name: 'BUD-LEGACY-OLD', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pending', budget_intent: 'ensure',
      source_kind: 'legacy', activated_at_witness: null,
    }];
    renderPage();

    const list = screen.getByRole('list', { name: 'ERPNext Budget documents that may still be live' });
    expect(within(list).getByText('2026 — BUD-LEGACY-OLD (older push)')).toBeInTheDocument();
    expect(list).toHaveTextContent('Queued');
    expect(within(list).queryByText(/Labor/)).not.toBeInTheDocument();
    expect(screen.getByText('ERPNext is still enforcing an archived budget for this project. Cancel the ERPNext Budget documents or activate a new PMO budget.'))
      .toHaveAttribute('role', 'alert');
  });

  it('shows both fiscal-year endpoints for a live archived range Budget', () => {
    budgetState.data = 0;
    versionsState.data = [archivedVersion];
    archiveTargetsState.data = [{
      id: 'range-mirror-arch', budget_version_id: 'v-arch', fiscal_year: 'FY/Alpha', to_fiscal_year: 'FY:Beta', erp_account: 'Labor',
      erp_budget_name: 'BUD-RANGE-OLD', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', budget_intent: 'ensure',
      activated_at_witness: archivedVersion.activated_at,
    }];
    renderPage();

    const list = screen.getByRole('list', { name: 'ERPNext Budget documents that may still be live' });
    expect(within(list).getByText('FY/Alpha–FY:Beta — BUD-RANGE-OLD')).toBeInTheDocument();
  });

  it('keeps a live archived ERP Budget visible when its activation witness is older', () => {
    budgetState.data = 0;
    versionsState.data = [archivedVersion];
    archiveTargetsState.data = [{
      id: 'mirror-stale', budget_version_id: 'v-arch', fiscal_year: '2026', erp_account: 'Labor',
      erp_budget_name: 'BUD-OLD', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', budget_intent: 'ensure',
      activated_at_witness: '2025-11-01T00:00:00Z',
    }];
    renderPage();

    expect(screen.getByText('ERPNext is still enforcing an archived budget for this project. Cancel the ERPNext Budget documents or activate a new PMO budget.'))
      .toHaveAttribute('role', 'alert');
  });

  it('keeps the archived warning when an Active version has not pushed the same account and year', () => {
    budgetState.data = 4700000;
    versionsState.data = [archivedVersion, activeSuccessorVersion];
    archiveTargetsState.data = [{
      id: 'mirror-arch', budget_version_id: 'v-arch', fiscal_year: '2026', erp_account: 'Labor',
      erp_budget_name: 'BUD-OLD', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', budget_intent: 'ensure',
      activated_at_witness: '2025-11-01T00:00:00Z',
    }, {
      id: 'mirror-active-failed', budget_version_id: 'v-active', fiscal_year: '2026', erp_account: 'Labor',
      erp_budget_name: 'BUD-NEW', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'failed', budget_intent: 'ensure',
      activated_at_witness: activeSuccessorVersion.activated_at,
    }];
    renderPage();

    expect(screen.getByText('ERPNext is still enforcing an archived budget for this project. Cancel the ERPNext Budget documents or activate a new PMO budget.'))
      .toHaveAttribute('role', 'alert');
  });

  it('keeps a partial multi-account/year successor push visible for the unresolved grain', () => {
    budgetState.data = 4700000;
    versionsState.data = [archivedVersion, activeSuccessorVersion];
    archiveTargetsState.data = [{
      id: 'mirror-arch-labor', budget_version_id: 'v-arch', fiscal_year: '2026', erp_account: 'Labor',
      erp_budget_name: 'BUD-OLD-LABOR', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', budget_intent: 'ensure',
      activated_at_witness: '2025-11-01T00:00:00Z',
    }, {
      id: 'mirror-arch-materials', budget_version_id: 'v-arch', fiscal_year: '2027', erp_account: 'Materials',
      erp_budget_name: 'BUD-OLD-MATERIALS', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', budget_intent: 'ensure',
      activated_at_witness: '2025-11-01T00:00:00Z',
    }, {
      id: 'mirror-active-labor', budget_version_id: 'v-active', fiscal_year: '2026', erp_account: 'Labor',
      erp_budget_name: 'BUD-NEW-LABOR', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', budget_intent: 'ensure',
      activated_at_witness: activeSuccessorVersion.activated_at,
    }];
    renderPage();

    expect(screen.getByText('ERPNext is still enforcing an archived budget for this project. Cancel the ERPNext Budget documents or activate a new PMO budget.'))
      .toHaveAttribute('role', 'alert');
  });

  it('keeps the archived warning when an Active successor has no lines to push', () => {
    budgetState.data = 4700000;
    versionsState.data = [archivedVersion, activeVersion];
    archiveTargetsState.data = [{
      id: 'mirror-arch', budget_version_id: 'v-arch', fiscal_year: '2026', erp_account: 'Labor',
      erp_budget_name: 'BUD-OLD', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', budget_intent: 'ensure',
      activated_at_witness: '2025-11-01T00:00:00Z',
    }];
    renderPage();

    expect(screen.getByText('ERPNext is still enforcing an archived budget for this project. Cancel the ERPNext Budget documents or activate a new PMO budget.'))
      .toHaveAttribute('role', 'alert');
  });

  it('resolves an archived warning only after the Active successor is pushed for the same account and year', () => {
    budgetState.data = 4700000;
    versionsState.data = [archivedVersion, activeSuccessorVersion];
    archiveTargetsState.data = [{
      id: 'mirror-arch', budget_version_id: 'v-arch', fiscal_year: '2026', erp_account: 'Labor',
      erp_budget_name: 'BUD-OLD', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', budget_intent: 'ensure',
      activated_at_witness: '2025-11-01T00:00:00Z',
    }, {
      id: 'mirror-active', budget_version_id: 'v-active', fiscal_year: '2026', erp_account: 'Labor',
      erp_budget_name: 'BUD-NEW', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', budget_intent: 'ensure',
      activated_at_witness: activeSuccessorVersion.activated_at,
    }];
    renderPage();

    expect(screen.queryByText('ERPNext is still enforcing an archived budget for this project. Cancel the ERPNext Budget documents or activate a new PMO budget.'))
      .not.toBeInTheDocument();
  });

  it('B4: can cancel archive confirmation', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    await screen.findByRole('alertdialog');
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockArchive).not.toHaveBeenCalled();
    resetState();
  });

  it('B3: Update budget clones the active version after confirmation', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Update budget' }));
    expect(mockClone).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clone version/i }));
    expect(mockClone).toHaveBeenCalledWith('v-active');
    resetState();
  });
});

// ---------------------------------------------------------------------------
// Archived version actions
// ---------------------------------------------------------------------------
describe('ProjectBudget Archived version actions', () => {
  it('shows Clone to revise for an archived version in the Versions drawer', async () => {
    budgetState.data = 0;
    versionsState.data = [archivedVersion];
    renderPage();
    expect(screen.getByRole('button', { name: 'New version' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(screen.getByRole('button', { name: /Clone to revise/i })).toBeInTheDocument();
    resetState();
  });

  it('does not show Activate, Archive, or Delete for Archived', async () => {
    budgetState.data = 0;
    versionsState.data = [archivedVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(screen.queryByRole('button', { name: /Activate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Archive$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete draft/i })).not.toBeInTheDocument();
    resetState();
  });
});

// ---------------------------------------------------------------------------
// Line-item add form in Draft editor
// ---------------------------------------------------------------------------
describe('ProjectBudget line-item add form (Draft)', () => {
  it('AC-CAT-007: keeps positioned input labels inside the editor scrolling region', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByText(/\+ Add line item/i));
    const scrollRegion = screen.getByRole('combobox', { name: 'Line item category' }).closest('table')!.parentElement;
    expect(scrollRegion).toHaveClass('relative', 'overflow-x-auto');
  });

  it('AC-CAT-005: the Bahasa picker uses Biaya khusus but saves the canonical enum value', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    render(<BahasaProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ToastProvider><ProjectBudget projectId="p-1" project={project} /></ToastProvider></MemoryRouter></QueryClientProvider></BahasaProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Ubah draf' }));
    await userEvent.click(screen.getByText(/Tambah item anggaran/i));
    expect(screen.getByRole('option', { name: 'Biaya khusus' })).toHaveValue('Special expenses');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kategori item anggaran' }), 'Special expenses');
    await userEvent.type(screen.getByPlaceholderText(/Jumlah/i), '10');
    await userEvent.click(screen.getByRole('button', { name: /^Simpan$/i }));
    expect(mockCreateLineItem).toHaveBeenCalledWith({ versionId: 'v-draft', item: expect.objectContaining({ category: 'Special expenses', budgeted_amount: 10 }) });
  });

  it('AC-CAT-002: saves Special expenses with its canonical category and exact entered amount', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByText(/\+ Add line item/i));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Line item category' }), 'Special expenses');
    await userEvent.type(screen.getByPlaceholderText(/Amount/i), '25000.30');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    expect(mockCreateLineItem).toHaveBeenCalledWith({
      versionId: 'v-draft',
      item: expect.objectContaining({ category: 'Special expenses', budgeted_amount: 25000.30 }),
    });
  });

  it('can add a line item via the editor form', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByText(/\+ Add line item/i));
    const amountInput = screen.getByPlaceholderText(/Amount/i);
    await userEvent.type(amountInput, '50000');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    expect(mockCreateLineItem).toHaveBeenCalledWith({
      versionId: 'v-draft',
      item: expect.objectContaining({ budgeted_amount: 50000 }),
    });
  });

  it('AC-PLC-009: rejects an en-US line item amount with excess precision before creating it', async () => {
    setActiveLocale(EN_LOCALE);
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByText(/\+ Add line item/i));
    await userEvent.type(screen.getByPlaceholderText(/Amount/i), '1.234');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(await screen.findByText(/valid|decimal/i, { selector: 'span[role="alert"]' })).toHaveTextContent(/valid|decimal/i);
    expect(mockCreateLineItem).not.toHaveBeenCalled();
  });

  it('AC-PLC-009: parses id-ID line item grouping as 1234 before creating it', async () => {
    setActiveLocale(ID_LOCALE);
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByText(/\+ Add line item/i));
    await userEvent.type(screen.getByPlaceholderText(/Amount/i), '1.234');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(mockCreateLineItem).toHaveBeenCalledWith({
      versionId: 'v-draft',
      item: expect.objectContaining({ budgeted_amount: 1234 }),
    });
  });

  it('can cancel the add line item form', async () => {
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByText(/\+ Add line item/i));
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.getByText(/\+ Add line item/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// New version form (empty state)
// ---------------------------------------------------------------------------
describe('ProjectBudget Create budget form (empty state)', () => {
  it('shows Create budget in the empty state', () => {
    budgetState.data = 0;
    versionsState.data = [];
    renderPage();
    expect(screen.getByRole('button', { name: 'Create budget' })).toBeInTheDocument();
    resetState();
  });

  it('keeps the empty state but hides Create budget from roles without budget edit access', () => {
    roleState.realRole = 'Engineer';
    budgetState.data = 0;
    versionsState.data = [];
    renderPage();
    expect(screen.getByTestId('budget-option-a')).toBeInTheDocument();
    expect(screen.getByText('Budget details are available to project management and finance.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create budget' })).not.toBeInTheDocument();
    resetState();
  });

  it('shows the version form when Create budget is clicked', async () => {
    budgetState.data = 0;
    versionsState.data = [];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create budget' }));
    expect(screen.getByPlaceholderText(/Version name/i)).toBeInTheDocument();
    resetState();
  });

  it('B1: Create confirms a budget draft before writing it', async () => {
    budgetState.data = 0;
    versionsState.data = [];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create budget' }));
    await userEvent.type(screen.getByPlaceholderText(/Version name/i), 'Budget v1');
    await userEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    expect(mockCreateVersion).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Create version/i }));
    expect(mockCreateVersion).toHaveBeenCalledWith({ projectId: 'p-1', name: 'Budget v1', budgetMode: 'whole_project' });
    resetState();
  });

  it('hides form on cancel', async () => {
    budgetState.data = 0;
    versionsState.data = [];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create budget' }));
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByPlaceholderText(/Version name/i)).not.toBeInTheDocument();
    resetState();
  });
});

// Version switching is now handled by the Versions drawer and its comparison controls.
describe('ProjectBudget spending source (C-4)', () => {
  it('C-4 recorded spending comes from the project actuals, not a stale line-item amount', () => {
    budgetState.data = 4700000;
    versionsState.data = [{ ...activeVersion, line_items: activeVersion.line_items.map((li) => ({ ...li, actual_amount: 123456789 })) }];
    positionState.rows = [{ category: 'Labor', budget: 2000000, actual: 1200000 }];
    renderPage();
    const table = screen.getByRole('table', { name: 'Budget vs actual by category' });
    expect(within(table).getByText(/1,200,000/)).toBeInTheDocument();
    expect(screen.queryByText('123,456,789')).not.toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// AC-BFY-016 (FR-BFY-060/061) — THE PER-LINE FISCAL-YEAR AFFORDANCE, DRAFT ONLY.
//
// Phasing is what lets a multi-fiscal-year project reach ERPNext at all (the gate refuses a multi-FY
// project with any un-phased line), and the ONLY route to a Draft is cloning the Active version — so
// without this control the capability is unreachable from the product. Draft-only because
// `enforce_draft_line_item` (0005) rejects the write on any other status: an affordance the DB will
// refuse is worse than none.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('ProjectBudget — the per-line fiscal year (AC-BFY-016)', () => {
  const phasedDraft = {
    ...draftVersion,
    line_items: [{ ...draftVersion.line_items[0], fiscal_year: '2026' }],
  };

  it('AC-BFY-016 a Draft line SHOWS its fiscal year, and un-phased reads as un-phased (never a guessed year)', async () => {
    versionsState.data = [
      { ...draftVersion, line_items: [{ ...draftVersion.line_items[0], fiscal_year: null }] },
    ];
    renderPage();
    expect(await screen.findByText(/un-phased/i)).toBeInTheDocument();
  });

  it('AC-BFY-016 a new Draft line can be phased, and the year is PERSISTED with it', async () => {
    const user = userEvent.setup();
    versionsState.data = [draftVersion];
    renderPage();
    await user.click(await screen.findByRole('button', { name: /add line item/i }));
    await user.type(screen.getByLabelText(/line item amount/i), '50000');
    await user.type(screen.getByLabelText(/line item fiscal year/i), '2027');
    await user.click(screen.getAllByRole('button', { name: /^save$/i })[0]);
    await waitFor(() =>
      expect(mockCreateLineItem).toHaveBeenCalledWith({
        versionId: 'v-draft',
        item: expect.objectContaining({ fiscal_year: '2027' }),
      }),
    );
  });

  it('issue #1421: rejects a fiscal-year value that ERPNext does not list before saving the line', async () => {
    const user = userEvent.setup();
    versionsState.data = [draftVersion];
    renderPage();
    await user.click(await screen.findByRole('button', { name: /add line item/i }));
    await user.type(screen.getByLabelText(/line item amount/i), '50000');
    await user.type(screen.getByLabelText(/line item fiscal year/i), '202');
    await user.click(screen.getAllByRole('button', { name: /^save$/i })[0]);

    expect(await screen.findByText(/choose a fiscal year from ERPNext/i)).toBeInTheDocument();
    expect(mockCreateLineItem).not.toHaveBeenCalled();
  });

  it.each([['FY1', false], ['A', false], ['FY1', true], ['A', true]] as const)('issue #1421: accepts custom fiscal-year label %s with live calendar %s', async (label, online) => {
    activationPrecheckState.data = online
      ? { status: 'ready', erpCheck: 'available', fiscalYearNames: [label], fiscalYears: [{ name: label, start: '2026-01-01', end: '2027-12-31' }], issues: [] }
      : { status: 'erp-unavailable', erpCheck: 'unavailable', fiscalYearNames: null, fiscalYears: null, issues: [] };
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /add line item/i }));
    await userEvent.type(screen.getByLabelText(/line item amount/i), '50000');
    await userEvent.type(screen.getByLabelText(/line item fiscal year/i), label);
    await userEvent.click(screen.getAllByRole('button', { name: /^save$/i })[0]);
    await waitFor(() => expect(mockCreateLineItem).toHaveBeenCalledWith({
      versionId: 'v-draft', item: expect.objectContaining({ fiscal_year: label }),
    }));
  });

  it('issue #1421: preserves a short custom fiscal-year label when editing offline', async () => {
    activationPrecheckState.data = { status: 'erp-unavailable', erpCheck: 'unavailable', fiscalYearNames: null, fiscalYears: null, issues: [] };
    versionsState.data = [{ ...draftVersion, line_items: [{ ...draftVersion.line_items[0], fiscal_year: 'A' }] }];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /edit line item Labor/i }));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(mockUpdateLineItem).toHaveBeenCalledWith({
      id: 'li-1', patch: expect.objectContaining({ fiscal_year: 'A' }),
    }));
  });

  it('issue #1421: rejects a numeric year typo while offline', async () => {
    activationPrecheckState.data = { status: 'erp-unavailable', erpCheck: 'unavailable', fiscalYearNames: null, fiscalYears: null, issues: [] };
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /add line item/i }));
    await userEvent.type(screen.getByLabelText(/line item amount/i), '50000');
    await userEvent.type(screen.getByLabelText(/line item fiscal year/i), '202');
    await userEvent.click(screen.getAllByRole('button', { name: /^save$/i })[0]);
    expect(await screen.findByText(/choose a fiscal year from ERPNext/i)).toBeInTheDocument();
    expect(mockCreateLineItem).not.toHaveBeenCalled();
  });

  it('AC-BFY-016 a line left un-phased persists NULL — never an invented year (ADR-0048)', async () => {
    const user = userEvent.setup();
    versionsState.data = [draftVersion];
    renderPage();
    await user.click(await screen.findByRole('button', { name: /add line item/i }));
    await user.type(screen.getByLabelText(/line item amount/i), '50000');
    await user.click(screen.getAllByRole('button', { name: /^save$/i })[0]);
    await waitFor(() =>
      expect(mockCreateLineItem).toHaveBeenCalledWith({
        versionId: 'v-draft',
        item: expect.objectContaining({ fiscal_year: null }),
      }),
    );
  });

  it('AC-BFY-016 editing an existing Draft line can RE-PHASE it', async () => {
    const user = userEvent.setup();
    versionsState.data = [phasedDraft];
    renderPage();
    await user.click(await screen.findByRole('button', { name: /edit line item Labor/i }));
    const field = screen.getByLabelText(/^fiscal year$/i, { selector: 'input, select, textarea' });
    await user.clear(field);
    await user.type(field, '2027');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() =>
      expect(mockUpdateLineItem).toHaveBeenCalledWith({
        id: 'li-1',
        patch: expect.objectContaining({ fiscal_year: '2027' }),
      }),
    );
  });

  it('AC-PLC-009: an id-ID viewer can re-save an existing fractional amount unchanged', async () => {
    setActiveLocale(ID_LOCALE);
    const user = userEvent.setup();
    versionsState.data = [
      { ...draftVersion, line_items: [{ ...draftVersion.line_items[0], budgeted_amount: 1234.5 }] },
    ];
    renderPage();
    await user.click(await screen.findByRole('button', { name: /edit line item Labor/i }));
    expect(screen.getByRole('textbox', { name: /^amount$/i })).toHaveValue('1.234,5');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() =>
      expect(mockUpdateLineItem).toHaveBeenCalledWith({
        id: 'li-1',
        patch: expect.objectContaining({ budgeted_amount: 1234.5 }),
      }),
    );
  });

  it('AC-M365DOC-052 mounts the Microsoft evidence panel beneath the selected version only', async () => {
    versionsState.data = [{ ...activeVersion, line_items: [] }];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(screen.getByTestId('evidence-v-active')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// budget-whole-project AC-001 (S6A) — whole-project default + phase-free source editor
// ---------------------------------------------------------------------------
describe('budget-whole-project AC-001 (S6A)', () => {
  const wholeProjectDraft = {
    ...draftVersion,
    budget_mode: 'whole_project',
    line_items: [{ ...draftVersion.line_items[0], fiscal_year: null }],
  };
  const currentWholeProjectDistribution = {
    method: 'by_days',
    inputs: {},
    categoryOverrides: {},
    basis: {
      projectStart: '2026-01-01',
      projectEnd: '2027-12-31',
      years: [
        { name: '2026', start: '2026-01-01', end: '2026-12-31' },
        { name: '2027', start: '2027-01-01', end: '2027-12-31' },
      ],
    },
    rows: [
      { category: 'Labor', fiscal_year: '2026', ordinal: 0, amount: '100000.00', method: 'by_days', is_override: false },
      { category: 'Labor', fiscal_year: '2027', ordinal: 1, amount: '100000.00', method: 'by_days', is_override: false },
    ],
  };

  afterEach(resetState);

  it('a new budget created from the UI is created in whole_project mode', async () => {
    budgetState.data = 0;
    versionsState.data = [];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create budget' }));
    await userEvent.type(screen.getByPlaceholderText(/Version name/i), 'Budget v1');
    await userEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    await userEvent.click(screen.getByRole('button', { name: /Create version/i }));
    expect(mockCreateVersion).toHaveBeenCalledWith({ projectId: 'p-1', name: 'Budget v1', budgetMode: 'whole_project' });
  });

  it('a whole-project Draft source editor omits the fiscal-year control and new lines save fiscal_year null', async () => {
    budgetState.data = 0;
    versionsState.data = [wholeProjectDraft];
    renderPage();
    const editor = screen.getByTestId('budget-draft-editor');
    expect(within(editor).queryByRole('columnheader', { name: 'Fiscal year' })).not.toBeInTheDocument();
    await userEvent.click(within(editor).getByText(/\+ Add line item/i));
    expect(within(editor).queryByLabelText(/line item fiscal year/i)).not.toBeInTheDocument();
    await userEvent.type(within(editor).getByPlaceholderText(/Amount/i), '15000');
    await userEvent.click(within(editor).getByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(mockCreateLineItem).toHaveBeenCalledWith({
      versionId: 'v-draft',
      item: expect.objectContaining({ budgeted_amount: 15000, fiscal_year: null }),
    }));
  });

  it('editing an existing line in a whole-project Draft never sends a fiscal-year patch', async () => {
    budgetState.data = 0;
    versionsState.data = [wholeProjectDraft];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Edit line item Labor' }));
    const amount = screen.getByLabelText('Amount');
    await userEvent.clear(amount);
    await userEvent.type(amount, '250000');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockUpdateLineItem).toHaveBeenCalledTimes(1));
    const { patch } = mockUpdateLineItem.mock.calls[0][0] as { patch: Record<string, unknown> };
    expect(patch).toMatchObject({ budgeted_amount: 250000 });
    expect(patch).not.toHaveProperty('fiscal_year');
  });

  it('a per-year Draft keeps its fiscal-year control and still sends the entered year', async () => {
    budgetState.data = 0;
    versionsState.data = [{ ...draftVersion, budget_mode: 'per_year' }];
    renderPage();
    const editor = screen.getByTestId('budget-draft-editor');
    expect(within(editor).getByRole('columnheader', { name: 'Fiscal year' })).toBeInTheDocument();
    await userEvent.click(within(editor).getByText(/\+ Add line item/i));
    await userEvent.type(within(editor).getByLabelText(/line item fiscal year/i), '2026');
    await userEvent.type(within(editor).getByPlaceholderText(/Amount/i), '5000');
    await userEvent.click(within(editor).getByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(mockCreateLineItem).toHaveBeenCalledWith({
      versionId: 'v-draft',
      item: expect.objectContaining({ budgeted_amount: 5000, fiscal_year: '2026' }),
    }));
  });

  it('a whole-project Draft names its mode next to the source editor', () => {
    budgetState.data = 0;
    versionsState.data = [wholeProjectDraft];
    renderPage();
    expect(screen.getByTestId('budget-whole-project-editor-hint')).toHaveTextContent(/whole-project/i);
  });

  it('AC-005 allocates unequal inherited totals, preserves zero, and applies then removes one category override', async () => {
    roleState.realRole = 'Finance';
    budgetState.data = 0;
    const wholeProjectWithTotals = {
      ...wholeProjectDraft,
      line_items: [
        { ...wholeProjectDraft.line_items[0], id: 'li-labor', category: 'Labor', budgeted_amount: 100, description: 'Labor' },
        { ...wholeProjectDraft.line_items[0], id: 'li-travel', category: 'Travel', budgeted_amount: 250, description: 'Travel' },
        { ...wholeProjectDraft.line_items[0], id: 'li-zero', category: 'Contingency', budgeted_amount: 0, description: 'Zero reserve' },
      ],
    };
    versionsState.data = [wholeProjectWithTotals];
    renderPage();

    expect(screen.getByRole('button', { name: /^Activate v2$/i })).toBeDisabled();
    expect(screen.getByTestId('budget-readiness-summary')).toHaveTextContent(/save a fiscal-year distribution/i);
    // The grid renders twice now — the tablet/desktop table and the phone row list (`sm:hidden`) — and
    // jsdom applies no Tailwind display classes, so the shared controls live in two places in the DOM.
    // This journey is the desktop grid's: scope its controls to the table instead of the whole screen.
    const grid = () => screen.getByRole('table', { name: 'Category fiscal-year distribution' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Distribution method' }), 'amount_by_year');
    await userEvent.type(screen.getByRole('textbox', { name: 'Shared input for 2026' }), '1');
    await userEvent.type(screen.getByRole('textbox', { name: 'Shared input for 2027' }), '3');
    await userEvent.click(within(grid()).getByRole('checkbox', { name: 'Use custom distribution for Travel' }));
    await userEvent.type(within(grid()).getByRole('textbox', { name: 'Travel input for 2026' }), '100');
    const travel2027 = within(grid()).getByRole('textbox', { name: 'Travel input for 2027' });
    await userEvent.type(travel2027, '140');
    await userEvent.click(screen.getByRole('button', { name: 'Preview distribution' }));
    expect(screen.getByTestId('distribution-validation-summary')).toHaveTextContent(/amounts must add up to the category total/i);
    expect(screen.queryByTestId('budget-distribution-preview-status')).not.toBeInTheDocument();
    await userEvent.clear(travel2027);
    await userEvent.type(travel2027, '150');
    await userEvent.click(screen.getByRole('button', { name: 'Preview distribution' }));

    expect(within(grid()).getByRole('row', { name: /Labor/ })).toHaveTextContent('$25.00');
    expect(within(grid()).getByRole('row', { name: /Labor/ })).toHaveTextContent('$75.00');
    expect(within(grid()).getByRole('row', { name: /Travel/ })).toHaveTextContent('$100.00');
    expect(within(grid()).getByRole('row', { name: /Travel/ })).toHaveTextContent('$150.00');
    expect(within(grid()).getByRole('row', { name: /Contingency/ })).toHaveTextContent('$0.00');
    expect(screen.getByRole('button', { name: /^Activate v2$/i })).toBeDisabled();

    await userEvent.click(within(grid()).getByRole('checkbox', { name: 'Use custom distribution for Travel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Preview distribution' }));
    const inheritedTravel = within(grid()).getByRole('row', { name: /Travel/ });
    expect(inheritedTravel).toHaveTextContent('$62.50');
    expect(inheritedTravel).toHaveTextContent('$187.50');
    expect(screen.getByRole('button', { name: /^Activate v2$/i })).toBeDisabled();
    expect(mockSaveBudgetDistribution).not.toHaveBeenCalled();
  });

  it('AC-006 identifies invalid distribution fields and keeps whole-project activation blocked', async () => {
    roleState.realRole = 'Finance';
    budgetState.data = 0;
    versionsState.data = [wholeProjectDraft];
    renderPage();

    const activate = screen.getByRole('button', { name: /^Activate v2$/i });
    expect(activate).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Distribution method' }), 'percent_by_year');
    expect(screen.getByTestId('distribution-validation-summary')).toHaveTextContent(/enter a value for 2026/i);
    const firstYear = screen.getByRole('textbox', { name: 'Shared input for 2026' });
    const secondYear = screen.getByRole('textbox', { name: 'Shared input for 2027' });
    await userEvent.type(firstYear, '-5');
    await userEvent.type(secondYear, '105');
    expect(screen.getByTestId('distribution-validation-summary')).toHaveTextContent(/zero or a positive value for 2026/i);
    expect(firstYear).toHaveAttribute('aria-invalid', 'true');
    expect(firstYear).toHaveAttribute('aria-describedby');
    expect(activate).toBeDisabled();

    await userEvent.clear(firstYear);
    await userEvent.clear(secondYear);
    await userEvent.type(firstYear, '110');
    await userEvent.type(secondYear, '0');
    expect(screen.getByTestId('distribution-validation-summary')).toHaveTextContent(/percentage from 0 to 100 for 2026/i);
    expect(firstYear).toHaveAttribute('aria-invalid', 'true');

    await userEvent.clear(firstYear);
    await userEvent.clear(secondYear);
    await userEvent.type(firstYear, 'Infinity');
    await userEvent.type(secondYear, '40');
    expect(screen.getByTestId('distribution-validation-summary')).toHaveTextContent(/enter a valid number for 2026/i);
    expect(activate).toBeDisabled();

    await userEvent.clear(firstYear);
    await userEvent.type(firstYear, '50');
    expect(screen.getByTestId('distribution-validation-summary')).toHaveTextContent(/percentages must total 100%/i);
    expect(activate).toBeDisabled();

    await userEvent.clear(firstYear);
    await userEvent.clear(secondYear);
    await userEvent.type(firstYear, '0');
    await userEvent.type(secondYear, '100');
    expect(screen.queryByTestId('distribution-validation-summary')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Preview distribution' }));
    expect(screen.getByTestId('budget-distribution-preview-status')).toBeInTheDocument();
    const grid = screen.getByRole('table', { name: 'Category fiscal-year distribution' });
    expect(within(grid).getByRole('row', { name: /Labor/ })).toHaveTextContent('$0.00');
    expect(within(grid).getByRole('row', { name: /Labor/ })).toHaveTextContent('$200,000.00');
    expect(activate).toBeDisabled();
  });

  it('AC-008 allows a distinct eligible approver when the saved whole-project distribution is current', async () => {
    roleState.realRole = 'Finance';
    budgetState.data = 0;
    versionsState.data = [wholeProjectDraft];
    budgetDistributionState.data = currentWholeProjectDistribution;
    renderPage();

    const activate = screen.getByRole('button', { name: /^Activate v2$/i });
    await waitFor(() => expect(activate).toBeEnabled());
    await userEvent.click(activate);
    const confirm = screen.getByRole('button', { name: /Activate version/i });
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(mockActivate).toHaveBeenCalledWith('v-draft');
  });

  it('AC-006 blocks activation for a saved distribution whose fiscal-year basis is out of span', async () => {
    roleState.realRole = 'Finance';
    budgetState.data = 0;
    versionsState.data = [wholeProjectDraft];
    budgetDistributionState.data = {
      ...currentWholeProjectDistribution,
      basis: {
        ...currentWholeProjectDistribution.basis,
        projectStart: '2025-01-01',
        years: [
          { name: '2025', start: '2025-01-01', end: '2025-12-31' },
          { name: '2026', start: '2026-01-01', end: '2026-12-31' },
        ],
      },
      rows: [
        { category: 'Labor', fiscal_year: '2025', ordinal: 0, amount: '100000.00', method: 'by_days', is_override: false },
        { category: 'Labor', fiscal_year: '2026', ordinal: 1, amount: '100000.00', method: 'by_days', is_override: false },
      ],
    };
    renderPage();

    expect(await screen.findByText(/saved fiscal-year distribution no longer matches this draft/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Activate v2$/i })).toBeDisabled();
  });

  it('keeps the confirmed distribution write visible when its refreshed plan does not match the reviewed plan', async () => {
    budgetState.data = 0;
    versionsState.data = [wholeProjectDraft];
    mockBudgetRepository.getDistribution.mockResolvedValueOnce(null);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview distribution' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save reviewed distribution' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save this distribution?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save distribution' }));

    const recovery = await screen.findByTestId('budget-authoring-recovery');
    expect(recovery).toHaveTextContent(/change was saved, but the refreshed draft differs/i);
    expect(recovery).not.toHaveTextContent(/could not confirm whether/i);
    expect(screen.queryByText('Fiscal-year distribution saved')).not.toBeInTheDocument();
    expect(mockSaveBudgetDistribution).toHaveBeenCalledTimes(1);

    await userEvent.click(within(recovery).getByRole('button', { name: 'Review current draft' }));
    expect(screen.queryByTestId('budget-authoring-recovery')).not.toBeInTheDocument();
    expect(mockSaveBudgetDistribution).toHaveBeenCalledTimes(1);
  });

  it('keeps an unknown distribution transport outcome uncertain and offers read reconciliation only', async () => {
    budgetState.data = 0;
    versionsState.data = [wholeProjectDraft];
    mockSaveBudgetDistribution.mockRejectedValueOnce(new Error('connection ended before a response'));
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview distribution' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save reviewed distribution' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save this distribution?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save distribution' }));
    const recovery = await screen.findByTestId('budget-authoring-recovery');
    expect(recovery).toHaveTextContent(/save outcome is uncertain/i);
    expect(recovery).not.toHaveTextContent(/was saved/i);
    expect(mockSaveBudgetDistribution).toHaveBeenCalledTimes(1);

    await userEvent.click(within(recovery).getByRole('button', { name: 'Refresh budget data' }));
    expect(await screen.findByText(/current budget data is loaded. review the draft/i)).toBeInTheDocument();
    expect(mockSaveBudgetDistribution).toHaveBeenCalledTimes(1);
  });
});

describe('budget draft mode switching (#1472 B2/B3)', () => {
  afterEach(resetState);

  it('waits for both source and distribution reads before reporting the committed mode change', async () => {
    let finishVersionRead!: (value: unknown) => void;
    let finishDistributionRead!: (value: unknown) => void;
    const deferredVersionRead = new Promise<unknown>((resolve) => { finishVersionRead = resolve; });
    const deferredDistributionRead = new Promise<unknown>((resolve) => { finishDistributionRead = resolve; });
    versionsState.refetch.mockImplementation(() => deferredVersionRead);
    mockBudgetRepository.getDistribution.mockReturnValueOnce(deferredDistributionRead);
    budgetState.data = 0;
    versionsState.data = [{ ...draftVersion, budget_mode: 'per_year' }];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Change budget mode' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change budget mode' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch to whole-project' }));
    await waitFor(() => expect(mockBudgetRepository.getDistribution).toHaveBeenCalledWith('v-draft'));
    expect(versionsState.refetch).toHaveBeenCalled();
    expect(mockSwitchBudgetDraftMode).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByText('Budget mode changed')).toHaveLength(0);

    await act(async () => { finishDistributionRead(null); });
    expect(screen.queryAllByText('Budget mode changed')).toHaveLength(0);
    await act(async () => { finishVersionRead({
      data: [{ ...draftVersion, budget_mode: 'whole_project', line_items: [{ ...draftVersion.line_items[0], fiscal_year: null }] }],
      isError: false,
    }); });
    await waitFor(() => expect(screen.getAllByText('Budget mode changed').length).toBeGreaterThan(0));
  });

  it('shows refresh and review when only readback fails and does not replay the committed write', async () => {
    const switchedDraft = { ...draftVersion, budget_mode: 'whole_project', line_items: [{ ...draftVersion.line_items[0], fiscal_year: null }] };
    mockBudgetRepository.getDistribution.mockRejectedValueOnce(new Error('read after commit failed'));
    budgetState.data = 0;
    versionsState.data = [{ ...draftVersion, budget_mode: 'per_year' }];
    versionsState.refetch.mockResolvedValue({ data: [switchedDraft], isError: false });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Change budget mode' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change budget mode' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch to whole-project' }));

    const recovery = await screen.findByTestId('budget-authoring-recovery');
    expect(recovery).toHaveTextContent(/A change was saved, but a selected budget read failed/i);
    expect(recovery).not.toHaveTextContent(/not saved/i);
    expect(mockSwitchBudgetDraftMode).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Change budget mode' })).not.toBeInTheDocument();
    expect(screen.queryByText('Budget mode changed')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Refresh budget data' }));
    await waitFor(() => expect(screen.queryByTestId('budget-authoring-recovery')).not.toBeInTheDocument());
    expect(mockSwitchBudgetDraftMode).toHaveBeenCalledTimes(1);
  });

  it('keeps confirmed-save recovery above the global read error and retries reads only', async () => {
    const switchedDraft = { ...draftVersion, budget_mode: 'whole_project', line_items: [{ ...draftVersion.line_items[0], fiscal_year: null }] };
    budgetState.data = 0;
    versionsState.data = [{ ...draftVersion, budget_mode: 'per_year' }];
    versionsState.refetch.mockImplementationOnce(async () => {
      versionsState.isError = true;
      return { data: undefined, isError: true };
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Change budget mode' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change budget mode' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch to whole-project' }));
    const recovery = await screen.findByTestId('budget-authoring-recovery');
    const globalError = screen.getByText("Couldn't load budget");
    expect(recovery).toHaveTextContent(/A change was saved/i);
    expect(recovery.compareDocumentPosition(globalError) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    versionsState.isError = false;
    versionsState.refetch.mockImplementation(() => Promise.resolve({ data: [switchedDraft], isError: false }));
    await userEvent.click(within(recovery).getByRole('button', { name: 'Refresh budget data' }));
    await waitFor(() => expect(screen.queryByTestId('budget-authoring-recovery')).not.toBeInTheDocument());
    expect(mockSwitchBudgetDraftMode).toHaveBeenCalledTimes(1);
  });

  it('does not describe a 40001 stale refusal as saved when its recovery read fails', async () => {
    const staleRefusal = Object.assign(new Error('draft changed'), { code: '40001' });
    mockSwitchBudgetDraftMode.mockRejectedValueOnce(staleRefusal);
    budgetState.data = 0;
    versionsState.data = [{ ...draftVersion, budget_mode: 'per_year' }];
    versionsState.refetch.mockRejectedValueOnce(new Error('read after stale refusal failed'));
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Change budget mode' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change budget mode' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch to whole-project' }));
    const recovery = await screen.findByTestId('budget-authoring-recovery');
    expect(recovery).toHaveTextContent(/server rejected this change because the draft changed; it was not saved/i);
    expect(recovery).not.toHaveTextContent(/A change was saved/i);
    expect(mockSwitchBudgetDraftMode).toHaveBeenCalledTimes(1);
  });

  it('per-year to whole-project presents the exact source totals and changes only after explicit confirmation', async () => {
    budgetState.data = 0;
    const perYearDraft = {
      ...draftVersion,
      budget_mode: 'per_year',
      line_items: [
        { ...draftVersion.line_items[0], id: 'li-labor', category: 'Labor', budgeted_amount: 200000, fiscal_year: '2026' },
        { ...draftVersion.line_items[0], id: 'li-travel', category: 'Travel', description: 'Travel', budgeted_amount: 1000.25, fiscal_year: '2027' },
      ],
    };
    versionsState.data = [perYearDraft];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Change budget mode' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change budget mode' });
    const review = within(dialog).getByRole('table', { name: 'Budget line review' });
    expect(within(review).getByRole('row', { name: /Labor Developers 2026/ })).toHaveTextContent(/200,000\.00/);
    expect(within(review).getByRole('row', { name: /Travel Travel 2027/ })).toHaveTextContent(/1,000\.25/);
    expect(mockSwitchBudgetDraftMode).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(mockSwitchBudgetDraftMode).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Change budget mode' }));
    const reopened = await screen.findByRole('dialog', { name: 'Change budget mode' });
    await userEvent.click(within(reopened).getByRole('button', { name: 'Switch to whole-project' }));
    await waitFor(() => expect(mockSwitchBudgetDraftMode).toHaveBeenCalledWith({
      versionId: 'v-draft',
      targetMode: 'whole_project',
      expectedLines: [
        { id: 'li-labor', category: 'Labor', budgeted_amount: '200000.00', fiscal_year: '2026' },
        { id: 'li-travel', category: 'Travel', budgeted_amount: '1000.25', fiscal_year: '2027' },
      ],
      assignments: [],
    }));
  });

  it('whole-project to per-year requires an explicit fiscal year for every line before confirming', async () => {
    budgetState.data = 0;
    versionsState.data = [{
      ...draftVersion,
      budget_mode: 'whole_project',
      line_items: [
        { ...draftVersion.line_items[0], id: 'li-labor', budgeted_amount: 200000, fiscal_year: null },
        { ...draftVersion.line_items[0], id: 'li-travel', category: 'Travel', description: 'Travel', budgeted_amount: 1000.25, fiscal_year: null },
      ],
    }];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Change budget mode' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change budget mode' });
    expect(within(dialog).getByText(/all fiscal-year assignments are required/i)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Switch to per-year' });
    expect(confirm).toBeDisabled();
    expect(mockSwitchBudgetDraftMode).not.toHaveBeenCalled();

    await userEvent.selectOptions(within(dialog).getByLabelText('Fiscal year for Developers'), '2026');
    await userEvent.selectOptions(within(dialog).getByLabelText('Fiscal year for Travel'), '2027');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(mockSwitchBudgetDraftMode).toHaveBeenCalledWith({
      versionId: 'v-draft',
      targetMode: 'per_year',
      expectedLines: [
        { id: 'li-labor', category: 'Labor', budgeted_amount: '200000.00', fiscal_year: null },
        { id: 'li-travel', category: 'Travel', budgeted_amount: '1000.25', fiscal_year: null },
      ],
      assignments: [
        { id: 'li-labor', fiscal_year: '2026' },
        { id: 'li-travel', fiscal_year: '2027' },
      ],
    }));
  });
});

// ---------------------------------------------------------------------------
// budget-whole-project AC-018 / FR-022 — stale Active distribution banner (plan 6.5)
// ---------------------------------------------------------------------------
describe('budget-whole-project FR-022 stale Active distribution banner', () => {
  const wholeActive = { ...activeVersion, budget_mode: 'whole_project' };
  const savedPlan = (projectEnd: string | null) => ({
    method: 'by_days', inputs: {}, categoryOverrides: {}, rows: [],
    basis: {
      projectStart: '2026-01-01',
      projectEnd,
      years: [
        { name: '2026', start: '2026-01-01', end: '2026-12-31' },
        ...(projectEnd === '2027-12-31' ? [{ name: '2027', start: '2027-01-01', end: '2027-12-31' }] : []),
      ],
    },
  });

  it('names the new end date and covered years, mutates nothing on read, and Prepare new draft clones after confirmation', async () => {
    budgetState.data = 4700000;
    versionsState.data = [wholeActive];
    budgetDistributionState.data = savedPlan('2026-12-31');
    renderPage();
    const banner = screen.getByTestId('budget-stale-distribution');
    expect(banner).toHaveTextContent('2027-12-31');
    expect(banner).toHaveTextContent('2026');
    expect(mockClone).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Prepare new draft' }));
    expect(mockClone).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Clone version/i }));
    expect(mockClone).toHaveBeenCalledWith('v-active');
  });

  it('is absent when the saved basis still matches, for per-year budgets, and for read-only roles it offers no action', async () => {
    budgetState.data = 4700000;
    versionsState.data = [wholeActive];
    budgetDistributionState.data = savedPlan('2027-12-31');
    const { unmount } = renderPage();
    expect(screen.queryByTestId('budget-stale-distribution')).not.toBeInTheDocument();
    unmount();
    versionsState.data = [activeVersion];
    budgetDistributionState.data = savedPlan('2026-12-31');
    const second = renderPage();
    expect(screen.queryByTestId('budget-stale-distribution')).not.toBeInTheDocument();
    second.unmount();
    versionsState.data = [wholeActive];
    roleState.realRole = 'Engineer';
    renderPage();
    expect(screen.queryByRole('button', { name: 'Prepare new draft' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// #1473 slice C — paste rows dialog (AC-003/004/006/008)
// ---------------------------------------------------------------------------
describe('budget paste rows dialog (#1473 C)', () => {
  const tsv = (...rows: string[][]) => rows.map((r) => r.join('\t')).join('\n');
  const openPaste = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Paste rows' }));
    return screen.findByRole('dialog', { name: 'Paste rows' });
  };
  const paste = async (dialog: HTMLElement, text: string) => {
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Rows pasted from a spreadsheet/i }), { target: { value: text } });
  };
  const setup = () => {
    budgetState.data = 2000000;
    versionsState.data = [activeVersion, draftVersion];
    return renderPage();
  };

  it('AC-006 offers Paste rows for Admin, Executive, Project Manager and Finance on a Draft only', () => {
    for (const role of ['Admin', 'Executive', 'Project Manager', 'Finance']) {
      roleState.realRole = role;
      const view = setup();
      expect(screen.getByRole('button', { name: 'Paste rows' })).toBeInTheDocument();
      view.unmount();
    }
  });

  it('AC-006 hides Paste rows for Engineer, for an impersonated session, and when no Draft exists', () => {
    roleState.realRole = 'Engineer';
    let view = setup();
    expect(screen.queryByRole('button', { name: 'Paste rows' })).not.toBeInTheDocument();
    view.unmount();

    roleState.realRole = 'Engineer';
    roleState.effectiveRole = 'Admin';
    view = setup();
    expect(screen.queryByRole('button', { name: 'Paste rows' })).not.toBeInTheDocument();
    view.unmount();

    roleState.realRole = 'Finance';
    roleState.effectiveRole = undefined;
    versionsState.data = [activeVersion, { ...archivedVersion }];
    budgetState.data = 2000000;
    renderPage();
    expect(screen.queryByRole('button', { name: 'Paste rows' })).not.toBeInTheDocument();
  });

  it('AC-003 previews a mixed set, lets the user map an unknown category, and Save names exactly the valid rows', async () => {
    setup();
    const dialog = await openPaste();
    expect(within(dialog).getByRole('button', { name: /^Save 0 valid rows$/ })).toBeDisabled();
    await paste(dialog, tsv(['Labor', 'Dev work', '1,200.50'], ['Hardware', 'Servers', '300'], ['Materials', 'Bad', '12.345'], ['', 'No category', '5']));

    expect(within(dialog).getByTestId('paste-summary')).toHaveTextContent('1 valid, 3 invalid');
    expect(within(dialog).getByText(/Unknown category/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Amount is not a valid positive number/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Category is required/)).toBeInTheDocument();

    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /Map "Hardware" to/ }), 'Equipment');
    expect(within(dialog).getByTestId('paste-summary')).toHaveTextContent('2 valid, 2 invalid');
    expect(within(dialog).getByRole('button', { name: 'Save 2 valid rows' })).toBeEnabled();
    expect(mockBudgetRepository.createLineItem).not.toHaveBeenCalled();
  });

  it('AC-003 treats the first row as data unless the header box is ticked, and calculates Quantity × Rate exactly', async () => {
    setup();
    const dialog = await openPaste();
    await paste(dialog, tsv(['Type', 'Item', 'Qty', 'Unit'], ['Labor', 'Dev', '2.5', '3.3']));
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Amount column' }), '');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Quantity column' }), '2');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Rate column' }), '3');
    expect(within(dialog).getByRole('radio', { name: 'Use Quantity × Rate' })).toBeChecked();
    expect(within(dialog).getByTestId('paste-summary')).toHaveTextContent('1 valid, 1 invalid');
    expect(within(dialog).getByText(/Quantity must be a positive number/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'First row is a header' }));
    expect(within(dialog).getByTestId('paste-summary')).toHaveTextContent('1 valid, 0 invalid');
    expect(within(dialog).getByTestId('paste-summary')).toHaveTextContent('$8.25');
    expect(within(dialog).getByRole('cell', { name: '$8.25' })).toBeInTheDocument();
  });

  it('AC-003 requires an explicit mode when both Amount and Quantity × Rate are mapped', async () => {
    setup();
    const dialog = await openPaste();
    await paste(dialog, tsv(['Labor', 'Dev', '10', '2', '3']));
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Quantity column' }), '3');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Rate column' }), '4');
    expect(within(dialog).getByRole('radio', { name: 'Use Amount' })).not.toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'Use Quantity × Rate' })).not.toBeChecked();
    expect(within(dialog).getAllByText(/Choose Amount or Quantity × Rate/).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: /^Save \d+ valid rows?$/ })).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Use Quantity × Rate' }));
    expect(within(dialog).getByRole('button', { name: 'Save 1 valid row' })).toBeEnabled();
    expect(within(dialog).getByRole('cell', { name: '$6.00' })).toBeInTheDocument();
  });

  it('AC-004 cannot confirm empty, unmapped, or over-500-row input', async () => {
    setup();
    const dialog = await openPaste();
    const save = () => within(dialog).getByRole('button', { name: /^Save \d+ valid rows?$/ });
    expect(save()).toBeDisabled();
    await paste(dialog, tsv(['Labor', 'x', '5']));
    expect(save()).toBeEnabled();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Category column' }), '');
    expect(save()).toBeDisabled();
    expect(within(dialog).getByText(/Choose the required columns/)).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Category column' }), '0');
    await paste(dialog, Array.from({ length: 501 }, () => 'Labor\tx\t1.00').join('\n'));
    expect(save()).toBeDisabled();
    expect(within(dialog).getByText(/Paste at most 500 rows/)).toBeInTheDocument();
    expect(mockBudgetRepository.createLineItem).not.toHaveBeenCalled();
  });

  it('AC-004 cancel writes nothing, asks before discarding pasted rows, and returns focus to the trigger', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Paste rows' });
    const dialog = await openPaste();
    await paste(dialog, tsv(['Labor', 'x', '5']));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Paste rows' })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(mockBudgetRepository.createLineItem).not.toHaveBeenCalled();
  });

  it('AC-004 drops the preview when the selected version changes', async () => {
    setup();
    const dialog = await openPaste();
    await paste(dialog, tsv(['Labor', 'x', '5']));
    fireEvent.change(screen.getByLabelText('Version', { selector: 'select' }), { target: { value: 'v-active' } });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Paste rows' })).not.toBeInTheDocument());
    expect(mockBudgetRepository.createLineItem).not.toHaveBeenCalled();
  });

  it('FR-009/010 saves valid rows to the captured Draft with exact amounts, then refreshes budget data', async () => {
    setup();
    const dialog = await openPaste();
    await paste(dialog, tsv(['Labor', 'Dev work', '1,200.50'], ['Materials', '', '300']));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save 2 valid rows' }));

    await waitFor(() => expect(within(dialog).getByTestId('paste-result-summary')).toHaveTextContent('2 of 2 rows saved.'));
    expect(mockBudgetRepository.createLineItem.mock.calls).toEqual([
      ['v-draft', { category: 'Labor', description: 'Dev work', budgeted_amount: 1200.5 }],
      ['v-draft', { category: 'Materials', description: null, budgeted_amount: 300 }],
    ]);
    expect(mockRefreshBudgetQueries).toHaveBeenCalledWith(expect.anything(), 'org-1', 'p-1');
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: /Rows pasted from a spreadsheet/i })).not.toBeInTheDocument();
  });

  it('FR-009 submits only the valid rows of a mixed set', async () => {
    setup();
    const dialog = await openPaste();
    await paste(dialog, tsv(['Labor', 'ok', '100'], ['Labor', 'no amount', ''], ['Materials', 'bad amount', '1.2.3'], ['Materials', 'ok too', '50']));
    expect(within(dialog).getByTestId('paste-summary')).toHaveTextContent('2 valid, 2 invalid');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save 2 valid rows' }));
    await waitFor(() => expect(within(dialog).getByTestId('paste-result-summary')).toHaveTextContent('2 of 2 rows saved.'));
    expect(mockBudgetRepository.createLineItem.mock.calls).toEqual([
      ['v-draft', { category: 'Labor', description: 'ok', budgeted_amount: 100 }],
      ['v-draft', { category: 'Materials', description: 'ok too', budgeted_amount: 50 }],
    ]);
  });

  it('FR-005 notes a 12,345 amount and needs one explicit confirmation before saving', async () => {
    setup();
    const dialog = await openPaste();
    await paste(dialog, tsv(['Labor', 'comma', '12,345'], ['Materials', 'plain', '1,200.50'], ['Labor', 'second', '9,876']));
    expect(within(dialog).getAllByTestId('paste-ambiguous-note')).toHaveLength(2);
    expect(within(dialog).getByRole('button', { name: 'Save 3 valid rows' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /2 amounts like 12,345 are read as thousands/ }));
    expect(within(dialog).getByRole('button', { name: 'Save 3 valid rows' })).toBeEnabled();
    // Changing the pasted set drops the confirmation.
    await paste(dialog, tsv(['Labor', 'comma', '12,345'], ['Materials', 'plain', '1,200.50']));
    expect(within(dialog).getByRole('button', { name: 'Save 2 valid rows' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /1 amounts? like 12,345/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save 2 valid rows' }));
    await waitFor(() => expect(within(dialog).getByTestId('paste-result-summary')).toHaveTextContent('2 of 2 rows saved.'));
    expect(mockBudgetRepository.createLineItem.mock.calls[0]).toEqual(['v-draft', { category: 'Labor', description: 'comma', budgeted_amount: 12345 }]);
  });

  it('FR-005 asks for no confirmation when no amount is ambiguous', async () => {
    setup();
    const dialog = await openPaste();
    await paste(dialog, tsv(['Labor', 'a', '1,200.50'], ['Materials', 'b', '12,34']));
    expect(within(dialog).queryByTestId('paste-ambiguous-note')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox', { name: /like 12,345/ })).not.toBeInTheDocument();
  });

  it('FR-010 reports a partial reject per row and a retry submits only the failure', async () => {
    mockBudgetRepository.createLineItem
      .mockResolvedValueOnce({ id: 'a' })
      .mockRejectedValueOnce(Object.assign(new Error('out of range'), { code: '22003' }))
      .mockResolvedValueOnce({ id: 'c' });
    setup();
    const dialog = await openPaste();
    await paste(dialog, tsv(['Labor', 'one', '10'], ['Labor', 'two', '20'], ['Labor', 'three', '30']));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save 3 valid rows' }));

    await waitFor(() => expect(within(dialog).getByTestId('paste-result-summary')).toHaveTextContent('2 of 3 rows saved.'));
    expect(within(dialog).getByText(/Row 2 · Labor · 20.00: Not saved/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Row 1 · Labor · 10.00: Saved/)).toBeInTheDocument();

    mockBudgetRepository.createLineItem.mockResolvedValueOnce({ id: 'b' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry 1 failed row' }));
    await waitFor(() => expect(within(dialog).getByTestId('paste-result-summary')).toHaveTextContent('3 of 3 rows saved.'));
    expect(mockBudgetRepository.createLineItem).toHaveBeenCalledTimes(4);
    expect(mockBudgetRepository.createLineItem.mock.calls[3][1]).toMatchObject({ description: 'two', budgeted_amount: 20 });
    expect(within(dialog).queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
  });

  it('AC-010 marks an unconfirmed write uncertain, stops the batch, and offers no automatic retry', async () => {
    mockBudgetRepository.createLineItem
      .mockResolvedValueOnce({ id: 'a' })
      .mockRejectedValueOnce(new Error('network lost'));
    setup();
    const dialog = await openPaste();
    await paste(dialog, tsv(['Labor', 'one', '10'], ['Labor', 'two', '20'], ['Labor', 'three', '30']));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save 3 valid rows' }));

    await waitFor(() => expect(within(dialog).getByText(/Row 2 · Labor · 20.00: Not confirmed/)).toBeInTheDocument());
    expect(within(dialog).getByText(/Row 3 · Labor · 30.00: Not submitted/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
    expect(mockBudgetRepository.createLineItem).toHaveBeenCalledTimes(2);
    expect(mockRefreshBudgetQueries).toHaveBeenCalled();
    // AC-ERR-001: the rejection also shows inline in the dialog (outlives the toast).
    expect(await within(dialog).findByTestId('entity-modal-save-error')).toBeInTheDocument();
  });

  it('AC-008 has no axe violations, announces results in a live region, and reads in Bahasa', async () => {
    await financeTestI18n.changeLanguage('id');
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Tempel baris' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tempel baris' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Baris yang ditempel dari spreadsheet/i }), { target: { value: tsv(['Labor', 'x', '5'], ['Zzz', 'y', '6']) } });
    expect(within(dialog).getByTestId('paste-summary')).toHaveTextContent('1 valid, 1 tidak valid');
    expect(within(dialog).getByText(/Kategori tidak dikenal/)).toBeInTheDocument();
    expect(await axe(dialog)).toHaveNoViolations();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan 1 baris valid' }));
    const summary = await within(dialog).findByTestId('paste-result-summary');
    await waitFor(() => expect(summary).toHaveTextContent('1 dari 1 baris tersimpan.'));
    expect(summary).toHaveAttribute('role', 'status');
    expect(summary).toHaveAttribute('aria-live', 'polite');
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it('AC-008 keeps the wide preview inside its own scroll container', async () => {
    setup();
    const dialog = await openPaste();
    await paste(dialog, tsv(['Labor', 'x', '5']));
    const region = within(dialog).getByRole('region', { name: 'Preview' });
    expect(region).toHaveClass('overflow-auto');
    expect(region).toHaveAttribute('tabindex', '0');
  });
});
