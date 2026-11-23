import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '@/src/lib/supabase/client';
import {
  getPurchaseOrderSettings,
  setPurchaseOrderSettings,
  DEFAULT_PO_SIGNATURE_BLOCKS,
} from './purchaseOrderSettings';

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

// ⚑ A narrow handle on the mock. `rpcMock` over the generated `Database` makes TS 5.8 hit TS2589
// ("type instantiation is excessively deep"): the client's rpc overloads are instantiated against the whole schema.
const rpcMock = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

describe('purchaseOrderSettings DAL (#2688)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPurchaseOrderSettings', () => {
    it('returns default fallback settings when no row exists', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      } as never);

      const result = await getPurchaseOrderSettings();
      expect(result).toEqual({
        enabled: false,
        signatureBlocks: DEFAULT_PO_SIGNATURE_BLOCKS,
        authorisedCollectors: [],
      });
    });

    it('returns database row values when present', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [
              {
                print_enabled: true,
                signature_blocks: ['Prepared by', 'Confirmed by'],
                authorised_collectors: ['Alice Smith', 'Bob Jones'],
              },
            ],
            error: null,
          }),
        }),
      } as never);

      const result = await getPurchaseOrderSettings();
      expect(result).toEqual({
        enabled: true,
        signatureBlocks: ['Prepared by', 'Confirmed by'],
        authorisedCollectors: ['Alice Smith', 'Bob Jones'],
      });
    });

    it('throws when select query errors', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database connection failed' },
          }),
        }),
      } as never);

      await expect(getPurchaseOrderSettings()).rejects.toThrow('Database connection failed');
    });
  });

  describe('setPurchaseOrderSettings', () => {
    it('calls po_set_print_settings RPC with mapped arguments', async () => {
      rpcMock.mockResolvedValue({ data: null, error: null } as never);

      await setPurchaseOrderSettings(true, ['Sign 1'], ['Collector 1', 'Collector 2']);

      expect(supabase.rpc).toHaveBeenCalledWith('po_set_print_settings', {
        p_enabled: true,
        p_signature_blocks: ['Sign 1'],
        p_authorised_collectors: ['Collector 1', 'Collector 2'],
      });
    });

    it('throws when RPC fails with error', async () => {
      rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'PO_ADMIN_ONLY' },
      } as never);

      await expect(
        setPurchaseOrderSettings(true, ['Sign 1'], ['Collector 1']),
      ).rejects.toThrow('PO_ADMIN_ONLY');
    });
  });
});
