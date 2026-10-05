/**
 * AC-EXT-002 (#769) — the Procurement export carries an "External references" column joining every
 * record's external reference (PR, PO, vendor invoice, in that order). Oracle: the workbook the real
 * Export button downloads, parsed back with exceljs (same harness as exportCurrencyColumn.test.tsx).
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
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));

const base = (id: string, title: string) => ({
  id, title, code: id, status: 'Draft', total_value: 1000, currency: 'USD', created_at: '2026-01-01T00:00:00Z',
  project: { name: 'Project A' }, requested_by: { full_name: 'Alice', id: 'u1' }, requested_by_id: 'u1',
});
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useProcurementView', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/hooks/useProcurementView')>()),
  useProcurementView: () => ['table', vi.fn()],
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({
    data: [
      {
        ...base('p-all', 'Has all three'),
        pr_refs: [{ external_ref: 'PRQ-001' }],
        po_refs: [{ external_ref: 'PRO-002' }],
        vi_refs: [{ external_ref: 'PRO-002' }, { external_ref: null }],
      },
      { ...base('p-none', 'Has none'), pr_refs: [], po_refs: [{ external_ref: null }], vi_refs: [] },
    ],
    isPending: false, isError: false, refetch: vi.fn(),
  }),
}));

let ProcurementPage: React.ComponentType;
beforeAll(async () => {
  ({ default: ProcurementPage } = await import('../Procurement'));
}, 60_000);

beforeEach(() => {
  hoisted.captured = [];
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('AC-EXT-002 Procurement export carries the record external references', () => {
  it('AC-EXT-002: the "External references" column joins PR, PO and VI references; a case with none is blank', async () => {
    render(
      <ImpersonationProvider realRole="Admin">
        <MemoryRouter>
          <ToastProvider>
            <ProcurementPage />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => expect(hoisted.captured).toHaveLength(1));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(hoisted.captured[0]);
    const ws = wb.worksheets[0];
    const headers = (ws.getRow(1).values as unknown[]).slice(1) as string[];
    const refCol = headers.indexOf('External references') + 1;
    const reqCol = headers.indexOf('Request') + 1;
    expect(refCol).toBeGreaterThan(0);
    const cell = (title: string) =>
      [2, 3].map((r) => ws.getRow(r)).find((x) => x.getCell(reqCol).value === title)!.getCell(refCol).value;
    expect(cell('Has all three')).toBe('PRQ-001, PRO-002, PRO-002');
    expect(cell('Has none') ?? '').toBe('');
  });
});
