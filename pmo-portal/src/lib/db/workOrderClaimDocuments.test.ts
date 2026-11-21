import { describe, expect, it, vi } from 'vitest';
const reads = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from(table: string) {
  const state = { table, select: '', column: '', value: '' };
  const query = { select(value: string) { state.select = value; return query; }, eq(column: string, value: string) { state.column = column; state.value = value; return query; }, order() { return query; }, gt() { return query; }, limit() { return Promise.resolve(reads(state)); } };
  return query;
} } }));
import { listWorkOrderClaimDocuments } from './workOrders';
describe('work order claim documents', () => {
  it('reads caller-visible T&M and progress evidence for the requested work order', async () => {
    reads.mockImplementation(({ table }: { table: string }) => ({ data: table === 'tm_claims' ? [{ id: '1', document_id: 'tm' }] : [{ id: '2', document_id: 'progress' }], error: null }));
    expect(await listWorkOrderClaimDocuments('wo')).toEqual(['tm', 'progress']);
    expect(reads).toHaveBeenCalledWith(expect.objectContaining({ table: 'tm_claims', column: 'work_order_id', value: 'wo' }));
    expect(reads).toHaveBeenCalledWith(expect.objectContaining({ table: 'progress_claim_evidence', column: 'progress_claims.work_order_id', value: 'wo' }));
  });
});
