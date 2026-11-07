import { OPEN_CLIENT_INVOICE_STATUSES } from '@/src/lib/revenue/clientInvoiceStatus';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  select: vi.fn(),
  inFilter: vi.fn(),
  isFilter: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  from: vi.fn(),
  rows: [] as unknown[],
}));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { getOverdueInvoiceCount } from './revenue';

describe('getOverdueInvoiceCount', () => {
  it('counts overdue open invoices from a narrow read and excludes paired copies', async () => {
    const builder = {
      select: h.select,
      in: h.inFilter,
      is: h.isFilter,
      order: h.order,
      range: h.range,
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({ data: h.rows, error: null }),
    };
    h.from.mockReturnValue(builder);
    h.select.mockReturnValue(builder);
    h.inFilter.mockReturnValue(builder);
    h.isFilter.mockReturnValue(builder);
    h.order.mockReturnValue(builder);
    h.range.mockReturnValue(builder);
    h.rows = [
      { status: 'Unpaid', invoice_date: '2026-01-01', erp_due_date: null, received_date: null, companies: { erp_payment_terms_days: 10 } },
      { status: 'Submitted', invoice_date: '2026-01-01', erp_due_date: '2026-11-04', received_date: null, companies: null },
      { status: 'Unpaid', invoice_date: '2026-01-01', erp_due_date: '2026-11-06', received_date: null, companies: null },
    ];

    await expect(getOverdueInvoiceCount('2026-11-05')).resolves.toBe(2);
    expect(h.from).toHaveBeenCalledWith('sales_invoices');
    expect(h.select).toHaveBeenCalledWith('id,status,invoice_date,erp_due_date,received_date,companies!sales_invoices_customer_id_fkey(erp_payment_terms_days)');
    expect(h.inFilter).toHaveBeenCalledWith('status', [...OPEN_CLIENT_INVOICE_STATUSES]);
    expect(h.isFilter).toHaveBeenCalledWith('paired_erp_invoice_id', null);
  });
});
