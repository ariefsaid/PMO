import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import { BahasaProvider } from '@/test/bahasa';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

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
const activationModeState = { data: undefined as string | undefined, isPending: false, isError: false };
const positionState = { isPending: false, isError: false, refetch: vi.fn(), hasBudget: true, canSeeActual: true, rows: [] as unknown[], unknown: 0 };
const procurementsState = { data: [] as unknown[], isPending: false, isError: false };
const budgetPushState = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

const mockActivate = vi.fn().mockResolvedValue({ pushState: 'pushed' });
const mockArchive = vi.fn().mockResolvedValue(undefined);
const mockClone = vi.fn().mockResolvedValue('v-clone');
const mockDeleteDraft = vi.fn().mockResolvedValue(undefined);
const mockCreateVersion = vi.fn().mockResolvedValue({ id: 'v-new' });
const mockCreateLineItem = vi.fn().mockResolvedValue({ id: 'li-new' });
const mockDeleteLineItem = vi.fn().mockResolvedValue(undefined);
const mockUpdateLineItem = vi.fn().mockResolvedValue(undefined);

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => budgetState,
  useBudgetVersions: () => versionsState,
  useBudgetActivationMode: () => activationModeState,
  useBudgetMutations: () => ({
    createVersion: { mutateAsync: mockCreateVersion, isPending: false },
    cloneVersion: { mutateAsync: mockClone, isPending: false },
    activate: { mutateAsync: mockActivate, isPending: false },
    archive: { mutateAsync: mockArchive, isPending: false },
    deleteDraft: { mutateAsync: mockDeleteDraft, isPending: false },
    createLineItem: { mutateAsync: mockCreateLineItem, isPending: false },
    updateLineItem: { mutateAsync: mockUpdateLineItem, isPending: false },
    deleteLineItem: { mutateAsync: mockDeleteLineItem, isPending: false },
  }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProjectProcurements: () => procurementsState }));
vi.mock('./project-detail/useProjectPosition', () => ({ useBudgetPosition: () => positionState }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [], isPending: false }) }));
vi.mock('@/src/hooks/useErpnextBinding', () => ({ useErpnextBinding: () => ({ data: { status: 'active' }, isPending: false }) }));
vi.mock('@/src/lib/repositories/budgetProjection', () => ({
  fetchBudgetPushStatus: () => Promise.resolve(budgetPushState.rows),
  retryActiveBudgetPush: vi.fn(),
  releaseActiveBudgetPushHold: vi.fn(),
}));
vi.mock('@/src/components/m365/BudgetDocumentLinks', () => ({
  BudgetDocumentLinks: ({ versionId }: { versionId: string }) => <div data-testid={`evidence-${versionId}`}>Evidence documents</div>,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
const roleState = { realRole: 'Project Manager' };
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole: roleState.realRole,
    realRole: roleState.realRole,
    canImpersonate: false,
    viewAs: vi.fn(),
  }),
}));

import ProjectBudget from './ProjectBudget';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { FinanceI18nTestProvider } from './__tests__/financeI18nTestProvider';
import { financeTestI18n } from './__tests__/financeI18nTestInstance';

const EN_LOCALE = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID_LOCALE = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

const project = { id: 'p-1', currency: 'USD', tax_treatment: 'exclusive' } as unknown as ProjectWithRefs;
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
  project_id: 'p-1',
  org_id: 'org-1',
  currency: 'USD',
  created_at: '2026-01-01T00:00:00Z',
  activation_basis: null,
  line_items: [
    { id: 'active-labor', budget_version_id: 'v-active', category: 'Labor', description: 'Project team', budgeted_amount: 2000000, actual_amount: 0, org_id: 'org-1' },
    { id: 'active-materials', budget_version_id: 'v-active', category: 'Materials', description: 'Materials', budgeted_amount: 1700000, actual_amount: 0, org_id: 'org-1' },
    { id: 'active-contingency', budget_version_id: 'v-active', category: 'Contingency', description: 'Contingency', budgeted_amount: 1000000, actual_amount: 0, org_id: 'org-1' },
  ],
  total: 4700000,
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
  activation_basis: null,
  line_items: [],
  total: 0,
};

