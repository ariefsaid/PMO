/** AC-OPP-080 / AC-OPP-081 (FR-OPP-034/090/092): the ledger shows each Odoo record's plain state, age, next step and booked quantities. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-fin', org_id: 'org1', role: 'Finance' } }) }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance', canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/components/ui', async (orig) => ({ ...(await orig<typeof import('@/src/components/ui')>()), useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/src/hooks/useProcurementFiles', () => ({
  useProcurementFiles: vi.fn(() => ({ list: { data: [], isPending: false, isError: false }, upload: { mutate: vi.fn(), isPending: false }, archive: { mutate: vi.fn(), isPending: false }, download: vi.fn(), progress: null, uploadError: null, cancelUpload: vi.fn(), clearUploadError: vi.fn() })),
}));
vi.mock('@/src/lib/db/procurementFiles', () => ({ listProcurementFiles: vi.fn(async () => []), getSignedDownloadUrl: vi.fn() }));
vi.mock('@/src/hooks/useOdooPurchase', () => ({
  useOdooPurchaseCommands: () => ({ data: [], isError: false }),
  useOdooUnreachable: () => ({ unreachable: false, lastOkAt: null }),
  useResolveHeldPayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/lib/format', async (orig) => ({ ...(await orig<typeof import('@/src/lib/format')>()), formatRelativeTime: (iso: string | null) => (iso ? '4 minutes ago' : '—') }));
vi.mock('@/src/lib/repositories/procurement', () => ({
  procurementRepository: {},
}));

import { ProcurementLedger } from './ProcurementLedger';
import { clearOwnershipCache, setTaskOwnership } from '@/src/lib/adapterSeam/ownershipCache';
import { buildLedgerRows } from '@/src/lib/db/procurementLedger';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';

const READ = '2026-11-03T10:00:00Z';
const detail = (extra: Record<string, unknown>) => ({
  id: 'proc-1', org_id: 'org-1', title: 'T', status: 'Vendor Invoiced', created_at: '2026-01-01T00:00:00Z', currency: 'IDR',
  items: [], quotations: [], receipts: [], invoices: [], purchase_requests: [], rfqs: [], purchase_orders: [], payments: [], statusEvents: [], ...extra,
}) as unknown as ProcurementDetail;
const inv = (over: Record<string, unknown>) => ({ id: 'i1', vi_number: 'VI-1', invoice_date: '2026-05-01', created_at: '2026-05-01T00:00:00Z', tax_treatment: 'exclusive', status: 'Received', currency: 'IDR', amount: 1110000, tax_amount: 110000, withheld_amount: 0, erp_docstatus: 1, ...over });

function show(d: ProcurementDetail) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter>
      <ProcurementLedger detail={d} rows={buildLedgerRows(d)} procurementId="proc-1" uploadedById="user-fin" canWrite invoices={(d.invoices ?? []) as never} />
    </MemoryRouter></QueryClientProvider>,
  );
}
beforeEach(() => { vi.clearAllMocks(); setTaskOwnership([{ domain: 'procurement', externalTier: 'odoo' }]); });
afterEach(() => { cleanup(); clearOwnershipCache(); });

describe('AC-OPP-080 ledger rows carry the Odoo state', () => {
  it('a confirmed record says it is in Odoo and when it was read, without a second pill', () => {
    show(detail({ invoices: [inv({ erp_state: 'posted', erp_read_at: READ })] }));
    const row = screen.getByRole('row', { name: /VI-1/ });
    expect(row).toHaveTextContent('In Odoo');
    expect(row).toHaveTextContent('Read 4 minutes ago');
    expect(within(row).queryByTestId('odoo-outcome-next')).toBeNull();
  });

  it('a bill whose total differs shows "Check in Odoo" with the next step (FR-OPP-044)', () => {
    show(detail({ invoices: [inv({ erp_state: 'posted', erp_read_at: READ, erp_attention: 'total-mismatch' })] }));
    const row = screen.getByRole('row', { name: /VI-1/ });
    expect(row).toHaveTextContent('Check in Odoo');
    expect(within(row).getByTestId('odoo-outcome-next')).toHaveTextContent(/before paying it/);
  });

  it('a record PMO owns shows no Odoo line at all (renders exactly as today)', () => {
    show(detail({ invoices: [inv({ erp_state: null })] }));
    expect(screen.getByRole('row', { name: /VI-1/ })).not.toHaveTextContent(/Odoo/);
  });

  it('FR-OPP-034 a receipt shows what Odoo booked beside what was entered', () => {
    show(detail({ receipts: [{ id: 'r1', gr_number: 'GR-1', receipt_date: '2026-04-20', created_at: '2026-04-20T00:00:00Z', status: 'Partial', erp_state: 'done', erp_read_at: READ,
      odoo_booked: [{ lineId: 1, productId: 2, quantity: 8 }], odoo_entered: [{ lineId: 1, productId: 2, quantity: 10 }] }] }));
    expect(screen.getByTestId('odoo-quantities')).toHaveTextContent('Received in Odoo: 8 · entered 10');
  });

  it('a receipt Odoo booked exactly as entered shows the booked quantity only', () => {
    show(detail({ receipts: [{ id: 'r1', gr_number: 'GR-1', receipt_date: '2026-04-20', created_at: '2026-04-20T00:00:00Z', status: 'Complete', erp_state: 'done', erp_read_at: READ,
      odoo_booked: [{ lineId: 1, productId: 2, quantity: 10 }], odoo_entered: [{ lineId: 1, productId: 2, quantity: 10 }] }] }));
    expect(screen.getByTestId('odoo-quantities')).toHaveTextContent('Received in Odoo: 10');
    expect(screen.getByTestId('odoo-quantities')).not.toHaveTextContent('entered');
  });
});

describe('AC-OPP-081 withholding figures follow the bill', () => {
  it('a withheld bill shows VAT, tax withheld and net payable under its amount', () => {
    show(detail({ invoices: [inv({ erp_state: 'posted', erp_read_at: READ, withheld_amount: 20000, tax_treatment: 'inclusive' })] }));
    expect(screen.getByTestId('vi-withholding-breakdown')).toBeInTheDocument();
    expect(screen.getByTestId('vi-withholding-net')).toHaveTextContent(/1[.,]090[.,]000/);
  });

  it('a plain bill shows none of the three figures', () => {
    show(detail({ invoices: [inv({ erp_state: 'posted', erp_read_at: READ, withheld_amount: 0 })] }));
    expect(screen.queryByTestId('vi-withholding-breakdown')).toBeNull();
  });
});

describe('FR-OPP-054 a bill whose payment Odoo has not yet shown', () => {
  it('says the payment was sent and Odoo has not caught up, never Paid', () => {
    show(detail({
      invoices: [inv({ amount: 1000, tax_amount: 0, erp_state: 'posted', erp_read_at: READ, erp_outstanding_amount: 1000 })],
      payments: [{ id: 'y1', invoice_id: 'i1', amount: 1000, date: '2026-05-02', created_at: '2026-05-02T00:00:00Z', status: 'Posted', currency: 'IDR', erp_state: 'paid', erp_read_at: READ }],
    }));
    const row = screen.getByRole('row', { name: /VI-1/ });
    expect(row).toHaveTextContent('Payment sent, awaiting Odoo');
    expect(row).not.toHaveTextContent(/Paid/);
  });
});
