/**
 * Odoo partner feed match (#1504 S6-T5, FR-ECA-014/016): a partner the sweep has just mirrored runs through the shared
 * matcher; once the Admin has accepted the party kind, link and bring-in apply without a person and a doubtful pair
 * becomes a review row. Supabase is mocked over fetch; the matcher and the normaliser are the shipped ones.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, rpcCall, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from './testing/edgeTestKit.ts';
import { matchNewPartners } from './odooPartyFeed.ts';
import type { DirectoryRow } from '../../../pmo-portal/src/lib/adapterSeam/odoo/kinds.ts';

const env = installEdgeEnv();
afterAll(() => env.restore());

const ORG = '0d000000-0000-4000-8000-000000000006';
const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });

const partner = (id: number, over: Partial<DirectoryRow> & { attrs?: Record<string, unknown> } = {}): DirectoryRow => ({
  external_id: String(id), code: null, name: `Partner ${id}`, parent_external_id: null, active: true, source_write_date: '2026-11-01 00:00:00',
  ...over, attrs: { vat: null, is_company: true, supplier_rank: 1, customer_rank: 0, ...(over.attrs ?? {}) },
});
const company = (id: string, name: string, tax: string | null = null) => ({ id, name, erp_tax_id: tax });

interface Opts {
  accepted?: boolean; companies?: Array<{ id: string; name: string; erp_tax_id: string | null }>; refs?: string[]; mirrorCompanies?: string[];
  apply?: (c: FetchCall) => Response; review?: (c: FetchCall) => Response;
}
function routes(o: Opts): MockRoute[] {
  return [
    supabaseSelect('erp_connect_census', () => (o.accepted === false ? none() : one({ accepted_at: '2026-11-01T00:00:00Z' }))),
    supabaseSelect('external_master_records', () => jsonResponse((o.mirrorCompanies ?? []).map((name) => ({ name })))),
    supabaseSelect('external_refs', (c) => jsonResponse(c.url.searchParams.has('external_record_id') ? (o.refs ?? []).map((id) => ({ external_record_id: id })) : [])),
    supabaseSelect('companies', () => jsonResponse(o.companies ?? [])),
    supabaseRpc('apply_connect_outcome', o.apply ?? (() => jsonResponse(null))),
    supabaseRpc('record_connect_review', o.review ?? (() => jsonResponse(null))),
  ];
}
async function feed(rows: DirectoryRow[], o: Opts = {}, deadlineAt?: number) {
  const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return await withFetchMock(routes(o), async ({ calls }) => {
    await matchNewPartners(sc, ORG, rows, deadlineAt);
    return { calls, applied: rpcCall(calls, 'apply_connect_outcome').map((c) => c.bodyJson as Record<string, unknown>), reviews: rpcCall(calls, 'record_connect_review').map((c) => c.bodyJson as Record<string, unknown>) };
  });
}

describe('AC-ECA-005 Odoo partner feed', () => {
  it('before the party kind has been accepted once, nothing is written and no PMO company is read', async () => {
    const r = await feed([partner(5)], { accepted: false, companies: [company('c1', 'Partner 5')] });
    assertEquals([r.applied.length, r.reviews.length], [0, 0]);
    assertEquals(r.calls.some((c) => c.url.pathname === '/rest/v1/companies'), false);
  });

  it('a new partner no PMO company matches is brought in, as the vendor it is, for this org and tier only', async () => {
    const r = await feed([partner(5, { attrs: { vat: '01.234' } })]);
    assertEquals(r.applied, [{
      p_org_id: ORG, p_tier: 'odoo', p_kind: 'party', p_outcome: 'bring-in', p_pmo_id: null, p_external_id: 'Vendor:5',
      p_snapshot: { name: 'Partner 5', taxId: '01.234', code: null, role: 'vendor' },
    }]);
  });

  it('a partner that holds both roles is two PMO companies, one per role (FR-ODC-052)', async () => {
    const r = await feed([partner(7, { attrs: { supplier_rank: 2, customer_rank: 1 } })]);
    assertEquals(r.applied.map((a) => [a.p_outcome, a.p_external_id]), [['bring-in', 'Client:7'], ['bring-in', 'Vendor:7']]);
  });

  it('a unique tax id match links the partner to the existing company and says which key decided', async () => {
    const r = await feed([partner(5, { name: 'Acme Trading', attrs: { vat: '01.234' } })], { companies: [company('c1', 'Acme Co', '01234')] });
    assertEquals(r.applied.length, 1);
    assertEquals([r.applied[0].p_outcome, r.applied[0].p_pmo_id, r.applied[0].p_external_id], ['link', 'c1', 'Vendor:5']);
    assertEquals((r.applied[0].p_snapshot as Record<string, unknown>).matchKey, 'tax');
  });

  it('two PMO companies that could be the partner: nothing is applied, one review row names them', async () => {
    const r = await feed([partner(5, { name: 'Acme Co' })], { companies: [company('c1', 'Acme Co'), company('c2', 'ACME co.')] });
    assertEquals(r.applied.length, 0);
    assertEquals(r.reviews.length, 1);
    assertEquals([r.reviews[0].p_org_id, r.reviews[0].p_tier, r.reviews[0].p_kind, r.reviews[0].p_pmo_ids, r.reviews[0].p_external_ids, r.reviews[0].p_reason],
      [ORG, 'odoo', 'party', ['c1', 'c2'], ['Vendor:5'], 'ambiguous']);
  });

  it('a partner that already has a reference is left alone (the overlap read repeats rows)', async () => {
    const r = await feed([partner(5)], { refs: ['Vendor:5'] });
    assertEquals([r.applied.length, r.reviews.length], [0, 0]);
  });

  it('a link the database refuses becomes a review row, never a silent skip', async () => {
    const r = await feed([partner(5, { attrs: { vat: '01.234' } })], {
      companies: [company('c1', 'Acme Co', '01234')], apply: () => jsonResponse('This record is already linked to another ERP record'),
    });
    assertEquals(r.reviews.map((x) => [x.p_pmo_ids, x.p_external_ids]), [[['c1'], ['Vendor:5']]]);
  });

  it('a link refused for any other reason than "already linked" is not dressed up as an ambiguous pair', async () => {
    const r = await feed([partner(5, { attrs: { vat: '01.234' } })], {
      companies: [company('c1', 'Acme Co', '01234')], apply: () => jsonResponse('The ERP record changed since this was proposed'),
    });
    assertEquals(r.reviews.length, 0);
  });

  it('a spent tick deadline stops the matching between chunks: later partners are left for the next setup run', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => partner(i + 1));
    const all = await feed(rows);
    assertEquals(all.applied.length, 250);
    const none = await feed(rows, {}, Date.now() - 1);
    assertEquals(none.applied.length, 0);
    assertEquals(none.calls.some((c) => c.url.pathname === '/rest/v1/companies'), false);
  });

  it('contacts of a partner, partners with no role, archived partners and the database\'s own company are not touched', async () => {
    const r = await feed([
      partner(1, { parent_external_id: '9', attrs: { is_company: false } }),
      partner(2, { attrs: { supplier_rank: 0, customer_rank: 0 } }),
      partner(3, { active: false }),
      partner(4, { name: 'Main Co' }),
    ], { mirrorCompanies: ['Main Co'] });
    assertEquals(r.applied.length, 0);
  });

  it('one writer failing does not stop the next partner and never throws (the page is already committed)', async () => {
    let n = 0;
    const r = await feed([partner(1), partner(2)], { apply: () => (++n === 1 ? jsonResponse({ code: 'XX000', message: 'boom' }, { status: 500 }) : jsonResponse(null)) });
    assertEquals(r.applied.map((a) => a.p_external_id), ['Vendor:1', 'Vendor:2']);
  });
});
