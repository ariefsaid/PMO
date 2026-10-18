import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => {
  const state = { result: { data: null as unknown, error: null as unknown } };
  const calls: { name: string; args: unknown }[] = [];
  const rpc = vi.fn((name: string, args: unknown) => {
    calls.push({ name, args });
    return Promise.resolve(state.result);
  });
  return { state, calls, rpc };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { searchRecordReferences } from './recordReferenceSearch';

const validPage = {
  items: [
    {
      kind: 'invoice',
      id: 'invoice-id',
      title: 'Synthetic sales invoice',
      context: 'Synthetic customer · North service project',
      reference: 'INV-2026-041',
      aliases: ['INV-2026-041', 'CUSTOMER-ORDER-041'],
      exact: true,
    },
    {
      kind: 'receipt',
      id: 'receipt-id',
      title: 'Synthetic incoming payment',
      context: null,
      reference: 'PAY-2026-041',
      aliases: ['PAY-2026-041'],
      exact: false,
    },
  ],
  hasMore: false,
};

beforeEach(() => {
  h.state.result = { data: null, error: null };
  h.calls.length = 0;
  h.rpc.mockClear();
});

describe('searchRecordReferences DAL (AC-S40-003 contract)', () => {
  it('AC-S40-003: calls the bounded reference RPC with the exact query and validates its result', async () => {
    h.state.result = { data: validPage, error: null };

    await expect(searchRecordReferences('  Inv-2026-041  ')).resolves.toEqual(validPage);
    expect(h.calls).toEqual([{
      name: 'search_record_references',
      args: { p_query: '  Inv-2026-041  ', p_limit: 8 },
    }]);
  });

  it('AC-S40-003: preserves PostgREST error codes as AppError', async () => {
    h.state.result = { data: null, error: { message: 'synthetic denied', code: '42501' } };

    await expect(searchRecordReferences('INV')).rejects.toMatchObject({
      name: 'AppError',
      message: 'synthetic denied',
      code: '42501',
    });
  });

  it('AC-S40-003: rejects a malformed or over-cap JSON response instead of partially trusting it', async () => {
    h.state.result = { data: { items: [{ kind: 'invoice', id: 'invoice-id' }], hasMore: false }, error: null };

    await expect(searchRecordReferences('INV')).rejects.toBeInstanceOf(AppError);
  });

  it('AC-S40-003: rejects a response that exceeds the requested result bound', async () => {
    h.state.result = { data: { items: Array.from({ length: 9 }, (_, index) => ({
      ...validPage.items[0],
      id: `invoice-${index}`,
    })), hasMore: true }, error: null };

    await expect(searchRecordReferences('INV')).rejects.toBeInstanceOf(AppError);
  });
});
