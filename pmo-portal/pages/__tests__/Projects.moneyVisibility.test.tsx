/**
 * Projects money visibility — the /projects list shows the contract figure (column + export)
 * only to roles with the shared money-view permission (same as project detail); Engineers don't see it.
 *
 * Oracle: the REAL rendered page (desktop table + the DataTable phone card reflow, which renders
 * the same columns) and the REAL export workbook (the Export button's bytes, parsed back with
 * exceljs — the exportCurrencyColumn.test.tsx pattern). No duplicated helper: gating lives in the
 * shipped page, and these tests would go red if the column leaked back into either surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// OD-TAX-1 (#548): the money forms pre-select the org's `default_tax_treatment` via a live read;
// stub the read only (same rationale as Projects.test.tsx).
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => 'exclusive' };
});
vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({ useProjectClassificationOptions: () => ({ data: { serviceLines: [], sectors: [] }, isPending: false, isError: false }) }));

import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import ExcelJS from 'exceljs';
import { ToastProvider } from '@/src/components/ui';
import Projects from '../Projects';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { formatCurrency } from '@/src/lib/format';
import { resetActiveLocale } from '@/src/lib/locale/activeLocale';

const seed = [
  { id: 'p1', name: 'Alpha Reach HQ Fit-Out', code: 'PRJ-001', status: 'Ongoing Project',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 5_000_000, currency: 'USD', budget: 4_700_000,
    spent: 0, end_date: '2026-12-18', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null },
  { id: 'p2', name: 'Beta IDR Rollout', code: 'PRJ-002', status: 'Ongoing Project',
    client_id: 'c3', project_manager_id: 'u-alice', contract_value: 15_000_000_000, currency: 'IDR', budget: 0,
    spent: 0, end_date: '2026-12-31', client: { name: 'Northwind Manufacturing' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null },
] as unknown as ProjectWithRefs[];

const projectsState = { data: seed, isPending: false, isError: false, refetch: vi.fn() };
// Mutable role box (hoisted) — drives the REAL policy (ADR-0016) through the mocked auth seams.
const { roleBox, projectMutations, projectMoneyState, deliveryState, tasksState } = vi.hoisted(() => ({
  roleBox: { value: 'Project Manager' },
  tasksState: { data: [{ project_id: 'p1' }, { project_id: 'p2' }], isPending: false, isError: false },
  deliveryState: { data: {} as Record<string, { deliveryPct: number | null }>, isPending: false, isError: false },
  projectMutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  },
  projectMoneyState: {
    data: {} as Record<string, unknown> | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
// #758: the end-customer filter + form list ALL the org's companies via useCompanies().
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [], isError: false }) }));
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
// An Engineer lands on "My Projects" (B-11); the fixture tasks make both seeded projects the
// Engineer's assigned work, so the gated rows are the ones they actually see.
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => tasksState }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => deliveryState,
}));
vi.mock('@/src/hooks/useProjectsMoneyCollection', () => ({ useProjectsMoneyCollection: () => projectMoneyState }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: roleBox.value, realRole: roleBox.value, canImpersonate: false, viewAs: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
}));
// Export oracle: wrap the real workbook writer to capture its bytes (exportCurrencyColumn pattern).
const hoisted = vi.hoisted(() => ({ captured: [] as ArrayBuffer[] }));
vi.mock('@/src/lib/export', async (orig) => {
  const actual = (await orig()) as typeof import('@/src/lib/export');
  return {
    ...actual,
    toWorkbookBuffer: async (...args: Parameters<typeof actual.toWorkbookBuffer>) => {
      const buf = await actual.toWorkbookBuffer(...args);
      hoisted.captured.push(buf as ArrayBuffer);
      return buf;
    },
  };
});

/**
 * The display string, pre-normalized for `getByText`: testing-library normalizes the DOM side
 * (U+00A0 → space) but compares the expected literal raw, and several currencies (IDR) format
 * with a no-break space before the amount.
 */
const moneyText = (value: number, currency: string) => formatCurrency(value, currency).replace(/\s/g, ' ');

const renderPage = (role: string) => {
  roleBox.value = role;
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <ToastProvider>
        <Projects />
      </ToastProvider>
    </MemoryRouter>,
  );
};

