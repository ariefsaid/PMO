import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory';
import { DOCTYPE_BODIES } from './doctypeBodies';
import { budgetRangeIdentity } from './budgetAccountIdentity';

const VID = '55555555-5555-4555-8555-555555555555';
const JOB = '66666666-6666-4666-8666-666666666666';
const SOURCE = '77777777-7777-4777-8777-777777777777';
const REQUEST = '88888888-8888-4888-8888-888888888888';
const ORG = '99999999-9999-4999-8999-999999999999';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTIVATED = '2026-10-15T10:00:00.000Z';
const IDENTITY = budgetRangeIdentity(VID, 'FY27', 'FY28', 'Labor');
const PAYLOAD_DIGEST = 'a'.repeat(64);

type Row = Record<string, unknown>;

function fixture(options: {
  orgId?: string;
  actorUserId?: string;
  missingIntent?: boolean;
  job?: Partial<Row>;
  request?: Partial<Row>;
  mirror?: Partial<Row>;
  version?: Partial<Row>;
  record?: Partial<Row>;
} = {}) {
  let status = 1;
  let modified = '2026-10-15 10:00:00.000000';
  const writes: Array<{ method: string; name: string; body: unknown }> = [];
  const erpReads: string[] = [];
  const dbCalls: string[] = [];
  let rangeState: Row | null = null;
  const job: Row = {
    id: JOB, org_id: ORG, request_id: REQUEST, project_id: 'project', budget_version_id: VID,
    source_mirror_id: SOURCE, source_kind: 'account', actor_user_id: ACTOR, state: 'pending',
    fiscal_year: 'FY27', to_fiscal_year: 'FY28', erp_account: 'Labor', erp_budget_name: 'OLD-RANGE',
    erp_modified: '2026-10-15 10:00:00.000000', activated_at_witness: ACTIVATED,
    pushed_project_start_date: '2027-01-01', pushed_project_end_date: '2028-12-31',
    ...options.job,
  };
  const request: Row = {
    id: REQUEST, org_id: ORG, project_id: 'project', budget_version_id: VID,
    requested_by: ACTOR, cancel_erp: true, ...options.request,
  };
  const sourceVersion: Row = {
    project_id: 'project', status: 'Archived', activated_at: ACTIVATED, ...options.version,
  };
  const mirror: Row = {
    id: SOURCE, org_id: ORG, budget_version_id: VID, fiscal_year: 'FY27', to_fiscal_year: 'FY28',
    erp_account: 'Labor', budget_intent: 'remove', push_state: 'pending', erp_budget_name: 'OLD-RANGE',
    erp_docstatus: 1, erp_cancelled_at: null, erp_modified: '2026-10-15 10:00:00.000000',
    activated_at_witness: ACTIVATED, pushed_project_start_date: '2027-01-01', pushed_project_end_date: '2028-12-31',
    budget_versions: sourceVersion, ...options.mirror,
  };
  const tables: Record<string, Row[]> = {
    external_org_bindings: [{ org_id: ORG, site_url: 'https://erp.test', version_major: 16, activated_at: '2026-01-01',
      config: { company: 'Test Co', project_map: { project: 'ERP-PROJ' } } }],
    projects: [{ id: 'project', org_id: ORG }],
    budget_category_account_map: [],
    budget_archive_cancel_intents: options.missingIntent ? [] : [job],
    budget_archive_requests: [request],
    budget_version_account_erp_mirror: [mirror],
    external_refs: [{ org_id: ORG, domain: 'budget', external_tier: 'erpnext', pmo_record_id: IDENTITY, external_record_id: 'OLD-RANGE' }],
  };
  const budget = () => ({
    name: 'OLD-RANGE', owner: 'api-user', modified_by: 'api-user', modified, docstatus: status,
    company: 'Test Co', project: 'ERP-PROJ', budget_against: 'Project', account: 'Labor',
    from_fiscal_year: 'FY27', to_fiscal_year: 'FY28', budget_amount: 500,
    budget_distribution: [
      { start_date: '2027-01-01', end_date: '2027-12-31', amount: 250, percent: 50 },
      { start_date: '2028-01-01', end_date: '2028-12-31', amount: 250, percent: 50 },
    ],
  });
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    if (url.hostname === 'db.test') {
      const body = init?.body ? JSON.parse(String(init.body)) as Row : {};
      const rpcIndex = url.pathname.indexOf('/rpc/');
      if (rpcIndex >= 0) {
        const rpc = url.pathname.slice(rpcIndex + '/rpc/'.length);
        dbCalls.push(`rpc:${rpc}`);
        if (rpc === 'read_budget_range_outbox_state') {
          return json(rangeState && body.p_id === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
            && body.p_generation === 1 && body.p_payload_digest === PAYLOAD_DIGEST && body.p_identity === IDENTITY
            ? rangeState : null);
        }
        if (rpc === 'advance_budget_range_outbox_stage') {
          if (body.p_id !== 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' || body.p_generation !== 1
              || body.p_payload_digest !== PAYLOAD_DIGEST || body.p_identity !== IDENTITY
              || (rangeState?.stage ?? null) !== body.p_expected_stage) return json(false);
          rangeState = body.p_next as Row;
          return json(true);
        }
        return json(null);
      }
      const table = url.pathname.split('/').pop()!;
      dbCalls.push(table);
      return json(tables[table] ?? []);
    }
    if (url.hostname !== 'erp.test') throw new Error(`Unexpected request ${url}`);
    const method = init?.method ?? 'GET';
    const name = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    if (url.pathname === '/api/method/frappe.auth.get_logged_user') return json({ message: 'api-user' });
    if (method === 'PUT') {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      writes.push({ method, name, body });
      status = 2;
      modified = '2026-10-15 10:01:00.000000';
      return json({ data: budget() });
    }
    erpReads.push(name);
    return json({ data: budget() });
  };
  const serviceClient = createClient('https://db.test', 'fixture', {
    global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const command = {
    domain: 'budget' as const,
    operation: 'create' as const,
    idempotencyKey: `bud16-archive:${IDENTITY}:1790000000000`,
    outboxCommit: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', generation: 1, payloadDigest: PAYLOAD_DIGEST, identity: IDENTITY },
    record: {
      id: VID, erp_doc_kind: 'budget', projectId: 'project', fiscal_year: 'FY27', to_fiscal_year: 'FY28',
      budget_mode: 'whole_project', erp_account: 'Labor', budget_intent: 'remove', budget_predecessor: 'OLD-RANGE',
      budget_predecessor_modified: '2026-10-15 10:00:00.000000', outbox_identity: IDENTITY, activated_at: ACTIVATED,
      project_start_date: '2027-01-01', project_end_date: '2028-12-31', line_items: [],
      budget_archive_cancel_job_id: JOB, budget_archive_source_mirror_id: SOURCE,
      ...options.record,
    },
  };
  const run = async () => {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: serviceClient as unknown as DispatchServiceClient,
      orgId: options.orgId ?? ORG,
      actorUserId: options.actorUserId ?? ACTOR,
      command: command as never,
      fetchImpl: transport,
      apiKey: 'fixture', apiSecret: 'fixture', doctypeBodies: DOCTYPE_BODIES,
    });
    return adapter.commit(command as never);
  };
  return { run, command, writes, erpReads, dbCalls, tables, get rangeState() { return rangeState; } };
}

