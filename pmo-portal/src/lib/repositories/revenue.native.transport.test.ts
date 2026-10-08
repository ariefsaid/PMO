import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #913 review — binding test for the native invoice create's TRANSPORT payload. The sibling
 * `revenue.native.test.ts` mocks the DAL (`createNativeSalesInvoice`), so it can only see up to
 * that seam: if either the repository or the DAL dropped `workOrderId` on the way to migration
 * 0275's RPC, the invoice would silently stop billing its work order (0262's past-the-value fence
 * would never count it). This file exercises the REAL repository → revenueNative → RPC chain with
 * ONLY the network boundary (`supabase.rpc`) faked — the same only-the-transport rule as
 * InvoiceWorkOrderModal.transport. The RPC signature (0275) is
 * `(p_project_id, p_customer_id, p_lines, p_work_order_id default null)` — there is no currency
 * argument: the server derives currency and VAT from the project (OD-TAX-4) and cross-checks the
 * work order's own currency in its body.
 */
const h = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, functions: { invoke: h.invoke } } }));

import { repositories } from '@/src/lib/repositories';
import { clearOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: 'si-native-1', error: null });
  // Cold cache = the fail-closed 'pmo' route the native path owns (no ERP seeded).
  clearOwnershipCache();
});
afterEach(() => clearOwnershipCache());

describe('repositories.revenue.createInvoice — the native RPC receives the whole invoice (#913 binding)', () => {
  it('carries the work order id, project, customer and line into create_native_sales_invoice — dropping the work order would unbill the invoice', async () => {
    const items = [{ item_code: 'SVC-FAB', qty: 1, rate: 80_000, description: 'WO-1 — Phase 1 fabrication' }];
    await expect(
      repositories.revenue.createInvoice({ customerId: 'c-1', projectId: 'p-1', workOrderId: 'wo-1', items }),
    ).resolves.toEqual({ id: 'si-native-1', si_number: null });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('create_native_sales_invoice', {
      p_project_id: 'p-1',
      p_customer_id: 'c-1',
      p_work_order_id: 'wo-1',
      p_lines: items,
    });
    // Cold cache routes 'pmo': the native create must never reach the dispatch transport.
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('an invoice with no work order sends no work-order key at all — not a null', async () => {
    const items = [{ item_code: 'SVC', qty: 2, rate: 500 }];
    await repositories.revenue.createInvoice({ customerId: 'c-1', projectId: 'p-1', items });
    expect(h.rpc).toHaveBeenCalledWith('create_native_sales_invoice', {
      p_project_id: 'p-1',
      p_customer_id: 'c-1',
      p_lines: items,
    });
  });
});