function resetState() {
  budgetState.data = undefined;
  budgetState.isPending = false;
  budgetState.isError = false;
  versionsState.data = undefined;
  versionsState.isPending = false;
  versionsState.isError = false;
  activationModeState.data = undefined;
  activationModeState.isPending = false;
  activationModeState.isError = false;
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
  roleState.realRole = 'Project Manager';
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
      { versions: [activeVersion], trigger: /Arsipkan/i, confirm: /Arsipkan versi/i, body: 'Ini menonaktifkan Version 1 (v1) sebagai anggaran aktif', openVersions: true },
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
      if (scenario.fill) await userEvent.click(screen.getByRole('button', { name: scenario.confirm }));
      const dialog = screen.queryByRole('dialog') ?? screen.getByRole('alertdialog');
      expect(dialog).toHaveTextContent(scenario.body);
      view.unmount();
    }
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
    expect(within(table).getByRole('columnheader', { name: 'Spent' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Committed' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Left' })).toBeInTheDocument();
    expect(within(table).getAllByText(/2,000,000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/USD/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('tax-basis')).toBeInTheDocument();
    resetState();
  });

  it('shows the source remedy once while keeping unknown spending visibly unavailable', () => {
    budgetState.data = activeVersion.total;
    versionsState.data = [activeVersion];
    positionState.unknown = 3;
    renderPage();

    const table = screen.getByRole('table', { name: 'Budget vs actual by category' });
    expect(within(table).getByRole('row', { name: /Labor/ })).toHaveTextContent('—');
    expect(screen.getAllByText(/Spending isn't linked yet\./)).toHaveLength(1);
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
    // C5: no .00, and still the full amount — fraction included — never the short $1.2K form, in a table.
    expect(within(table).getAllByText(/1,234\.5/).length).toBeGreaterThan(0);
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
    expect(screen.getByText('Activated by sole operator')).toBeInTheDocument();
    soleView.unmount();

    versionsState.data = [{ ...activeVersion, activation_basis: 'standard' }];
    const standardView = renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(screen.queryByText('Activated by sole operator')).not.toBeInTheDocument();
    standardView.unmount();

    await financeTestI18n.changeLanguage('id');
    versionsState.data = [{ ...activeVersion, activation_basis: 'sole_operator' }];
    const idSoleView = renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(screen.getByText('Diaktifkan oleh operator tunggal')).toBeInTheDocument();
    idSoleView.unmount();

    versionsState.data = [{ ...activeVersion, activation_basis: null }];
    const legacyView = renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    expect(screen.queryByText('Diaktifkan oleh operator tunggal')).not.toBeInTheDocument();
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

  // ── HIGH-C (Luna re-audit round 2): the push is a CONSEQUENCE of activation, never its precondition
  //    (ADR-0059 §3.2) — so activation still SUCCEEDS when the push fails. But "swallowed" must mean
  //    "recorded and surfaced", never "lost": a dispatch that never reached the edge function writes no
  //    mirror row at all, the sweep backstop's queue IS that mirror, and the user was shown a plain
  //    success while ERPNext kept enforcing the previous budget.
  it('HIGH-C activation whose ERP push failed still succeeds, but SAYS SO instead of toasting a clean success', async () => {
    roleState.realRole = 'Finance';
    mockActivate.mockResolvedValueOnce({ pushState: 'failed' });
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Activate v2$/i }));
    await userEvent.click(screen.getByRole('button', { name: /Activate version/i }));
    const toast = await findToastAnnouncement('alert', /activated/i);
    expect(toast).toHaveTextContent(/ERPNext/i);
    resetState();
  });

  /**
   * ⚑ SHOULD-FIX (FU-2 round 2) — a version with no line items sends NOTHING to ERPNext (the fan-out
   * has no year to attempt), so the toast must not announce a push. Neither may it cry failure: no
   * attempt was made and there is nothing to retry.
   */
  it('activation of a version with NO lines says nothing was sent — never "ERPNext is enforcing" it', async () => {
    roleState.realRole = 'Finance';
    mockActivate.mockResolvedValueOnce({ pushState: 'nothing-to-push' });
    budgetState.data = 0;
    versionsState.data = [draftVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Activate v2$/i }));
    await userEvent.click(screen.getByRole('button', { name: /Activate version/i }));
    const toast = await findToastAnnouncement('alert', /activated/i);
    expect(toast).toHaveTextContent(/no budget lines/i);
    // …and it does NOT tell the operator to retry a push that was never attempted.
    expect(toast).not.toHaveTextContent(/retry/i);
    resetState();
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
    // Owner rule: nothing mutates on the first click; a destructive modal appears.
    expect(mockArchive).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Archive version/i }));
    expect(mockArchive).toHaveBeenCalledWith('v-active');
    resetState();
  });

  it('B4: can cancel archive confirmation', async () => {
    budgetState.data = 4700000;
    versionsState.data = [activeVersion];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^(Manage versions|Kelola versi)$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
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
    expect(mockCreateVersion).toHaveBeenCalledWith({ projectId: 'p-1', name: 'Budget v1' });
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
