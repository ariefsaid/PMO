/**
 * #781 (AC-FIN-001 / AC-FIN-003) — the Finance lists.
 *
 * AC-FIN-001: the Sales Invoices and Incoming Payments customer CELL resolves the company NAME
 * (never the opaque `customer_id`), the list SEARCH indexes that name, and the Customer export
 * column writes the name — not the internal id.
 *
 * AC-FIN-003: displayed Finance dates route through the shared locale formatter, so an invoice
 * dated 2025-11-30 renders "30 Nov 2025" under en-GB, never the US-style "11/30/2025".
 *
 * ⚑ The export oracle is the CELL TYPE/VALUE in the workbook the button actually downloads: the
 * real click → useExport → buildExportRows → toWorkbookBuffer path runs; `toWorkbookBuffer` is
 * only wrapped to capture its bytes, then parsed back with exceljs (same pattern as
 * Revenue.exportAndCurrency.test.tsx).
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
import { formatDateOnly } from '@/src/lib/format';

const hoisted = vi.hoisted(() => ({
  payments: [] as Array<Record<string, unknown>>,
  invoices: [] as Array<Record<string, unknown>>,
  captured: [] as ArrayBuffer[],
}));

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
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [] }),
  useInvoiceProjectOptions: () => ({ data: [] }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }),
}));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/lib/analytics', () => ({ trackFilterApplied: vi.fn() }));

import IncomingPayments from '../IncomingPayments';
import SalesInvoices from '../SalesInvoices';

// Opaque UUID-like customer ids — the OLD behaviour leaked these into the customer cell.
const CUST_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const CUST_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const payment = {
  id: 'ip-1', org_id: 'org-1', customer_id: CUST_A, customer_name: 'Acme Energy',
  sales_invoice_id: null, ip_number: 'ACC-PAY-0001', reference_number: null, date: '2025-11-30',
  amount: 1234567.89, currency: 'IDR', status: 'Paid', erp_docstatus: 1, erp_modified: null,
  erp_amended_from: null, erp_cancelled_at: null, created_at: '2025-11-30T00:00:00Z',
};
const invoice = {
  id: 'inv-1', org_id: 'org-1', project_id: null, customer_id: CUST_A, customer_name: 'Acme Energy',
  si_number: 'ACC-SINV-00001', reference_number: 'PO-12345', invoice_date: '2025-11-30',
  amount: 1234567.89, currency: 'IDR', tax_treatment: 'exclusive', erp_outstanding_amount: 500.5,
  status: 'Submitted', erp_docstatus: 1, erp_modified: null, erp_amended_from: null,
  erp_cancelled_at: null, created_at: '2025-11-30T00:00:00Z', author_user_id: 'u-1',
  erp_payment_terms_days: 30, erp_due_date: null,
};

function renderPage(node: React.ReactElement) {
  return render(
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
  hoisted.payments = [];
  hoisted.invoices = [];
  hoisted.captured = [];
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  resetActiveLocale();
  vi.restoreAllMocks();
});

/** The value of the 'Customer' export cell for the row whose first column equals `n`. */
async function customerExportFor(firstCol: string, firstHeader: string) {
  await waitFor(() => expect(hoisted.captured).toHaveLength(1));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(hoisted.captured[0]);
  const ws = wb.worksheets[0];
  const headers = (ws.getRow(1).values as unknown[]).slice(1) as string[];
  const custCol = headers.indexOf('Customer') + 1;
  const idCol = headers.indexOf(firstHeader) + 1;
  expect(idCol).toBeGreaterThan(0);
  let rowNum = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    if (ws.getRow(r).getCell(idCol).value === firstCol) { rowNum = r; break; }
  }
  expect(rowNum).toBeGreaterThan(0);
  return ws.getRow(rowNum).getCell(custCol).value;
}

