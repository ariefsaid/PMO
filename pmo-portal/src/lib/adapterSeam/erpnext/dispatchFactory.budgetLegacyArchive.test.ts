import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory';
import { DOCTYPE_BODIES } from './doctypeBodies';
import { budgetLegacyIdentity } from './budgetAccountIdentity';

/**
 * AC-BUD-122 — an OLDER (year-grained, pre-v16) ERP Budget is cancelled by exact witnessed name.
 *
 * The guardrails this file pins: cancel-only (never a POST, never an amend body), the document's own
 * company/project/fiscal year must equal the bound/expected dimensions, a draft or an unproven shape is
 * refused with zero writes, and a document that already reads docstatus 2 converges without a write.
 */

const VID = '55555555-5555-4555-8555-555555555555';
const JOB = '66666666-6666-4666-8666-666666666666';
const SOURCE = '77777777-7777-4777-8777-777777777777';
const REQUEST = '88888888-8888-4888-8888-888888888888';

interface LegacyDoc {
  name?: string;
  docstatus?: number | string;
  company?: string | null;
  project?: string | null;
  fiscal_year?: string | null;
  from_fiscal_year?: string | null;
  to_fiscal_year?: string | null;
  account?: string | null;
}

function fixture(options: {
  major?: number;
  doc?: LegacyDoc;
  status?: number;
  projectOrg?: string;
  exactRef?: boolean;
  mirrorWitness?: string | null;
  mirrorStartDate?: string | null;
} = {}) {
  const major = options.major ?? 15;
  let status: number | string = options.status ?? options.doc?.docstatus ?? 1;
  const writes: string[] = [];
  const reads: string[] = [];
  const dbReads: string[] = [];
  const doc: LegacyDoc = {
    name: 'OLD-BUD',
    docstatus: status,
    company: 'Test Co',
    project: 'ERP-PROJ',
    ...(major === 15 ? { fiscal_year: '2026' } : { from_fiscal_year: '2026', to_fiscal_year: '2026' }),
    ...options.doc,
  };
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    if (url.hostname === 'db.test') {
      const table = url.pathname.split('/').pop();
      dbReads.push(String(table));
      const rows: Record<string, unknown[]> = {
        external_org_bindings: [{
          site_url: 'https://erp.test',
          version_major: major,
          activated_at: '2026-01-01',
          config: { company: 'Test Co', project_map: { project: 'ERP-PROJ' } },
        }],
        projects: [{ id: 'project', org_id: options.projectOrg ?? 'org' }],
        budget_category_account_map: [],
        external_refs: options.exactRef === false ? [] : [{ org_id: 'org', domain: 'budget', external_tier: 'erpnext', pmo_record_id: identity, external_record_id: 'OLD-BUD' }],
        budget_version_erp_mirror: [{
          id: SOURCE, org_id: 'org', budget_version_id: VID, fiscal_year: '2026',
          push_state: 'pending', erp_budget_name: 'OLD-BUD', erp_docstatus: 1, erp_cancelled_at: null,
          activated_at_witness: options.mirrorWitness ?? '2026-10-15T10:00:00Z', pushed_project_start_date: options.mirrorStartDate ?? '2026-01-01',
          pushed_project_end_date: '2026-12-31',
        }],
        budget_archive_cancel_intents: [{
          id: JOB, org_id: 'org', request_id: REQUEST, project_id: 'project', budget_version_id: VID,
          source_mirror_id: SOURCE, source_kind: 'legacy', actor_user_id: 'actor', state: 'pending',
          fiscal_year: '2026', erp_account: null, erp_budget_name: 'OLD-BUD',
          activated_at_witness: '2026-10-15T10:00:00Z', pushed_project_start_date: '2026-01-01',
          pushed_project_end_date: '2026-12-31',
        }],
        budget_archive_requests: [{
          id: REQUEST, org_id: 'org', project_id: 'project', budget_version_id: VID,
          requested_by: 'actor', cancel_erp: true,
        }],
        budget_version_account_erp_mirror: [],
      };
      if (!(String(table) in rows)) throw new Error(`Unexpected DB request ${url}`);
      return json(rows[String(table)]);
    }
    if (url.hostname !== 'erp.test') throw new Error(`Unexpected request ${url}`);
    if (init?.method === 'PUT') {
      writes.push(`${String(init.body ?? '')}@${decodeURIComponent(url.pathname.split('/').pop()!)}`);
      status = 2;
    } else {
      reads.push(url.pathname);
    }
    if (url.searchParams.has('filters')) throw new Error('a legacy cancellation must not scan the grain');
    return json({ data: { ...doc, docstatus: status } });
  };
  const serviceClient = createClient('https://db.test', 'fixture', {
    global: { fetch: transport },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const identity = budgetLegacyIdentity(VID, '2026');
  const command = {
    domain: 'budget' as const,
    operation: 'create' as const,
    idempotencyKey: `bud15-archive:${identity}:1790000000000`,
    record: {
      id: VID,
      erp_doc_kind: 'budget',
      projectId: 'project',
      fiscal_year: '2026',
      source_kind: 'legacy',
      budget_intent: 'remove',
      budget_predecessor: 'OLD-BUD',
      outbox_identity: identity,
      activated_at: '2026-10-15T10:00:00Z',
      project_start_date: '2026-01-01',
      project_end_date: '2026-12-31',
      budget_archive_cancel_job_id: JOB,
      budget_archive_source_mirror_id: SOURCE,
      line_items: [],
    },
  };
  const run = async () => {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: serviceClient as unknown as DispatchServiceClient,
      orgId: 'org',
      command,
      fetchImpl: transport,
      apiKey: 'fixture',
      apiSecret: 'fixture',
      doctypeBodies: DOCTYPE_BODIES,
    });
    return adapter.commit(command);
  };
  return { run, writes, reads, dbReads };
}

