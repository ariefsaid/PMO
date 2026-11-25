import { describe, expect, it, vi } from 'vitest';
import type { WorkOrderCostLine } from './workOrderCosts';
const fetchRows = vi.hoisted(() => vi.fn());
const fetchRpc = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/supabase/client', () => ({ supabase: {
  from: (table: string) => ({ select: () => ({ in: (_column: string, ids: string[]) => { const result = fetchRows(table, ids); result.limit = () => result; return result; } }) }),
  rpc: (name: string, args: unknown) => fetchRpc(name, args),
} }));
import { listWorkOrderCostMoney, listWorkOrderCostLinks, listWorkOrderTimesheetLabels } from './workOrderCostMoney';
const line = (source: WorkOrderCostLine['source'], recordId: string): WorkOrderCostLine => ({ source, recordId, projectId: 'p', workOrderId: 'w', disciplineId: null, occurredOn: null, reference: null, quantity: null, quantityUnit: null });
describe('work order money reads', () => {
  it('resolves only caller-visible timesheet entry identities to person and week', async () => {
    fetchRows.mockResolvedValue({ data: [{ id: 'entry', timesheet: { week_start_date: '2026-10-26', owner: { full_name: 'Morgan Lee' } } }, { id: 'hidden', timesheet: null }], error: null });
    const result = await listWorkOrderTimesheetLabels([line('timesheet_entry', 'entry'), line('timesheet_entry', 'hidden'), line('purchase_order', 'po')]);
    expect(fetchRows).toHaveBeenCalledWith('timesheet_entries', ['entry', 'hidden']);
    expect(result).toEqual({ entry: { person: 'Morgan Lee', weekStart: '2026-10-26' } });
  });
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
  it('reads hire-costed equipment through the rounded project cost read and keeps this work order’s entries', async () => {
    fetchRpc.mockResolvedValue({ data: [
      { source: 'equipment_usage', record_id: 'usage1', work_order_id: 'w', amount: '300.00', currency: 'USD' },
      { source: 'equipment_usage', record_id: 'usage2', work_order_id: 'other', amount: '75.00', currency: 'USD' },
    ], error: null });

    const result = await listWorkOrderCostMoney([line('equipment_usage', 'usage1')]);

    expect(fetchRpc).toHaveBeenCalledWith('work_order_cost_amounts', { p_project_id: 'p' });
    expect(result.equipment_usage).toEqual({ usage1: { amount: 300, currency: 'USD' } });
  });
  it('keeps equipment quantities visible but marks money restricted for roles that cannot read charges', async () => {
    fetchRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not authorized' } });

    const result = await listWorkOrderCostMoney([line('equipment_usage', 'usage1')]);

    expect(result.equipment_usage).toBeNull();
  });
  it('M6 reads the amount of a stock issue and a timesheet line from the project cost read, per record, for this work order only', async () => {
    fetchRpc.mockResolvedValue({ data: [
      { source: 'stock_document', record_id: 'stk1', amount: '1200.00', currency: 'IDR' },
      { source: 'timesheet_entry', record_id: 'ts1', amount: '495000.00', currency: 'IDR' },
      { source: 'timesheet_entry', record_id: 'elsewhere', amount: '9.00', currency: 'IDR' },
      { source: 'stock_document', record_id: 'stk2', amount: null, currency: null },
    ], error: null });
    const result = await listWorkOrderCostMoney([line('stock_document', 'stk1'), line('stock_document', 'stk2'), line('timesheet_entry', 'ts1')]);
    expect(result.stock_document).toEqual({ stk1: { amount: 1200, currency: 'IDR' } });
    expect(result.timesheet_entry).toEqual({ ts1: { amount: 495000, currency: 'IDR' } });
  });
  it('M6 a Project Manager, who reads labour only in groups, gets no per-record amount and no error', async () => {
    fetchRpc.mockResolvedValue({ data: [{ source: 'timesheet_entry', record_id: null, amount: '495000.00', currency: 'IDR' }], error: null });
    const result = await listWorkOrderCostMoney([line('timesheet_entry', 'ts1')]);
    expect(result.timesheet_entry).toBeUndefined();
  });
  it('#2891 prices an approved expense claim from the project cost read, per record', async () => {
    fetchRpc.mockResolvedValue({ data: [{ source: 'expense_claim', record_id: 'claim1', amount: '1000000.00', currency: 'IDR' }], error: null });
    const result = await listWorkOrderCostMoney([line('expense_claim', 'claim1')]);
    expect(result.expense_claim).toEqual({ claim1: { amount: 1000000, currency: 'IDR' } });
  });
});
