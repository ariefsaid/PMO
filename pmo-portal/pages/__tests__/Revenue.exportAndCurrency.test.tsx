/**
 * #731 — Incoming Payments and Sales Invoices (a) mount the shared ExportButton like every other
 * main list, so their numeric export columns (#701) are reachable, and (b) show the org's currency
 * beside their money inputs instead of a welded `$` (#694 did this for project money inputs).
 *
 * ⚑ The export oracle is the CELL TYPE in the workbook the button actually downloads: the real
 * click → useExport → buildExportRows → toWorkbookBuffer path runs; `toWorkbookBuffer` is only
 * wrapped to capture its bytes, then parsed back with exceljs.
 * ⚑ The currency oracle uses an IDR org under the id-ID number locale (where the glyph is `Rp`) and
 * asserts `$` is ABSENT, so a still-hardcoded prefix reddens it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ExcelJS from 'exceljs';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const hoisted = vi.hoisted(() => ({
  payments: [] as Array<Record<string, unknown>>,
  invoices: [] as Array<Record<string, unknown>>,
  orgCurrency: 'USD',
  captured: [] as ArrayBuffer[],
}));

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => hoisted.orgCurrency }));
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
vi.mock('@/src/hooks/useRevenue', () => ({
  useIncomingPayments: () => ({ data: hoisted.payments, isPending: false, isError: false, refetch: vi.fn() }),
  useSalesInvoices: () => ({ data: hoisted.invoices, isPending: false, isError: false, refetch: vi.fn() }),
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
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }),
}));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));

import IncomingPayments from '../IncomingPayments';
import SalesInvoices from '../SalesInvoices';

const payment = {
  id: 'ip-1', org_id: 'org-1', customer_id: 'cust-1', customer_name: 'Acme Co', sales_invoice_id: null, ip_number: 'ACC-PAY-0001',
  reference_number: null, date: '2026-07-01', amount: 1234567.89, currency: 'IDR', status: 'Paid',
  erp_docstatus: 1, erp_modified: null, erp_amended_from: null, erp_cancelled_at: null,
  created_at: '2026-07-01T00:00:00Z',
};
const invoice = {
  id: 'inv-1', org_id: 'org-1', project_id: null, customer_id: 'cust-1', customer_name: 'Acme Co', si_number: 'ACC-SINV-1',
  reference_number: null, invoice_date: '2026-07-01', amount: 1234567.89, currency: 'IDR',
  tax_treatment: 'exclusive', erp_outstanding_amount: 500.5, status: 'Submitted', erp_docstatus: 1,
  erp_modified: null, erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-07-01T00:00:00Z',
  author_user_id: 'u-1', erp_payment_terms_days: 30, erp_due_date: null,
};

const ID_LOCALE = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

function renderPage(node: React.ReactElement) {
  render(
    // The page's PDF hook reads the query cache (AC-PDF-011 list invalidation) — give it the
    // standard provider even though `useRevenue` itself is mocked here.
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ImpersonationProvider realRole="Finance">
        <MemoryRouter>
          <ToastProvider>{node}</ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  hoisted.payments = [payment];
  hoisted.invoices = [invoice];
  hoisted.orgCurrency = 'IDR';
  hoisted.captured = [];
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  resetActiveLocale();
  vi.restoreAllMocks();
});

async function exportedSheet() {
  await waitFor(() => expect(hoisted.captured).toHaveLength(1));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(hoisted.captured[0]);
  const ws = wb.worksheets[0];
  const headers = (ws.getRow(1).values as unknown[]).slice(1) as string[];
  return { ws, col: (name: string) => headers.indexOf(name) + 1 };
}

describe('#731 the money lists are exportable', () => {
  it('#731: Incoming Payments has an enabled Export button that downloads a numeric Amount cell', async () => {
    renderPage(<IncomingPayments />);
    const btn = screen.getByRole('button', { name: /export/i });
    expect(btn).toBeEnabled();
    await userEvent.setup().click(btn);
    const { ws, col } = await exportedSheet();
    const cell = ws.getRow(2).getCell(col('Amount'));
    expect(cell.type).toBe(ExcelJS.ValueType.Number);
    expect(cell.value).toBe(1234567.89);
  });

  it('#731: Sales Invoices has an enabled Export button that downloads numeric Amount and Outstanding cells', async () => {
    renderPage(<SalesInvoices />);
    const btn = screen.getByRole('button', { name: /export/i });
    expect(btn).toBeEnabled();
    await userEvent.setup().click(btn);
    const { ws, col } = await exportedSheet();
    const amount = ws.getRow(2).getCell(col('Amount'));
    const outstanding = ws.getRow(2).getCell(col('Outstanding'));
    expect(amount.type).toBe(ExcelJS.ValueType.Number);
    expect(amount.value).toBe(1234567.89);
    expect(outstanding.type).toBe(ExcelJS.ValueType.Number);
    expect(outstanding.value).toBe(500.5);
  });

  it('#731: Export is disabled when the search filters every row out (shared-button contract)', async () => {
    renderPage(<SalesInvoices />);
    await userEvent.setup().type(screen.getByRole('searchbox', { name: /search sales invoices/i }), 'zzz-no-match');
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });
});

describe('AC-L10N-052 an export carries each row\'s own ISO currency next to its amount', () => {
  it('AC-L10N-052: Incoming Payments exports a per-row Currency column right after Amount (USD + IDR)', async () => {
    hoisted.payments = [
      { ...payment, id: 'ip-usd', ip_number: 'PAY-USD', amount: 100.5, currency: 'USD' },
      { ...payment, id: 'ip-idr', ip_number: 'PAY-IDR', amount: 2000000, currency: 'IDR' },
    ];
    renderPage(<IncomingPayments />);
    await userEvent.setup().click(screen.getByRole('button', { name: /export/i }));
    const { ws, col } = await exportedSheet();
    expect(col('Currency')).toBe(col('Amount') + 1);
    const byNumber = (n: string) =>
      [2, 3].map((r) => ws.getRow(r)).find((row) => row.getCell(col('Payment #')).value === n)!;
    expect(byNumber('PAY-USD').getCell(col('Currency')).value).toBe('USD');
    expect(byNumber('PAY-USD').getCell(col('Amount')).value).toBe(100.5);
    expect(byNumber('PAY-IDR').getCell(col('Currency')).value).toBe('IDR');
    expect(byNumber('PAY-IDR').getCell(col('Amount')).value).toBe(2000000);
  });

  it('AC-L10N-052: Sales Invoices exports a per-row Currency column right after Amount (USD + IDR)', async () => {
    hoisted.invoices = [
      { ...invoice, id: 'inv-usd', si_number: 'SI-USD', amount: 100.5, currency: 'USD' },
      { ...invoice, id: 'inv-idr', si_number: 'SI-IDR', amount: 2000000, currency: 'IDR' },
    ];
    renderPage(<SalesInvoices />);
    await userEvent.setup().click(screen.getByRole('button', { name: /export/i }));
    const { ws, col } = await exportedSheet();
    expect(col('Currency')).toBe(col('Amount') + 1);
    const byNumber = (n: string) =>
      [2, 3].map((r) => ws.getRow(r)).find((row) => row.getCell(col('Invoice #')).value === n)!;
    expect(byNumber('SI-USD').getCell(col('Currency')).value).toBe('USD');
    expect(byNumber('SI-IDR').getCell(col('Currency')).value).toBe('IDR');
    expect(byNumber('SI-IDR').getCell(col('Amount')).value).toBe(2000000);
  });

  it('AC-EFK-004: the merged on-screen e-Faktur cell still exports as two columns (number, date)', async () => {
    hoisted.invoices = [{ ...invoice, efaktur_number: '010.001-26.12345678', efaktur_date: '2026-09-28' }];
    renderPage(<SalesInvoices />);
    await userEvent.setup().click(screen.getByRole('button', { name: /export/i }));
    const { ws, col } = await exportedSheet();
    expect(col('e-Faktur')).toBe(0); // the on-screen merged header never reaches the sheet
    expect(ws.getRow(2).getCell(col('e-Faktur number')).value).toBe('010.001-26.12345678');
    // the export seam writes an ISO date string as a real date cell
    expect((ws.getRow(2).getCell(col('e-Faktur date')).value as Date).toISOString().slice(0, 10)).toBe('2026-09-28');
  });

  it('AC-L10N-052: the on-screen table gets no extra Currency column (export-only)', () => {
    renderPage(<SalesInvoices />);
    expect(screen.queryByRole('columnheader', { name: 'Currency' })).not.toBeInTheDocument();
  });
});

describe('#731 money inputs use the org currency, not a welded $', () => {
  beforeEach(() => setActiveLocale(ID_LOCALE));

  const adornment = (input: HTMLElement) => input.parentElement?.textContent ?? '';

  it('#731: an IDR org sees Rp beside both Incoming Payment amount inputs', async () => {
    renderPage(<IncomingPayments />);
    await userEvent.setup().click(screen.getAllByRole('button', { name: /Receive Payment/i })[0]);
    for (const label of [/Paid Amount/, /Received Amount/]) {
      const text = adornment(screen.getByLabelText(label));
      expect(text).toContain('Rp');
      expect(text).not.toContain('$');
    }
  });

  it('#731: an IDR org sees Rp beside the Sales Invoice line-item rate', async () => {
    renderPage(<SalesInvoices />);
    await userEvent.setup().click(screen.getAllByRole('button', { name: /New Invoice/i })[0]);
    const text = adornment(screen.getByLabelText(/Rate/));
    expect(text).toContain('Rp');
    expect(text).not.toContain('$');
  });
});
