import { describe, expect, it, vi } from 'vitest';
import type { WorkOrderCostLine } from './workOrderCosts';
const fetchRows = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: (table: string) => ({ select: () => ({ in: (_column: string, ids: string[]) => fetchRows(table, ids) }) }) } }));
import { listWorkOrderCostMoney, listWorkOrderCostLinks } from './workOrderCostMoney';
const line = (source: WorkOrderCostLine['source'], recordId: string): WorkOrderCostLine => ({ source, recordId, projectId: 'p', workOrderId: 'w', disciplineId: null, occurredOn: null, reference: null, quantity: null, quantityUnit: null });
describe('work order money reads', () => {
  it('finds each purchase record’s own parent for a direct timeline link', async () => {
    fetchRows.mockResolvedValue({ data: [{ id: 'bill', procurement_id: 'purchase-1' }], error: null });
    const links = await listWorkOrderCostLinks([line('vendor_bill', 'bill')]);
    expect(links['vendor_bill:bill']).toBe('/procurement/purchase-1/timeline#cost-bill');
  });
  it('marks a partially unreadable source restricted rather than showing partial totals', async () => {
    fetchRows.mockResolvedValue({ data: [{ id: 'bill1', amount: 10, currency: 'USD' }], error: null });
    const result = await listWorkOrderCostMoney([line('vendor_bill', 'bill1'), line('vendor_bill', 'bill2')]);
    expect(result.vendor_bill).toBeNull();
  });
  it('does not describe a readable bill with no amount as restricted', async () => {
    fetchRows.mockResolvedValue({ data: [{ id: 'bill', amount: null, currency: 'USD' }], error: null });
    const result = await listWorkOrderCostMoney([line('vendor_bill', 'bill')]);
    expect(result.vendor_bill).toEqual({});
  });
  it('reads vendor bill amounts from their source in their actual currency', async () => {
    fetchRows.mockResolvedValue({ data: [{ id: 'bill', amount: 123.45, currency: 'USD' }], error: null });
    const result = await listWorkOrderCostMoney([line('vendor_bill', 'bill')]);
    expect(fetchRows).toHaveBeenCalledWith('procurement_invoices', ['bill']);
    expect(result.vendor_bill).toEqual({ bill: { amount: 123.45, currency: 'USD' } });
  });
});
