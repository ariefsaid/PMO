/**
 * AC-L10N-052 (FR-L10N-052) — the Projects and Procurement exports carry each row's own ISO
 * currency in an adjacent `Currency` column, so a mixed-currency list is not an unlabeled column of
 * bare numbers. Oracle: the workbook the real Export button downloads, parsed back with exceljs
 * (`toWorkbookBuffer` is only wrapped to capture its bytes). The number cell itself stays numeric.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import ExcelJS from 'exceljs';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const hoisted = vi.hoisted(() => ({ captured: [] as ArrayBuffer[] }));

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
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
vi.mock('react-router', async (orig) => {
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
vi.mock('@/src/auth/impersonation', () => ({
  ImpersonationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useEffectiveRole: () => ({ effectiveRole: 'Admin', realRole: 'Admin', canImpersonate: false, viewAs: vi.fn() }),
}));

// ── Procurement ─────────────────────────────────────────────────────────────
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));
const proc = (id: string, title: string, total_value: number, currency: string) => ({
  id, title, code: id, status: 'Draft', total_value, currency, created_at: '2026-01-01T00:00:00Z',
  project: { name: 'Project A' }, requested_by: { full_name: 'Alice', id: 'u1' }, requested_by_id: 'u1',
});
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({
    data: [proc('p-usd', 'Widgets USD', 5000, 'USD'), proc('p-idr', 'Widgets IDR', 75000000, 'IDR')],
    isPending: false, isError: false, refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useProcurementView', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/hooks/useProcurementView')>()),
  useProcurementView: () => ['table', vi.fn()],
}));

// ── Projects ────────────────────────────────────────────────────────────────
const proj = (id: string, name: string, contract_value: number, currency: string) => ({
  id, name, code: id, status: 'Ongoing Project', client_id: 'c1', project_manager_id: 'u1',
  contract_value, currency, budget: 900_000, spent: 0, end_date: null, client: { name: 'Acme' },
  pm: { full_name: 'Alice PM' }, customer_contract_ref: null, contract_date: null, decided_at: null,
  tax_treatment: 'exclusive',
});
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [], isError: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({
    data: [proj('pr-usd', 'Alpha USD', 1_000_000, 'USD'), proj('pr-idr', 'Beta IDR', 15_000_000_000, 'IDR')],
    isPending: false, isError: false, refetch: vi.fn(),
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
vi.mock('@/src/hooks/useProjectView', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/hooks/useProjectView')>()),
  useProjectView: () => ['table', vi.fn()],
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => ({ data: {} }),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
  usePipelineStageConfig: () => ({ data: [], isSuccess: true }),
}));

let ProcurementPage: React.ComponentType;
let ProjectsPage: React.ComponentType;
beforeAll(async () => {
  ({ default: ProcurementPage } = await import('../Procurement'));
  ({ default: ProjectsPage } = await import('../Projects'));
}, 60_000);

beforeEach(() => {
  hoisted.captured = [];
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function exportFrom(node: React.ReactElement) {
  render(
    <ImpersonationProvider realRole="Admin">
      <MemoryRouter>
        <ToastProvider>{node}</ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );
  await userEvent.setup().click(screen.getByRole('button', { name: /export/i }));
  await waitFor(() => expect(hoisted.captured).toHaveLength(1));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(hoisted.captured[0]);
  const ws = wb.worksheets[0];
  const headers = (ws.getRow(1).values as unknown[]).slice(1) as string[];
  return { ws, col: (name: string) => headers.indexOf(name) + 1 };
}

describe('AC-L10N-052 Projects and Procurement exports carry the row currency', () => {
  it('AC-L10N-052: Procurement exports a per-row Currency column right after Value (USD + IDR)', async () => {
    const { ws, col } = await exportFrom(<ProcurementPage />);
    expect(col('Currency')).toBe(col('Value') + 1);
    const row = (title: string) =>
      [2, 3].map((r) => ws.getRow(r)).find((x) => x.getCell(col('Request')).value === title)!;
    expect(row('Widgets USD').getCell(col('Currency')).value).toBe('USD');
    expect(row('Widgets USD').getCell(col('Value')).value).toBe(5000);
    expect(row('Widgets IDR').getCell(col('Currency')).value).toBe('IDR');
    expect(row('Widgets IDR').getCell(col('Value')).value).toBe(75000000);
  });

  it('AC-L10N-052: Projects exports a per-row Currency column right after Contract (USD + IDR)', async () => {
    const { ws, col } = await exportFrom(<ProjectsPage />);
    expect(col('Currency')).toBe(col('Contract') + 1);
    const row = (name: string) =>
      [2, 3].map((r) => ws.getRow(r)).find((x) => x.getCell(col('Project')).value === name)!;
    expect(row('Alpha USD').getCell(col('Currency')).value).toBe('USD');
    expect(row('Beta IDR').getCell(col('Currency')).value).toBe('IDR');
    expect(row('Beta IDR').getCell(col('Contract')).value).toBe(15_000_000_000);
  });
});
