import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), result: { data: [] as unknown, error: null as unknown } }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
import { correctSlip, getSlip, listBills, listSlips, readBillContexts, recordSlip, voidSlip } from './vendorWithholdingSlips';

beforeEach(() => { vi.clearAllMocks(); h.result = { data: [{ slip_id: 'slip-1', revision: 1 }], error: null }; h.rpc.mockImplementation(async () => h.result); });
const input = { slipId: 'slip-1', vendorId: 'vendor-1', slipNumber: ' BUPOT/1 ', slipDate: '2026-10-01', taxPeriod: '2026-10-01', pphType: 'pph23' as const, taxBase: '999999999999.99', withheldAmount: '0.01', invoiceIds: ['invoice-1'], declaredInvoiceIds: [] };

it('AC-BUPOT-014 DAL record sends only the RPC intent and exact decimal contract', async () => {
  await expect(recordSlip(input)).resolves.toEqual({ slipId: 'slip-1', revision: 1 });
  expect(h.rpc).toHaveBeenCalledWith('record_vendor_withholding_slip', {
    p_slip_id: 'slip-1', p_vendor_id: 'vendor-1', p_slip_number: ' BUPOT/1 ', p_slip_date: '2026-10-01',
    p_tax_period: '2026-10-01', p_pph_type: 'pph23', p_tax_base: '999999999999.99', p_withheld_amount: '0.01',
    p_invoice_ids: ['invoice-1'], p_declared_invoice_ids: [],
  });
  expect(JSON.stringify(h.rpc.mock.calls[0])).not.toMatch(/org_id|actor|created_by/);
});
it('AC-BUPOT-014 DAL calls all three writer RPC contracts without org or actor arguments', async () => {
  await correctSlip({ slipId: 's', expectedRevision: 3, slipNumber: 'n', slipDate: '2026-09-01', taxPeriod: '2026-09-01', reason: 'fix' });
  expect(h.rpc).toHaveBeenLastCalledWith('correct_vendor_withholding_slip', { p_slip_id: 's', p_expected_revision: 3, p_slip_number: 'n', p_slip_date: '2026-09-01', p_tax_period: '2026-09-01', p_reason: 'fix' });
  await voidSlip({ slipId: 's', expectedRevision: 4, reason: 'void' });
  expect(h.rpc).toHaveBeenLastCalledWith('void_vendor_withholding_slip', { p_slip_id: 's', p_expected_revision: 4, p_reason: 'void' });
});
it('AC-BUPOT-014 DAL list readers preserve cursor DTOs and bind their server filters', async () => {
  h.result.data = [{ slip_id: 's', tax_period: '2026-10-01' }];
  await expect(listSlips({ p_vendor_id: 'v', limit: 1 })).resolves.toMatchObject({ nextCursor: { period: '2026-10-01', id: 's' } });
  expect(h.rpc).toHaveBeenLastCalledWith('list_vendor_withholding_slips', expect.objectContaining({ p_vendor_id: 'v', p_limit: 1 }));
  h.result.data = [{ invoice_id: 'i', invoice_date: null }];
  await expect(listBills({ p_candidates_only: true, limit: 1 })).resolves.toMatchObject({ nextCursor: { nullDate: true, id: 'i' } });
  expect(h.rpc).toHaveBeenLastCalledWith('list_vendor_withholding_bills', expect.objectContaining({ p_candidates_only: true, p_limit: 1 }));
  h.result.data = { header: {}, bills: [] };
  await expect(getSlip('s')).resolves.toEqual({ header: {}, bills: [] });
});
it('AC-UXT-007 batches unique case and project labels in two RLS-scoped reads', async () => {
  const calls: Array<{ table: string; columns: string; ids: string[] }> = [];
  const rows = {
    procurements: [{ id: 'case-a', title: 'Case North' }],
    projects: [{ id: 'project-a', name: 'Harbor works', pmo_project_number: 'PRJ-2641' }],
  };
  h.from.mockImplementation((table: 'procurements' | 'projects') => {
    let columns = '';
    let ids: string[] = [];
    const builder = {
      select: vi.fn((value: string) => { columns = value; return builder; }),
      in: vi.fn((_column: string, value: string[]) => { ids = value; return builder; }),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        calls.push({ table, columns, ids });
        return Promise.resolve({ data: rows[table], error: null }).then(resolve, reject);
      },
    };
    return builder;
  });
  await expect(readBillContexts({ procurementIds: ['case-b', 'case-a', 'case-a'], projectIds: ['project-a', 'project-a'] })).resolves.toEqual({
    procurements: { 'case-a': 'Case North' }, projects: { 'project-a': { name: 'Harbor works', pmoProjectNumber: 'PRJ-2641' } },
  });
  expect(calls).toEqual([
    { table: 'procurements', columns: 'id,title', ids: ['case-a', 'case-b'] },
    { table: 'projects', columns: 'id,name,pmo_project_number', ids: ['project-a'] },
  ]);
  expect(JSON.stringify(calls)).not.toMatch(/org_id|rpc|write/i);
});

it('AC-BUPOT-014 DAL keeps the database error code and stable DETAIL', async () => {
  const error = { message: 'opaque', code: '23514', details: 'bupot-amount-mismatch' };
  h.result = { data: null, error };
  await expect(recordSlip(input)).rejects.toBe(error);
});
