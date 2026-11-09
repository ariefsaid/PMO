import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { AppError } from '@/src/lib/appError';
import { odooLedgerRepository } from './odooLedger';

beforeEach(() => h.rpc.mockReset());

describe('odooLedger repository (#1507 S7)', () => {
  it('turns a refusal into an AppError that keeps the database code', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'ledger_not_checked', code: 'P0001' } });
    const err = await odooLedgerRepository.switchBasis().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'P0001', message: 'ledger_not_checked' });
  });

  it('reads health through the DAL', async () => {
    h.rpc.mockResolvedValueOnce({ data: { state: 'fresh', asOf: null, caughtUp: true, lastCensus: null, check: null, lastGood: null, unmapped: null, unattributed: null, unlinked: null }, error: null });
    await expect(odooLedgerRepository.health()).resolves.toMatchObject({ state: 'fresh', caughtUp: true });
  });
});
