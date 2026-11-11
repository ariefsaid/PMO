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
  return { from, calls, queue, result: { data: [{ id: 'org-1', tax_prepaid_account: 'Tax Prepaid - DEMO', pph23_prepaid_account: 'PPh 23 Prepaid - DEMO', pph4_2_prepaid_account: null }], error: null as null | { message: string } } };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
import { getOrgWithholdingAccounts, setOrgWithholdingAccounts } from './orgs';
const NONE = { defaultAccount: null, pph23Account: null, pph42Account: null };
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
it('AC-WHA-001: getOrgWithholdingAccounts reads the default, PPh 23 and PPh 4(2) accounts', async () => {
  expect(await getOrgWithholdingAccounts()).toEqual({ defaultAccount: 'Tax Prepaid - DEMO', pph23Account: 'PPh 23 Prepaid - DEMO', pph42Account: null });
  expect(h.calls.select).toEqual(['tax_prepaid_account,pph23_prepaid_account,pph4_2_prepaid_account']);
  expect(h.calls.eq).toEqual([]);
});
it('AC-WHA-001: setOrgWithholdingAccounts trims, nulls blanks and writes all three to the one readable org', async () => {
  await setOrgWithholdingAccounts({ defaultAccount: ' Tax Credit - DEMO ', pph23Account: '  ', pph42Account: 'PPh 4(2) - DEMO' });
  expect(h.calls.update).toEqual([{ tax_prepaid_account: 'Tax Credit - DEMO', pph23_prepaid_account: null, pph4_2_prepaid_account: 'PPh 4(2) - DEMO' }]);
  expect(h.calls.eq).toEqual([['id', 'org-1']]);
});
it('AC-WHT-004: refusing an account longer than the ERP link limit makes no write', async () => {
  await expect(setOrgWithholdingAccounts({ ...NONE, pph42Account: 'x'.repeat(141) })).rejects.toThrow(/140/);
  expect(h.calls.update).toEqual([]);
});
it('AC-WHT-004: the UPDATE asks for the changed row back so a filtered-out write is detectable', async () => {
  await setOrgWithholdingAccounts(NONE);
  // select('id') on the pre-read AND on the UPDATE chain (the write's landing proof).
  expect(h.calls.select).toEqual(['id', 'id']);
});
it('AC-WHA-001: a silent no-op update is surfaced as a permission refusal', async () => {
  h.queue.length = 0;
  h.queue.push({ data: [{ id: 'org-1' }], error: null }); // pre-read: the org is visible
  h.queue.push({ data: [], error: null }); // UPDATE matched no rows, PostgREST reports no error
  await expect(setOrgWithholdingAccounts({ ...NONE, defaultAccount: 'Tax Credit - DEMO' })).rejects.toThrow(/permission/i);
});