describe('AC-BUD-122 legacy older-push archive cancellation through the shipped factory and adapter', () => {
  it('cancels the exact witnessed v15 document and issues no create or amend', async () => {
    const f = fixture();
    const result = await f.run();
    expect(result.externalRecordId).toBe('OLD-BUD');
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]).toContain('OLD-BUD');
    expect(f.writes[0]).toContain('docstatus');
    expect(f.reads.every((path) => path.endsWith('/OLD-BUD'))).toBe(true);
    expect(f.dbReads).not.toContain('budget_category_account_map');
  });

  it('converges an already-cancelled legacy document without a write', async () => {
    const f = fixture({ status: 2 });
    expect((await f.run()).externalRecordId).toBe('OLD-BUD');
    expect(f.writes).toEqual([]);
  });

  it('refuses a legacy job without its exact org-scoped external reference before reading ERP', async () => {
    const f = fixture({ exactRef: false });
    await expect(f.run()).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(f.reads).toEqual([]);
    expect(f.writes).toEqual([]);
  });

  it('refuses a legacy source whose activation witness changed before reading ERP', async () => {
    const f = fixture({ mirrorWitness: '2026-10-16T10:00:00Z' });
    await expect(f.run()).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(f.reads).toEqual([]);
    expect(f.writes).toEqual([]);
  });

  it('refuses a legacy source whose pushed project date changed before reading ERP', async () => {
    const f = fixture({ mirrorStartDate: '2026-02-01' });
    await expect(f.run()).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(f.reads).toEqual([]);
    expect(f.writes).toEqual([]);
  });

  it.each([
    ['a read naming a different document', { name: 'NEW-BUD' }],
    ['a foreign company', { company: 'Other Co' }],
    ['a different ERP project', { project: 'OTHER-PROJ' }],
    ['a different fiscal year', { fiscal_year: '2027' }],
    ['a conflicting second fiscal-year representation', { from_fiscal_year: '2026', to_fiscal_year: '2027' }],
    ['a document with no company', { company: null }],
    ['a document with no project', { project: null }],
    ['a draft', { docstatus: 0 }],
    ['an unexpected status', { docstatus: 3 }],
    ['an account-grained document', { account: '5100 - Labor - AC' }],
    ['a document carrying even an empty account field', { account: '' }],
  ])('refuses %s with zero writes', async (_label, doc) => {
    const f = fixture({ doc: doc as LegacyDoc });
    await expect(f.run()).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(f.writes).toEqual([]);
  });

  it('refuses a v15 document whose own fiscal year is unavailable', async () => {
    const f = fixture({ doc: { fiscal_year: null } as LegacyDoc });
    await expect(f.run()).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(f.writes).toEqual([]);
  });

  it('holds an upgraded legacy document until the v16 representation has test-bed evidence', async () => {
    const f = fixture({ major: 16 });
    await expect(f.run()).rejects.toMatchObject({ code: 'config-rejected' });
    expect(f.writes).toEqual([]);
    expect(f.reads).toEqual([]);
  });

  it('does not inspect a possibly upgraded legacy document on an unproven v16 installation', async () => {
    const f = fixture({ major: 16, doc: { to_fiscal_year: '2027' } });
    await expect(f.run()).rejects.toMatchObject({ code: 'config-rejected' });
    expect(f.writes).toEqual([]);
    expect(f.reads).toEqual([]);
  });

  it('refuses a project resolved in another organization before reading ERP', async () => {
    const f = fixture({ projectOrg: 'other-org' });
    await expect(f.run()).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
    expect(f.writes).toEqual([]);
    expect(f.reads).toEqual([]);
  });

  it('refuses a legacy cancellation on an unsupported binding version with zero ERP calls', async () => {
    const f = fixture({ major: 17 });
    await expect(f.run()).rejects.toMatchObject({ code: 'config-rejected' });
    expect(f.writes).toEqual([]);
    expect(f.reads).toEqual([]);
  });
});
