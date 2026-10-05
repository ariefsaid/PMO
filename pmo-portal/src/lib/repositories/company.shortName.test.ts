import { describe, it, expect, vi, beforeEach } from 'vitest';
// A flexible chainable mock of the supabase query builder (mirrors tasks.test.ts) PLUS a spy on
// `functions.invoke` (the dispatch transport) so both halves of the invariant are observable.
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    order: [] as unknown[],
    insert: [] as unknown[],
    update: [] as unknown[],
    match: [] as unknown[],
    delete: 0,
    single: 0,
    maybeSingle: 0,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    if (name === 'delete' || name === 'single' || name === 'maybeSingle') {
      (calls[name] as number)++;
    } else {
      (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    }
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.order = chain('order');
  builder.insert = chain('insert');
  builder.update = chain('update');
  builder.match = chain('match');
  builder.delete = chain('delete');
  builder.single = chain('single');
  builder.maybeSingle = chain('maybeSingle');
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ ...result.value, data: calls.select.at(-1) === 'id' && result.value.data !== null && !result.value.error ? [{ id: 'c1' }] : result.value.data });
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  const invoke = vi.fn(async () => ({
    data: { externalRecordId: 'cu-1', canonical: { id: 'c1', name: 'Example Legal Company', type: 'Client' } },
    error: null,
  }));
  return { from, invoke, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: h.from, functions: { invoke: h.invoke } },
}));


import { repositories } from './index';
import { clearOwnershipCache, setDomainOwnership } from '@/src/lib/adapterSeam/ownershipCache';

beforeEach(() => {
  h.from.mockClear(); h.invoke.mockClear();
  h.calls.update.length = 0; h.calls.insert.length = 0;
  h.result.value = { data: { id: 'c1', name: 'Example Legal Company', type: 'Client' }, error: null };
  clearOwnershipCache();
});

describe('company short-name writes through the public repository', () => {
  it('rejects a short-name save when the company is no longer readable', async () => {
    setDomainOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
    h.result.value = { data: null, error: null };
    await expect(repositories.company.update('c1', { name: 'Example Legal Company', type: 'Client', short_name: 'Example' })).rejects.toMatchObject({ code: '42501' });
    expect(h.calls.update).toEqual([]);
  });

  it('preserves database error codes on a local enhancement rejection', async () => {
    h.result.value = { data: null, error: { message: 'not permitted', code: '42501' } };
    await expect(repositories.company.create({ name: 'Example Legal Company', type: 'Client', short_name: 'Example' })).rejects.toMatchObject({ code: '42501' });
  });

  it('clears the optional short name with a local null write', async () => {
    setDomainOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
    await repositories.company.update('c1', { name: 'Example Legal Company', type: 'Client', short_name: null });
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.calls.update).toEqual([{ short_name: null }]);
  });

  it('short-name enhancement update stays local on an external company', async () => {
    setDomainOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
    await repositories.company.update('c1', { name: 'Example Legal Company', type: 'Client', short_name: 'Example' });
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.calls.update).toEqual([{ short_name: 'Example' }]);
  });

  it('rejects a legal-name change bundled with the enhancement on an external company', async () => {
    setDomainOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
    await expect(repositories.company.update('c1', { name: 'Changed Legal Company', type: 'Client', short_name: 'Example' })).rejects.toMatchObject({ code: '42501' });
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.calls.update).toEqual([]);
  });

  it('external create sends only native fields and saves the short name locally', async () => {
    setDomainOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
    const result = await repositories.company.create({ name: 'Example Legal Company', type: 'Client', short_name: 'Example' });
    const [, body] = h.invoke.mock.calls[0] as unknown as [string, { body: { record: Record<string, unknown> } }];
    expect(body.body.record).not.toHaveProperty('short_name');
    expect(h.calls.update).toEqual([{ short_name: 'Example' }]);
    expect(result.short_name).toBe('Example');
  });

  it('standalone create persists the optional short name alongside the legal name', async () => {
    await repositories.company.create({ name: 'Example Legal Company', type: 'Client', short_name: 'Example' });
    expect(h.calls.insert).toEqual([{ name: 'Example Legal Company', type: 'Client', short_name: 'Example' }]);
  });
});