/** Clicks the real Export affordance and returns the parsed workbook's first sheet. */
async function exportWorkbook() {
  const user = userEvent.setup();
  const exportButton = screen.queryByRole('button', { name: /export/i });
  if (!exportButton) {
    const more = screen.queryByRole('button', { name: /^More$/i })
      ?? screen.getByRole('button', { name: /^More actions$/i });
    await user.click(more);
  }
  await user.click(screen.getByRole('button', { name: /export/i }));
  await waitFor(() => expect(hoisted.captured).toHaveLength(1));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(hoisted.captured[0]);
  return wb.worksheets[0];
}

const headersOf = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as unknown[]).slice(1) as string[];
const col = (ws: ExcelJS.Worksheet, name: string) => headersOf(ws).indexOf(name) + 1;

/** Every cell value anywhere in the sheet (headers + body). */
function* sheetCells(ws: ExcelJS.Worksheet): Generator<unknown> {
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= row.cellCount; c++) yield row.getCell(c).value;
  }
}

// Roles the shared money-view permission admits (policy MASTER_DATA).
const MONEY_VIEW_ROLES = ['Project Manager', 'Finance', 'Executive', 'Admin'] as const;

beforeEach(() => {
  sessionStorage.clear();
  projectsState.data = seed;
  projectsState.isPending = false;
  projectsState.isError = false;
  hoisted.captured = [];
  projectMoneyState.data = {}; projectMoneyState.isPending = false; projectMoneyState.isError = false;
  deliveryState.data = {}; deliveryState.isPending = false; deliveryState.isError = false;
  tasksState.data = [{ project_id: 'p1' }, { project_id: 'p2' }]; tasksState.isPending = false; tasksState.isError = false;
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetActiveLocale();
});

