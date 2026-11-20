import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ range: vi.fn(), rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));
import { listExpiringDocuments } from '../documentExpiry';

describe('expiry list', () => {
  it('loads every page beyond the API row cap', async () => {
    const rows = Array.from({ length: 1001 }, (_, id) => ({ id: String(id) }));
    h.range.mockImplementation((from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }));
    h.rpc.mockReturnValue({ range: h.range });
    expect(await listExpiringDocuments()).toHaveLength(1001);
    expect(h.range).toHaveBeenCalledTimes(2);
  });
});
