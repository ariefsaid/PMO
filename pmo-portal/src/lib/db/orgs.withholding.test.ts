import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const calls = {
    from: [] as string[],
    select: [] as unknown[],
    update: [] as unknown[],
    eq: [] as unknown[],
    limit: [] as unknown[],
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: 'select' | 'update' | 'eq' | 'limit') => (...args: unknown[]) => {
    (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.select = chain('select');
  builder.update = chain('update');
  builder.eq = chain('eq');
  builder.limit = chain('limit');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(queue.shift() ?? { data: null, error: null });
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, queue, result: { data: [{ id: 'org-1', tax_prepaid_account: 'Tax Prepaid - DEMO' }], error: null as null | { message: string } } };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
import { getOrgWithholdingAccount, setOrgWithholdingAccount } from './orgs';
beforeEach(() => {
  h.from.mockClear();
  h.queue.length = 0;
  // A default happy path: the pre-read AND the update both resolve the landed org row.
  h.queue.push(h.result);
  h.queue.push(h.result);
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    (h.calls[k] as unknown[]).length = 0;
  }
});
it('AC-WHT-004: reads the RLS-scoped org account setting without a client org filter', async () => {
  expect(await getOrgWithholdingAccount()).toBe('Tax Prepaid - DEMO');
  expect(h.calls.select).toEqual(['tax_prepaid_account']);
  expect(h.calls.eq).toEqual([]);
});
it('AC-WHT-004: changing the account writes only that column to the RLS-resolved org', async () => {
  await setOrgWithholdingAccount(' Tax Credit - DEMO ');
  expect(h.calls.update).toEqual([{ tax_prepaid_account: 'Tax Credit - DEMO' }]);
  expect(h.calls.eq).toEqual([['id', 'org-1']]);
});
it('AC-WHT-004: refusing an account longer than the ERP link limit makes no write', async () => {
  await expect(setOrgWithholdingAccount('x'.repeat(141))).rejects.toThrow(/140/);
  expect(h.calls.update).toEqual([]);
});
it('AC-WHT-004: the UPDATE asks for the changed row back so a filtered-out write is detectable', async () => {
  await setOrgWithholdingAccount('Tax Credit - DEMO');
  // select('id') on the pre-read AND on the UPDATE chain (the write's landing proof).
  expect(h.calls.select).toEqual(['id', 'id']);
});
it('AC-WHT-004: a policy-filtered UPDATE (no changed row) refuses instead of reporting success', async () => {
  h.queue.length = 0;
  h.queue.push({ data: [{ id: 'org-1' }], error: null }); // pre-read: the org is visible
  h.queue.push({ data: [], error: null }); // UPDATE matched no rows, PostgREST reports no error
  await expect(setOrgWithholdingAccount('Tax Credit - DEMO')).rejects.toThrow(/permission/i);
});
