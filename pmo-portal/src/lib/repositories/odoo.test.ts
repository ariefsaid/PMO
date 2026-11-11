import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: Array<[string, ...unknown[]]> = [];
  let result: { data: unknown; error: unknown; count?: number } = { data: [], error: null, count: 0 };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'or', 'is', 'not', 'neq', 'order', 'range', 'limit']) {
    chain[m] = (...a: unknown[]) => { calls.push([m, ...a]); return chain; };
  }
  chain.maybeSingle = async () => result;
  chain.then = (r: (v: unknown) => unknown) => r(result);
  return {
    calls,
    setResult: (r: typeof result) => { result = r; },
    from: vi.fn((t: string) => { calls.push(['from', t]); return chain; }),
    rpc: vi.fn(async (name: string, args: unknown) => { calls.push(['rpc', name, args]); return { error: null }; }),
    invoke: vi.fn(async () => ({ data: { ok: true }, error: null })),
  };
});
// Like the real client, `from` needs its receiver: a detached `supabase.from` call throws before any request is made.
vi.mock('@/src/lib/supabase/client', () => {
  const client = {
    from(this: unknown, table: string) {
      if (this !== client) throw new TypeError("Cannot read properties of undefined (reading 'rest')");
      return h.from(table);
    },
    rpc: h.rpc,
    functions: { invoke: h.invoke },
  };
  return { supabase: client };
});
import { odooRepository } from './odoo';

beforeEach(() => { vi.clearAllMocks(); h.calls.length = 0; });

it('AC-ODC-081 listMasterRecords filters server-side, pages by range and returns the uncapped total', async () => {
  h.setResult({ data: [{ id: 'a' }, { id: 'b' }], error: null, count: 2500 });
  const out = await odooRepository.listMasterRecords({ kind: 'product', search: 'semen', page: 3, pageSize: 50, purpose: 'purchase' });
  expect(h.calls).toContainEqual(['from', 'external_master_records']);
  expect(h.calls).toContainEqual(['select', 'id,external_id,code,name,parent_external_id,active,tombstoned_at,attrs,as_of', { count: 'exact' }]);
  expect(h.calls).toContainEqual(['eq', 'external_tier', 'odoo']);
  expect(h.calls).toContainEqual(['eq', 'kind', 'product']);
  expect(h.calls).toContainEqual(['or', 'name.ilike."%semen%",code.ilike."%semen%"']);
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

it('AC-ODC-081 a search with a comma, parens, quote or wildcard stays one quoted value PostgREST can parse', async () => {
  h.setResult({ data: [], error: null, count: 0 });
  await odooRepository.listMasterRecords({ kind: 'product', search: 'Semen, 50kg)(%_"\\', page: 1, pageSize: 10 });
  const or = h.calls.find((c) => c[0] === 'or')?.[1] as string;
  const v = '"%Semen, 50kg)(\\\\%\\\\_\\"\\\\\\\\%"';
  expect(or).toBe(`name.ilike.${v},code.ilike.${v}`);
});

it('getConnection returns the status, activation and stored connection record for tier odoo', async () => {
  h.setResult({ data: { status: 'active', activated_at: '2026-11-01T00:00:00Z', config: { connection: { state: 'healthy' }, capabilities: { missing: [] } } }, error: null });
  const out = await odooRepository.getConnection();
  expect(h.calls).toContainEqual(['eq', 'external_tier', 'odoo']);
  expect(out).toEqual({ status: 'active', activated: true, connection: { state: 'healthy' }, capabilities: { missing: [] }, config: expect.any(Object) });
});

it('AC-ODC-081 externalIds and warehouseIds scope the read to the rows the page shows', async () => {
  h.setResult({ data: [], error: null, count: 0 });
  await odooRepository.listMasterRecords({ kind: 'uom', page: 1, pageSize: 50, externalIds: ['5', '6'] });
  await odooRepository.listMasterRecords({ kind: 'location', page: 1, pageSize: 1000, warehouseIds: ['10'] });
  expect(h.calls).toContainEqual(['in', 'external_id', ['5', '6']]);
  expect(h.calls).toContainEqual(['in', 'attrs->>warehouse_id', ['10']]);
});

it('getConnection hands the client only the config keys the UI reads', async () => {
  h.setResult({ data: { status: 'active', activated_at: null, config: { database: 'db', odoo_company_name: 'Co', prev_binding: { secret_ref: 'vault-name' }, secret_ref: 'x' } }, error: null });
  expect((await odooRepository.getConnection()).config).toEqual({ database: 'db', odoo_company_name: 'Co' });
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

it('AC-OCI-090 lists unsettled invoice and receipt commands attached to the PMO invoice', async () => {
  h.setResult({ data: [
    { id: 'c1', pmo_record_id: 'si-1', state: 'held', last_error: 'ambiguous', updated_at: '2026-11-03T10:00:00Z', actor_user_id: 'u-1', payload: { erp_doc_kind: 'sales-invoice' } },
    { id: 'c2', pmo_record_id: 'ip-1', state: 'pending', last_error: null, updated_at: '2026-11-03T11:00:00Z', actor_user_id: 'u-2', payload: { erp_doc_kind: 'incoming-payment', salesInvoiceId: 'si-1' } },
  ], error: null });
  const rows = await odooRepository.listRevenueCommands('si-1');
  expect(rows).toEqual([
    { id: 'c2', recordId: 'ip-1', kind: 'incoming-payment', state: 'pending', lastError: null, updatedAt: '2026-11-03T11:00:00Z', actorUserId: 'u-2' },
    { id: 'c1', recordId: 'si-1', kind: 'sales-invoice', state: 'held', lastError: 'ambiguous', updatedAt: '2026-11-03T10:00:00Z', actorUserId: 'u-1' },
  ]);
  expect(h.calls).toContainEqual(['eq', 'domain', 'revenue']);
  expect(h.calls).toContainEqual(['eq', 'external_tier', 'odoo']);
  expect(h.calls).toContainEqual(['eq', 'payload->>salesInvoiceId', 'si-1']);
});

it('AC-OCI-091 reads only credit notes tied to the requested invoice', async () => {
  h.setResult({ data: [{ id: 'cn-1', erp_name: 'CN/2026/2', doc_date: '2026-11-02', currency: 'IDR', grand_total: '-100.00', erp_status: 'Posted', erp_read_at: '2026-11-03T10:00:00Z' }], error: null });
  await expect(odooRepository.listRevenueCreditNotes('si-1')).resolves.toEqual([
    { id: 'cn-1', number: 'CN/2026/2', date: '2026-11-02', currency: 'IDR', amount: -100, status: 'Posted', readAt: '2026-11-03T10:00:00Z' },
  ]);
  expect(h.calls).toContainEqual(['from', 'revenue_erp_mirror']);
  expect(h.calls).toContainEqual(['eq', 'sales_invoice_id', 'si-1']);
  expect(h.calls).toContainEqual(['eq', 'erp_doctype', 'Credit Note']);
});

it('AC-OCI-090 adopts a held invoice using its account.move document number', async () => {
  h.setResult({ data: null, error: null });
  await odooRepository.resolveHeldRevenueCommand({ outboxId: 'c1', kind: 'sales-invoice', resolution: 'adopt', documentNumber: '42' });
  expect(h.calls).toContainEqual(['rpc', 'resolve_held_outbox_command', expect.objectContaining({
    p_outbox_id: 'c1', p_resolution: 'adopt', p_external_record_id: 'account.move:42',
  })]);
});