describe('Projects persona money visibility — contract figure gated on the shared money-view permission', () => {
  it.each(MONEY_VIEW_ROLES)('%s keeps the Contract column and both rendered values', (role) => {
    renderPage(role);
    expect(screen.getByRole('columnheader', { name: 'Contract' })).toBeInTheDocument();
    // The shipped formatter's own rendering of each seeded contract figure — present on the list.
    expect(screen.getByText(moneyText(5_000_000, 'USD'))).toBeInTheDocument();
    expect(screen.getByText(moneyText(15_000_000_000, 'IDR'))).toBeInTheDocument();
  });

  it('Engineer sees no Contract column and no contract value in the rendered list', () => {
    renderPage('Engineer');
    expect(screen.queryByRole('columnheader', { name: 'Contract' })).not.toBeInTheDocument();
    expect(screen.queryByText(moneyText(5_000_000, 'USD'))).not.toBeInTheDocument();
    expect(screen.queryByText(moneyText(15_000_000_000, 'IDR'))).not.toBeInTheDocument();
    // The rows themselves stay — only the money fact is gone.
    expect(screen.getByRole('cell', { name: /Alpha Reach HQ Fit-Out/ })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: /Beta IDR Rollout/ })).toBeInTheDocument();
  });

  it('Engineer sees no Contract figure in the phone card reflow (same columns, <768px)', async () => {
    const desktopMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      renderPage('Engineer');
      // The mobile branch is the ONLY branch (DataTable single-render, OD-W4-4).
      expect(screen.queryByRole('columnheader', { name: 'Contract' })).not.toBeInTheDocument();
      expect(screen.queryByText('Contract')).not.toBeInTheDocument();
      expect(screen.queryByText(moneyText(5_000_000, 'USD'))).not.toBeInTheDocument();
      expect(screen.queryByText(moneyText(15_000_000_000, 'IDR'))).not.toBeInTheDocument();
    } finally {
      window.matchMedia = desktopMatchMedia;
    }
  });

  it.each(MONEY_VIEW_ROLES)('%s export keeps Contract, the per-row Currency column, and both values', async (role) => {
    renderPage(role);
    const ws = await exportWorkbook();
    expect(col(ws, 'Currency')).toBe(col(ws, 'Contract') + 1);
    const row = (name: string) =>
      [2, 3].map((r) => ws.getRow(r)).find((x) => x.getCell(col(ws, 'Project')).value === name)!;
    expect(row('Alpha Reach HQ Fit-Out').getCell(col(ws, 'Contract')).value).toBe(5_000_000);
    expect(row('Alpha Reach HQ Fit-Out').getCell(col(ws, 'Currency')).value).toBe('USD');
    expect(row('Beta IDR Rollout').getCell(col(ws, 'Contract')).value).toBe(15_000_000_000);
    expect(row('Beta IDR Rollout').getCell(col(ws, 'Currency')).value).toBe('IDR');
  });

  it('exports canonical actual and unclamped delivery and budget percentages in the workbook', async () => {
    deliveryState.data = { p1: { deliveryPct: 77.6 } };
    projectMoneyState.data = { p1: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '104.25', asOf: null, excludesRestrictedRows: false, complete: true, categories: [{ category: 'Labor', mapped: true, amount: '104.25' }] }, activeBudgetAmount: '100.00', activeBudgetCurrency: 'USD', hasActiveBudget: true } };
    renderPage('Project Manager');
    const ws = await exportWorkbook();
    expect(ws.getRow(2).getCell(col(ws, 'Actual')).value).toBe('$104.25 USD');
    expect(ws.getRow(2).getCell(col(ws, 'Progress')).value).toBe(78);
    expect(ws.getRow(2).getCell(col(ws, 'Budget used')).value).toBe(104);
    expect(ws.getRow(3).getCell(col(ws, 'Actual')).value).toBe('');
    expect(ws.getRow(3).getCell(col(ws, 'Progress')).value).toBe('');
    expect(ws.getRow(3).getCell(col(ws, 'Budget used')).value).toBe('');
  });

  it('keeps exact large Actual amounts as currency-qualified workbook text', async () => {
    projectMoneyState.data = { p1: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '9007199254740993.99', asOf: null, excludesRestrictedRows: false, complete: true, categories: [{ category: 'Labor', mapped: true, amount: '9007199254740993.99' }] }, activeBudgetAmount: null, activeBudgetCurrency: null, hasActiveBudget: false } };
    renderPage('Project Manager');
    const ws = await exportWorkbook();
    expect(ws.getRow(2).getCell(col(ws, 'Actual')).value).toBe('$9,007,199,254,740,993.99 USD');
  });

  it('exports zero and meaningful unavailable reasons without inventing values', async () => {
    deliveryState.data = { p1: { deliveryPct: 0 }, p2: { deliveryPct: null } };
    projectMoneyState.data = {
      p1: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '0.00', asOf: null, excludesRestrictedRows: false, complete: true, categories: [{ category: 'Labor', mapped: true, amount: '0.00' }] }, activeBudgetAmount: '100.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
      p2: { ledgerBasis: 'erp', actuals: { currency: 'IDR', total: '50.00', asOf: null, excludesRestrictedRows: true, complete: false, categories: [{ category: 'Labor', mapped: true, amount: '50.00' }] }, activeBudgetAmount: '100.00', activeBudgetCurrency: 'IDR', hasActiveBudget: true },
    };
    renderPage('Project Manager');
    const ws = await exportWorkbook();
    expect(ws.getRow(2).getCell(col(ws, 'Actual')).value).toBe('$0.00 USD');
    expect(ws.getRow(2).getCell(col(ws, 'Progress')).value).toBe(0);
    expect(ws.getRow(2).getCell(col(ws, 'Budget used')).value).toBe(0);
    expect(ws.getRow(3).getCell(col(ws, 'Actual')).value).toBe('Restricted excluded');
    expect(ws.getRow(3).getCell(col(ws, 'Budget used')).value).toBe('');
  });

  it('exports budget availability reasons as readable text', async () => {
    projectMoneyState.data = {
      p1: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '50.00', asOf: null, excludesRestrictedRows: false, complete: true, categories: [{ category: 'Labor', mapped: true, amount: '50.00' }] }, activeBudgetAmount: null, activeBudgetCurrency: null, hasActiveBudget: false },
      p2: { ledgerBasis: 'erp', actuals: { currency: 'IDR', total: '50.00', asOf: null, excludesRestrictedRows: false, complete: true, categories: [{ category: 'Labor', mapped: true, amount: '50.00' }] }, activeBudgetAmount: '100.00', activeBudgetCurrency: 'USD', hasActiveBudget: true },
    };
    renderPage('Project Manager');
    const ws = await exportWorkbook();
    expect(ws.getRow(2).getCell(col(ws, 'Budget used')).value).toBe('No active budget');
    expect(ws.getRow(3).getCell(col(ws, 'Budget used')).value).toBe('Budget currency differs from Actual');
  });

  it('exports blank unavailable values even when failed reads retain cached data', async () => {
    deliveryState.data = { p1: { deliveryPct: 78 } }; deliveryState.isError = true;
    projectMoneyState.data = { p1: { ledgerBasis: 'erp', actuals: { currency: 'USD', total: '104.00', asOf: null, excludesRestrictedRows: false, complete: true, categories: [{ category: 'Labor', mapped: true, amount: '104.00' }] }, activeBudgetAmount: '100.00', activeBudgetCurrency: 'USD', hasActiveBudget: true } };
    projectMoneyState.isError = true;
    renderPage('Project Manager');
    const ws = await exportWorkbook();
    for (const header of ['Actual', 'Progress', 'Budget used']) expect(ws.getRow(2).getCell(col(ws, header)).value).toBe('');
  });

  it('exports only columns shown on the table, plus the contract currency', async () => {
    renderPage('Project Manager');
    expect(screen.queryByRole('columnheader', { name: 'Progress' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Budget used' })).not.toBeInTheDocument();
    const ws = await exportWorkbook();
    expect(headersOf(ws)).not.toContain('Progress');
    expect(headersOf(ws)).not.toContain('Budget used');
  });

  it.each([[false, 'error'], [true, 'error'], [false, 'pending'], [true, 'pending']] as const)('blocks stale assignment export and exports fresh rows on mobile=%s during %s', async (mobile, state) => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({ matches: !mobile, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })));
    tasksState.data = [{ project_id: 'p1' }];
    tasksState.isError = state === 'error';
    tasksState.isPending = state === 'pending';
    const { rerender } = renderPage('Engineer');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /more/i }));
    const button = screen.getByRole('button', { name: /export/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(hoisted.captured).toHaveLength(0);
    await user.click(screen.getByRole('tab', { name: /^all$/i }));
    if (!screen.queryByRole('button', { name: /export/i })) await user.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.getByRole('button', { name: /export/i })).toBeEnabled();
    const all = await exportWorkbook();
    expect([2, 3].map((r) => all.getRow(r).getCell(col(all, 'Project')).value)).toEqual(['Alpha Reach HQ Fit-Out', 'Beta IDR Rollout']);
    hoisted.captured = [];
    await user.click(screen.getByRole('tab', { name: /my projects/i }));
    tasksState.isError = false;
    tasksState.isPending = false;
    tasksState.data = [{ project_id: 'p2' }];
    rerender(<MemoryRouter initialEntries={['/projects']}><ToastProvider><Projects /></ToastProvider></MemoryRouter>);
    const fresh = await exportWorkbook();
    expect(fresh.getRow(2).getCell(col(fresh, 'Project')).value).toBe('Beta IDR Rollout');
    expect(fresh.rowCount).toBe(2);
  });

  it('Engineer export carries no Contract column, no Currency column, and no contract amount anywhere', async () => {
    renderPage('Engineer');
    const ws = await exportWorkbook();
    // `col()` is 1-based (indexOf + 1), so an absent header is 0.
    expect(col(ws, 'Contract')).toBe(0);
    expect(col(ws, 'Currency')).toBe(0);
    const amounts = [5_000_000, 15_000_000_000];
    for (const cell of sheetCells(ws)) {
      expect(amounts).not.toContain(cell);
    }
    // The export itself still happens — the rows, minus the money column.
    const bodyNames = [2, 3].map((r) => ws.getRow(r).getCell(col(ws, 'Project')).value);
    expect(bodyNames).toEqual(['Alpha Reach HQ Fit-Out', 'Beta IDR Rollout']);
  });
});
