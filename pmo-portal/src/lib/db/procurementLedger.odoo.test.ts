import { describe, it, expect } from 'vitest';
import { buildLedgerRows } from './procurementLedger';
import type { ProcurementDetail } from './procurementLifecycle';

const detail = (over: Record<string, unknown>) => ({
  id: 'p1', status: 'Paid', created_at: '2026-01-01T00:00:00Z', currency: 'IDR',
  quotations: [], receipts: [], invoices: [], purchase_requests: [], rfqs: [], purchase_orders: [], payments: [], ...over,
}) as unknown as ProcurementDetail;
const inv = (over: Record<string, unknown>) => ({ id: 'i1', invoice_date: '2026-05-01', created_at: '2026-05-01T00:00:00Z', tax_treatment: 'exclusive', status: 'Received', currency: 'IDR', amount: 100, ...over });
const READ = '2026-11-03T10:00:00Z';

describe('AC-OPP-080 buildLedgerRows carries the Odoo facts of a mirrored record', () => {
  it('an Odoo bill, receipt, order and payment each carry state, attention and read time', () => {
    const rows = buildLedgerRows(detail({
      invoices: [inv({ erp_state: 'posted', erp_attention: 'total-mismatch', erp_read_at: READ })],
      purchase_orders: [{ id: 'o1', date: '2026-04-01', created_at: '2026-04-01T00:00:00Z', status: 'Issued', currency: 'IDR', erp_state: 'to approve', erp_read_at: READ }],
      payments: [{ id: 'y1', date: '2026-05-02', created_at: '2026-05-02T00:00:00Z', status: 'Posted', currency: 'IDR', erp_state: 'paid', erp_read_at: READ }],
      receipts: [{ id: 'r1', receipt_date: '2026-04-20', created_at: '2026-04-20T00:00:00Z', status: 'Complete', erp_state: 'done', erp_read_at: READ }],
    }));
    const odoo = Object.fromEntries(rows.map((r) => [r.type, r.odoo]));
    expect(odoo.Invoice).toMatchObject({ erpState: 'posted', erpAttention: 'total-mismatch', erpReadAt: READ });
    expect(odoo.PO).toMatchObject({ erpState: 'to approve', erpAttention: null, erpReadAt: READ });
    expect(odoo.Payment).toMatchObject({ erpState: 'paid' });
    expect(odoo.GR).toMatchObject({ erpState: 'done' });
  });

  it('a record PMO owns carries no Odoo facts, so its row renders exactly as before', () => {
    const rows = buildLedgerRows(detail({ invoices: [inv({ erp_state: null, erp_attention: null, erp_read_at: null })] }));
    expect(rows[0].odoo).toBeUndefined();
  });

  it('FR-OPP-034 a receipt shows what Odoo booked and what was entered, summed over its lines', () => {
    const rows = buildLedgerRows(detail({ receipts: [{
      id: 'r1', receipt_date: '2026-04-20', created_at: '2026-04-20T00:00:00Z', status: 'Partial', erp_state: 'done', erp_read_at: READ,
      odoo_booked: [{ lineId: 1, productId: 5, quantity: 3 }, { lineId: 2, productId: 6, quantity: 5 }],
      odoo_entered: [{ lineId: 1, productId: 5, quantity: 4 }, { lineId: 2, productId: 6, quantity: 6 }],
    }] }));
    expect(rows[0].odoo).toMatchObject({ booked: 8, entered: 10 });
  });

  it('a receipt with no quantities yet shows none (null, never zero)', () => {
    const rows = buildLedgerRows(detail({ receipts: [{ id: 'r1', receipt_date: '2026-04-20', created_at: '2026-04-20T00:00:00Z', status: 'Partial', erp_state: 'confirmed', erp_read_at: READ, odoo_booked: null, odoo_entered: null }] }));
    expect(rows[0].odoo).toMatchObject({ booked: null, entered: null });
  });
});
