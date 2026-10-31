import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: Array<[string, ...unknown[]]> = [];
  let result: { data: unknown; error: unknown; count?: number } = { data: [], error: null, count: 0 };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'or', 'is', 'not', 'order', 'range', 'limit']) {
    chain[m] = (...a: unknown[]) => { calls.push([m, ...a]); return chain; };
  }
  chain.maybeSingle = async () => result;
  chain.then = (r: (v: unknown) => unknown) => r(result);
  return {
    calls,
    setResult: (r: typeof result) => { result = r; },
    from: vi.fn((t: string) => { calls.push(['from', t]); return chain; }),
    invoke: vi.fn(async () => ({ data: { ok: true }, error: null })),
  };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, functions: { invoke: h.invoke } } }));
import { odooRepository } from './odoo';

beforeEach(() => { vi.clearAllMocks(); h.calls.length = 0; });

it('AC-ODC-081 listMasterRecords filters server-side, pages by range and returns the uncapped total', async () => {
  h.setResult({ data: [{ id: 'a' }, { id: 'b' }], error: null, count: 2500 });
  const out = await odooRepository.listMasterRecords({ kind: 'product', search: 'semen', page: 3, pageSize: 50, purpose: 'purchase' });
  expect(h.calls).toContainEqual(['from', 'external_master_records']);
  expect(h.calls).toContainEqual(['select', 'id,external_id,code,name,parent_external_id,active,tombstoned_at,attrs,as_of', { count: 'exact' }]);
  expect(h.calls).toContainEqual(['eq', 'external_tier', 'odoo']);
  expect(h.calls).toContainEqual(['eq', 'kind', 'product']);
  expect(h.calls).toContainEqual(['or', 'name.ilike.%semen%,code.ilike.%semen%']);
  expect(h.calls).toContainEqual(['eq', 'attrs->>purchasable', 'true']);
  expect(h.calls).toContainEqual(['range', 100, 149]);
  expect(out.total).toBe(2500);
  expect(out.rows).toHaveLength(2);
});

it('AC-ODC-081 a sales picker filters sellable; inactive and tombstoned rows are hidden unless asked for', async () => {
  h.setResult({ data: [], error: null, count: 0 });
  await odooRepository.listMasterRecords({ kind: 'product', page: 1, pageSize: 50, purpose: 'sale' });
  expect(h.calls).toContainEqual(['eq', 'attrs->>sellable', 'true']);
  expect(h.calls).toContainEqual(['eq', 'active', true]);
  expect(h.calls).toContainEqual(['is', 'tombstoned_at', null]);
  h.calls.length = 0;
  await odooRepository.listMasterRecords({ kind: 'uom', page: 1, pageSize: 50, includeInactive: true });
  expect(h.calls.some((c) => c[0] === 'eq' && c[1] === 'active')).toBe(false);
  expect(h.calls.some((c) => c[0] === 'or')).toBe(false);
});

it('AC-ODC-081 a search term cannot inject PostgREST filter syntax', async () => {
  h.setResult({ data: [], error: null, count: 0 });
  await odooRepository.listMasterRecords({ kind: 'product', search: 'a,b)(%', page: 1, pageSize: 10 });
  const or = h.calls.find((c) => c[0] === 'or')?.[1] as string;
  expect(or).toBe('name.ilike.%a\\,b\\)\\(\\%%,code.ilike.%a\\,b\\)\\(\\%%');
});

it('getConnection returns the status, activation and stored connection record for tier odoo', async () => {
  h.setResult({ data: { status: 'active', activated_at: '2026-11-01T00:00:00Z', config: { connection: { state: 'healthy' }, capabilities: { missing: [] } } }, error: null });
  const out = await odooRepository.getConnection();
  expect(h.calls).toContainEqual(['eq', 'external_tier', 'odoo']);
  expect(out).toEqual({ status: 'active', activated: true, connection: { state: 'healthy' }, capabilities: { missing: [] }, config: expect.any(Object) });
});

it('getConnection reports disconnected when there is no binding row', async () => {
  h.setResult({ data: null, error: null });
  expect(await odooRepository.getConnection()).toMatchObject({ status: 'disconnected', activated: false, connection: null, capabilities: null });
});

it('setup sends the verb to external-set-company with tier odoo', async () => {
  await odooRepository.setup('activate', { companyId: 7 });
  expect(h.invoke).toHaveBeenCalledWith('external-set-company', { body: { tier: 'odoo', setupAction: 'activate', companyId: 7 } });
});

it('AC-ODC-081 masterSummary counts inactive and tombstoned rows and reads the newest as_of for the kind', async () => {
  h.setResult({ data: [{ as_of: '2026-11-01T08:00:00Z' }], error: null, count: 4 });
  const out = await odooRepository.masterSummary('product');
  expect(h.calls).toContainEqual(['eq', 'active', false]);
  expect(h.calls).toContainEqual(['not', 'tombstoned_at', 'is', null]);
  expect(h.calls).toContainEqual(['order', 'as_of', { ascending: false }]);
  expect(h.calls.filter((c) => c[0] === 'eq' && c[1] === 'kind' && c[2] === 'product')).toHaveLength(3);
  expect(out).toEqual({ inactive: 4, tombstoned: 4, asOf: '2026-11-01T08:00:00Z' });
});
