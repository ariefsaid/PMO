import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory';
import { DOCTYPE_BODIES } from './doctypeBodies';
import { budgetAccountIdentity } from './budgetAccountIdentity';

const VID = '44444444-4444-4444-8444-444444444444';

function fixture(oldStatus = 1, returnedName = 'OLD') {
  let status = oldStatus;
  const writes: string[] = [];
  const reads: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    if (url.hostname === 'db.test') {
      const table = url.pathname.split('/').pop();
      const rows: Record<string, unknown[]> = {
        external_org_bindings: [{ site_url: 'https://erp.test', version_major: 16, activated_at: '2026-01-01', config: { company: 'Test Co', project_map: { project: 'ERP-PROJ' } } }],
        projects: [{ id: 'project', org_id: 'org' }],
        budget_category_account_map: [],
        external_refs: [{ pmo_record_id: budgetAccountIdentity(VID, '2026', 'Salary'), external_record_id: 'NEW' }],
        budget_version_account_erp_mirror: [{ erp_budget_name: 'NEW' }],
      };
      if (!(String(table) in rows)) throw new Error(`Unexpected DB request ${url}`);
      return json(rows[String(table)]);
    }
    if (url.hostname !== 'erp.test') throw new Error(`Unexpected request ${url}`);
    if (init?.method === 'PUT') { writes.push(decodeURIComponent(url.pathname.split('/').pop()!)); status = 2; }
    else reads.push(url.pathname);
    if (url.searchParams.has('filters')) return json({ data: [{ name: 'NEW', docstatus: 1 }] });
    return json({ data: { name: returnedName, docstatus: status, company: 'Test Co', project: 'ERP-PROJ', account: 'Salary', from_fiscal_year: '2026', to_fiscal_year: '2026', budget_amount: 500, modified: '2026-01-01' } });
  };
  const serviceClient = createClient('https://db.test', 'fixture', { global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false } });
  const command = { domain: 'budget' as const, operation: 'create' as const, idempotencyKey: 'archive-fixture', record: {
    id: VID, erp_doc_kind: 'budget', projectId: 'project', fiscal_year: '2026', erp_account: 'Salary',
    budget_intent: 'remove', budget_predecessor: 'OLD', outbox_identity: budgetAccountIdentity(VID, '2026', 'Salary'), line_items: [],
  } };
  const run = async () => {
    const adapter = await resolveErpDispatchAdapter({ serviceClient: serviceClient as unknown as DispatchServiceClient, orgId: 'org', command, fetchImpl: transport, apiKey: 'fixture', apiSecret: 'fixture', doctypeBodies: DOCTYPE_BODIES });
    return adapter.commit(command);
  };
  return { run, writes, reads };
}

describe('AC-BUD-122 exact archive predecessor through shipped factory and adapter', () => {
  it('cancels OLD only while the same grain contains NEW', async () => {
    const f = fixture();
    expect((await f.run()).externalRecordId).toBe('OLD');
    expect(f.writes).toEqual(['OLD']);
    expect(f.reads.every((path) => path.endsWith('/OLD'))).toBe(true);
  });

  it('converges an already-cancelled OLD without touching NEW', async () => {
    const f = fixture(2);
    expect((await f.run()).externalRecordId).toBe('OLD');
    expect(f.writes).toEqual([]);
  });

  it('rejects a read response naming a different document before cancellation', async () => {
    const f = fixture(1, 'NEW');
    await expect(f.run()).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(f.writes).toEqual([]);
  });
});
