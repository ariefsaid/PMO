import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
import { updateProcurementHeader } from './procurementCrud';

beforeEach(() => {
  h.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  h.from.mockReset();
});

describe('requester header save', () => {
  it('sends the editable fields to the authorized header command without replacing an omitted category', async () => {
    await updateProcurementHeader('case-1', { title: 'Cable', projectId: null, vendorId: 'vendor-1' });
    expect(h.rpc).toHaveBeenCalledWith('update_procurement_header', {
      p_id: 'case-1', p_patch: { title: 'Cable', project_id: null, vendor_id: 'vendor-1' },
    });
    expect(h.from).not.toHaveBeenCalled();
  });
  it('preserves an explicit category clear', async () => {
    await updateProcurementHeader('case-1', { title: 'Cable', projectId: null, vendorId: null, budgetCategory: null });
    expect(h.rpc).toHaveBeenCalledWith('update_procurement_header', expect.objectContaining({ p_patch: expect.objectContaining({ budget_category: null }) }));
  });
  it('surfaces the server denial to the caller', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(updateProcurementHeader('case-1', { title: 'Cable', projectId: null, vendorId: null })).rejects.toMatchObject({ code: '42501' });
  });
});