describe('AC-FIN-001 — the Finance customer cell/export/search use the company name, never the id', () => {
  it('AC-FIN-001: Sales Invoices shows the company name, searches it, and exports it — never the UUID', async () => {
    hoisted.invoices = [
      { ...invoice, id: 'inv-a', si_number: 'SI-0001', customer_name: 'Acme Energy', customer_id: CUST_A },
      { ...invoice, id: 'inv-b', si_number: 'SI-0002', customer_name: 'Borealis Marine', customer_id: CUST_B },
    ];
    renderPage(<SalesInvoices />);

    // (a) the cell shows the resolved company name and the UUID text appears NOWHERE in the row.
    const table = screen.getByRole('table');
    expect(table.textContent).toContain('Acme Energy');
    expect(table.textContent).toContain('Borealis Marine');
    expect(table.textContent).not.toContain(CUST_A);
    expect(table.textContent).not.toContain(CUST_B);

    // (b) typing a fragment of the customer name keeps the matching row and drops the other.
    // The fragment must appear ONLY in the customer name (not the invoice/reference number), or a
    // search that ignores the name still passes — the dead oracle a mutation run caught here.
    const search = screen.getByRole('searchbox', { name: /search sales invoices/i });
    await userEvent.setup().type(search, 'acme');
    const filtered = screen.getByRole('table').textContent ?? '';
    expect(filtered).toContain('SI-0001');
    expect(filtered).toContain('Acme Energy');
    expect(filtered).not.toContain('SI-0002');
    expect(filtered).not.toContain('Borealis Marine');
    await userEvent.setup().clear(search);

    // (c) the Customer export value is the company name, not the id.
    await userEvent.setup().click(screen.getByRole('button', { name: /export/i }));
    expect(await customerExportFor('SI-0001', 'Invoice #')).toBe('Acme Energy');
    expect(await customerExportFor('SI-0002', 'Invoice #')).toBe('Borealis Marine');
  });

  it('AC-FIN-001: Incoming Payments shows the company name, searches it, and exports it — never the UUID', async () => {
    hoisted.payments = [
      { ...payment, id: 'ip-a', ip_number: 'PAY-0001', customer_name: 'Acme Energy', customer_id: CUST_A },
      { ...payment, id: 'ip-b', ip_number: 'PAY-0002', customer_name: 'Borealis Marine', customer_id: CUST_B },
    ];
    renderPage(<IncomingPayments />);

    const table = screen.getByRole('table');
    expect(table.textContent).toContain('Acme Energy');
    expect(table.textContent).toContain('Borealis Marine');
    expect(table.textContent).not.toContain(CUST_A);
    expect(table.textContent).not.toContain(CUST_B);

    const search = screen.getByRole('searchbox', { name: /search incoming payments/i });
    await userEvent.setup().type(search, 'borealis');
    const filtered = screen.getByRole('table').textContent ?? '';
    expect(filtered).toContain('PAY-0002');
    expect(filtered).toContain('Borealis Marine');
    expect(filtered).not.toContain('PAY-0001');
    expect(filtered).not.toContain('Acme Energy');
    await userEvent.setup().clear(search);

    await userEvent.setup().click(screen.getByRole('button', { name: /export/i }));
    expect(await customerExportFor('PAY-0001', 'Payment #')).toBe('Acme Energy');
    expect(await customerExportFor('PAY-0002', 'Payment #')).toBe('Borealis Marine');
  });

  it('AC-FIN-001: a row with no resolved customer shows a dash, not the UUID, in both lists', () => {
    hoisted.invoices = [{ ...invoice, id: 'inv-null', customer_name: null, customer_id: CUST_A }];
    hoisted.payments = [{ ...payment, id: 'ip-null', customer_name: null, customer_id: CUST_A }];

    const invView = renderPage(<SalesInvoices />);
    const invTable = screen.getByRole('table').textContent ?? '';
    expect(invTable).toContain('—');
    // The id must never leak into the cell even when the name is null.
    expect(invTable).not.toContain(CUST_A);
    invView.unmount();

    renderPage(<IncomingPayments />);
    const payTable = screen.getByRole('table').textContent ?? '';
    expect(payTable).toContain('—');
    expect(payTable).not.toContain(CUST_A);
  });
});

describe('AC-FIN-003 — Finance dates render through the shared locale formatter', () => {
  it('AC-FIN-003: an invoice/payment dated 2025-11-30 renders "30 Nov 2025", never "11/30/2025"', () => {
    setActiveLocale({ locale: 'en-GB', numberLocale: 'en-GB', timezone: 'UTC' });
    const expected = formatDateOnly('2025-11-30');
    expect(expected).toBe('30 Nov 2025'); // the shared formatter under en-GB (locale proof)

    hoisted.invoices = [{ ...invoice, id: 'inv-1', invoice_date: '2025-11-30' }];
    const invView = renderPage(<SalesInvoices />);
    let table = screen.getByRole('table').textContent ?? '';
    expect(table).toContain(expected);
    expect(table).toContain(formatDateOnly('2025-12-30')); // derived due date (2025-11-30 + 30d)
    expect(table).not.toContain('11/30/2025');
    invView.unmount();

    hoisted.payments = [{ ...payment, id: 'ip-1', date: '2025-11-30' }];
    renderPage(<IncomingPayments />);
    table = screen.getByRole('table').textContent ?? '';
    expect(table).toContain(expected);
    expect(table).not.toContain('11/30/2025');
  });
});