describe('AC-BUD-122 exact pending range archive intent through the shipped factory and adapter', () => {
  it('cancels only the pending remove mirror target and verifies an independent full status-2 readback', async () => {
    const f = fixture();
    const result = await f.run();
    expect(result.externalRecordId).toBe('OLD-RANGE');
    expect(result.canonical).toMatchObject({ erp_budget_name: 'OLD-RANGE', erp_docstatus: 2, to_fiscal_year: 'FY28' });
    expect(f.writes).toEqual([{ method: 'PUT', name: 'OLD-RANGE', body: { docstatus: 2 } }]);
    expect(f.erpReads.filter((name) => name === 'OLD-RANGE')).toHaveLength(4);
    expect(f.rangeState).toMatchObject({ stage: 'cancelled', mode: 'remove', predecessorName: 'OLD-RANGE' });
  });

  it.each([
    ['wrong actor', { actorUserId: 'different-actor' }],
    ['wrong org', { orgId: 'different-org' }],
    ['wrong request actor', { request: { requested_by: 'different-actor' } }],
    ['wrong request identity', { job: { request_id: '99999999-9999-4999-8999-999999999999' } }],
    ['wrong source mirror', { record: { budget_archive_source_mirror_id: '99999999-9999-4999-8999-999999999999' } }],
    ['wrong immutable identity', { record: { outbox_identity: budgetRangeIdentity(VID, 'FY27', 'FY28', 'Travel') } }],
    ['wrong range boundary', { record: { to_fiscal_year: 'FY29' } }],
    ['wrong modified witness', { record: { budget_predecessor_modified: '2026-10-14 10:00:00.000000' } }],
    ['missing intent', { missingIntent: true }],
  ])('refuses %s before any ERP mutation', async (_label, options) => {
    const f = fixture(options as Parameters<typeof fixture>[0]);
    await expect(f.run()).rejects.toMatchObject({ code: expect.any(String) });
    expect(f.writes).toEqual([]);
  });

});
