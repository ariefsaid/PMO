import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc } }));
import { createProcurementWithItems } from './procurementCrud';

const input = {
  id: 'header-id',
  header: { title: 'Materials', projectId: null, vendorId: null },
  lines: [{ id: 'line-id', name: 'Material', quantity: 2, rate: 1.25 }],
};

describe('atomic procurement creation', () => {
  beforeEach(() => rpc.mockReset());

  it('submits stable IDs and all lines together without client authority fields', async () => {
    rpc.mockResolvedValue({ data: { id: 'header-id' }, error: null });
    await expect(createProcurementWithItems(input)).resolves.toEqual({ id: 'header-id' });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('create_procurement_with_items', {
      p_id: 'header-id', p_header: { title: 'Materials', project_id: null, vendor_id: null },
      p_items: [{ id: 'line-id', name: 'Material', quantity: 2, rate: 1.25, description: null }],
    });
  });

  it('preserves server conflict errors for reconciliation', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'conflict' } });
    await expect(createProcurementWithItems(input)).rejects.toMatchObject({ code: '23505', message: 'conflict' });
  });
});
