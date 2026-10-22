import { describe, expect, it } from 'vitest';
import { runQueryEntity } from '../../../../supabase/functions/agent-chat/actions';
import { fakeSupabase } from './testing/fakeSupabase';
import type { DeputyContext } from './runtime/port';

const ctxFor = (client: unknown): DeputyContext => ({ jwt: 'caller-jwt', userId: 'user-1', orgId: 'org-1', supabase: client as DeputyContext['supabase'] });

describe('query_entity accuracy contracts', () => {
  it('AC-ACC-005 sums finite numeric values by group and counts null amounts as zero', async () => {
    const rows = [
      { id: '1', procurement_id: 'p1', amount: '10.25' },
      { id: '2', procurement_id: 'p1', amount: 2.75 },
      { id: '3', procurement_id: 'p2', amount: null },
    ];
    const { client, calls } = fakeSupabase((call) => {
      if (call.table !== 'purchase_orders' || call.terminal !== 'then') return { data: null, error: null };
      const range = call.ops.find(([op]) => op === 'range');
      const offset = Number(range?.[1] ?? 0);
      return { data: rows.slice(offset, offset + 1000), error: null };
    });
    const result = await runQueryEntity({ entity: 'purchase_orders', group_by: 'procurement_id', sum: 'amount' }, ctxFor(client));
    expect(result).toEqual({ groups: [
      { key: 'p1', count: 2, sum: 13 }, { key: 'p2', count: 1, sum: 0 },
    ], rowCount: 3, truncated: false });
    expect(calls[0].ops).toContainEqual(['range', 0, 999]);
    expect(calls[0].columns).toBe('id,procurement_id,amount');
  });

  it('AC-ACC-007 rejects non-whitelisted aggregate columns before opening a read', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: [], error: null }));
    const result = await runQueryEntity({ entity: 'purchase_orders', group_by: 'org_id' }, ctxFor(client));
    expect(result).toEqual({ error: 'unknown group_by column: org_id' });
    expect(calls).toHaveLength(0);
  });
});
