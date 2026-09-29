/**
 * #701 — the Incoming Payments and Sales Invoices exports wrote amounts with `toString()`, so the
 * spreadsheet cell was TEXT ("Number stored as text", unsummable) unlike every other export.
 *
 * ⚑ The oracle is the CELL TYPE in the generated workbook, read back with exceljs — not the string
 * shape of the value. The whole real path runs: the page's own `exportValue`s → `buildExportRows` →
 * `toWorkbookBuffer` → parse the bytes. Nothing in the chain is mocked except the table render.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import ExcelJS from 'exceljs';
import { ToastProvider, type Column } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { buildExportRows, toWorkbookBuffer } from '@/src/lib/export';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

// ⚑ Neither page mounts an Export button today, so there is no click to drive. The shipped
// `columns` (with their real `exportValue`s) are captured off the DataTable the page renders, then
// pushed through the same buildExportRows → toWorkbookBuffer path `useExport` runs.
const table = vi.hoisted(() => ({ props: null as null | { rows: unknown[]; columns: unknown[] } }));
vi.mock('@/src/components/ui', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    DataTable: (props: { rows: unknown[]; columns: unknown[] }) => {
      table.props = props;
      return null;
    },
  };
});

const state = vi.hoisted(() => ({
  payments: [] as Array<Record<string, unknown>>,
  invoices: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useIncomingPayments: () => ({ data: state.payments, isPending: false, isError: false, refetch: vi.fn() }),
  useSalesInvoices: () => ({ data: state.invoices, isPending: false, isError: false, refetch: vi.fn() }),
  useRevenueMutations: () => ({
    createPayment: { mutateAsync: vi.fn(), isPending: false },
    cancelPayment: { mutateAsync: vi.fn(), isPending: false },
    create: { mutateAsync: vi.fn(), isPending: false },
    submitInvoice: { mutateAsync: vi.fn(), isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [] }),
  useProjectOptions: () => ({ data: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }),
}));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/lib/analytics', () => ({ trackFilterApplied: vi.fn() }));

import IncomingPayments from '../IncomingPayments';
import SalesInvoices from '../SalesInvoices';

const payment = {
  id: 'ip-1', org_id: 'org-1', customer_id: 'cust-1', sales_invoice_id: null, ip_number: 'ACC-PAY-0001',
  reference_number: null, date: '2026-07-01', amount: 1234567.89, currency: 'IDR', status: 'Paid',
  erp_docstatus: 1, erp_modified: null, erp_amended_from: null, erp_cancelled_at: null,
  created_at: '2026-07-01T00:00:00Z',
};
const invoice = {
  id: 'inv-1', org_id: 'org-1', project_id: null, customer_id: 'cust-1', si_number: 'ACC-SINV-1',
  reference_number: null, invoice_date: '2026-07-01', amount: 1234567.89, currency: 'IDR',
  tax_treatment: 'exclusive', erp_outstanding_amount: 500.5, status: 'Submitted', erp_docstatus: 1,
  erp_modified: null, erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-07-01T00:00:00Z',
  author_user_id: 'u-1', erp_payment_terms_days: 30, erp_due_date: null,
};

function renderPage(node: React.ReactElement) {
  render(
    <ImpersonationProvider realRole="Finance">
      <MemoryRouter>
        <ToastProvider>{node}</ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );
}

/** Round-trip the page's real columns through the real workbook writer. */
async function exportedSheet() {
  expect(table.props).not.toBeNull();
  const { rows, columns } = table.props!;
  const { header, body } = buildExportRows(rows, columns as Column<unknown>[]);
  const buf = await toWorkbookBuffer({ sheetName: 'Sheet', header, body });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const col = (name: string) => header.indexOf(name) + 1;
  return { ws, col };
}

const LOCALES = [
  { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' },
  { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' },
];

beforeEach(() => {
  table.props = null;
  state.payments = [payment];
  state.invoices = [invoice];
});
afterEach(() => resetActiveLocale());

describe.each(LOCALES)('#701 money exports carry numeric cells — viewer locale $locale', (loc) => {
  it('#701: Incoming Payments exports Amount as a NUMERIC cell holding the exact value', async () => {
    setActiveLocale(loc);
    renderPage(<IncomingPayments />);
    const { ws, col } = await exportedSheet();
    const cell = ws.getRow(2).getCell(col('Amount'));
    expect(cell.type).toBe(ExcelJS.ValueType.Number);
    expect(cell.value).toBe(1234567.89);
  });

  it('#701: Sales Invoices exports Amount and Outstanding as NUMERIC cells holding the exact values', async () => {
    setActiveLocale(loc);
    renderPage(<SalesInvoices />);
    const { ws, col } = await exportedSheet();
    const amount = ws.getRow(2).getCell(col('Amount'));
    const outstanding = ws.getRow(2).getCell(col('Outstanding'));
    expect(amount.type).toBe(ExcelJS.ValueType.Number);
    expect(amount.value).toBe(1234567.89);
    expect(outstanding.type).toBe(ExcelJS.ValueType.Number);
    expect(outstanding.value).toBe(500.5);
  });
});

describe('#701 a missing amount exports an empty cell, not a text zero', () => {
  it('#701: Incoming Payments with a null amount leaves the cell empty', async () => {
    state.payments = [{ ...payment, amount: null }];
    renderPage(<IncomingPayments />);
    const { ws, col } = await exportedSheet();
    const cell = ws.getRow(2).getCell(col('Amount'));
    expect(cell.type).not.toBe(ExcelJS.ValueType.Number);
    expect(cell.type === ExcelJS.ValueType.Null || cell.value === '' || cell.value === null).toBe(true);
  });
});
