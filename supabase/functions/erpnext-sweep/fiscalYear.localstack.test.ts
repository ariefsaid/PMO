/**
 * #1599 ECX-5 Task 8: Localstack integration test for fiscal-year ensure.
 * Uses real Supabase DB (RPCs, outbox, intents, RLS) and fake ERP.
 */
import { afterAll, beforeAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  fakeFiscalYearErp,
  type FakeYear,
} from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fakeFiscalYearErp.ts';

(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { ensureOrgFiscalYearLive } = await import('./index.ts');

const hasEnv = (() => {
  try {
    return Deno.permissions.querySync({ name: 'env', variable: 'PMO_LOCAL_SUPABASE_URL' }).state === 'granted';
  } catch {
    return false;
  }
})();
const apiUrl = hasEnv ? Deno.env.get('PMO_LOCAL_SUPABASE_URL') : undefined;
const serviceKey = hasEnv ? Deno.env.get('PMO_LOCAL_SERVICE_ROLE_KEY') : undefined;
const liveConfigured = Boolean(apiUrl && serviceKey);

const supabase = liveConfigured
  ? createClient(apiUrl!, serviceKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : (null as unknown as ReturnType<typeof createClient>);

const ORG_ID = 'f5030000-0000-0000-0000-000000000001';
const BINDING_ID = 'f5030000-0000-0000-0000-0000000000b1';
const HOST = 'localstack-erp.test';
const COMPANY = 'Local Acme Co';
const DEC_1 = '2026-12-01';

const CAL_2026: FakeYear = {
  name: '2026',
  start: '2026-01-01',
  end: '2026-12-31',
  companies: [COMPANY],
};

describe({
  name: 'fiscalYear localstack',
  ignore: !liveConfigured,
  fn: () => {
  const originalFetch = globalThis.fetch;
  let activeFake: ReturnType<typeof fakeFiscalYearErp> | null = null;

  beforeAll(async () => {
    // Intercept ERP HTTP calls while letting Supabase DB HTTP calls pass through
    globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(input instanceof Request ? input.url : input));
      if (u.host === HOST && activeFake) {
        return activeFake.fetchImpl(input, init);
      }
      return originalFetch(input, init);
    };

    // Clean up any stale fixture rows
    await cleanup();

    // Seed fixture organization and binding
    const { error: orgErr } = await supabase.from('organizations').insert({
      id: ORG_ID,
      name: 'Localstack Fiscal Org',
    });
    if (orgErr && orgErr.code !== '23505') throw orgErr;

    const { error: bindErr } = await supabase.from('external_org_bindings').insert({
      id: BINDING_ID,
      org_id: ORG_ID,
      external_tier: 'erpnext',
      site_url: `https://${HOST}`,
      secret_ref: 'sec_localstack',
      status: 'active',
      config: { company: COMPANY, sibling_key: 'preserved_value' },
      activated_at: '2026-01-01T00:00:00Z',
    });
    if (bindErr) throw bindErr;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await cleanup();
  });

  async function cleanup() {
    await supabase.from('erp_fiscal_year_intents').delete().eq('org_id', ORG_ID);
    await supabase.from('external_command_outbox').delete().eq('org_id', ORG_ID);
    await supabase.from('external_org_bindings').delete().eq('org_id', ORG_ID);
    await supabase.from('organizations').delete().eq('id', ORG_ID);
  }

  it('actual binding sibling config survives and ready create is persisted', async () => {
    activeFake = fakeFiscalYearErp([CAL_2026], { companies: [COMPANY], host: HOST });
    const { data: bindingRow } = await supabase
      .from('external_org_bindings')
      .select('*')
      .eq('id', BINDING_ID)
      .single();

    const orgArg = {
      orgId: ORG_ID,
      bindingId: BINDING_ID,
      siteUrl: `https://${HOST}`,
      activatedAt: '2026-01-01T00:00:00Z',
      company: COMPANY,
      config: bindingRow?.config as Record<string, unknown>,
    };

    const res = await ensureOrgFiscalYearLive(
      supabase,
      orgArg,
      () => Promise.resolve(activeFake!.client),
      DEC_1,
      'full',
    );

    assertEquals(res.error, undefined);
    assertEquals(res.checked, true);

    // Verify DB state
    const { data: freshBinding } = await supabase
      .from('external_org_bindings')
      .select('config')
      .eq('id', BINDING_ID)
      .single();

    const conf = freshBinding?.config as Record<string, unknown>;
    assertEquals(conf.sibling_key, 'preserved_value');
    const fy = conf.fiscal_year as Record<string, unknown>;
    assertEquals(fy.state, 'ready');
    assertEquals(fy.company, COMPANY);
    assertEquals(fy.next, '2027');
  });

  it('concurrent invocations share intent and issue exactly one POST', async () => {
    // Clean intents and outbox to test fresh creation
    await supabase.from('erp_fiscal_year_intents').delete().eq('org_id', ORG_ID);
    await supabase.from('external_command_outbox').delete().eq('org_id', ORG_ID);
    // Reset binding config to avoid skipping due to daily check
    await supabase.from('external_org_bindings').update({
      config: { company: COMPANY, sibling_key: 'preserved_value' },
    }).eq('id', BINDING_ID);

    activeFake = fakeFiscalYearErp([CAL_2026], { companies: [COMPANY], host: HOST });

    const orgArg1 = {
      orgId: ORG_ID,
      bindingId: BINDING_ID,
      siteUrl: `https://${HOST}`,
      activatedAt: '2026-01-01T00:00:00Z',
      company: COMPANY,
      config: { company: COMPANY, sibling_key: 'preserved_value' },
    };
    const orgArg2 = {
      orgId: ORG_ID,
      bindingId: BINDING_ID,
      siteUrl: `https://${HOST}`,
      activatedAt: '2026-01-01T00:00:00Z',
      company: COMPANY,
      config: { company: COMPANY, sibling_key: 'preserved_value' },
    };

    const [res1, res2] = await Promise.all([
      ensureOrgFiscalYearLive(supabase, orgArg1, () => Promise.resolve(activeFake!.client), DEC_1, 'full'),
      ensureOrgFiscalYearLive(supabase, orgArg2, () => Promise.resolve(activeFake!.client), DEC_1, 'full'),
    ]);

    assertEquals(res1.error, undefined);
    assertEquals(res2.error, undefined);
    // Exactly 1 POST made to ERP
    assertEquals(activeFake.writes().length, 1);

    // Exactly 1 intent row in DB
    const { data: intents } = await supabase
      .from('erp_fiscal_year_intents')
      .select('id')
      .eq('org_id', ORG_ID);
    assertEquals(intents?.length, 1);
  });

  it('post timeout results in outbox held and needs-operator status', async () => {
    await supabase.from('erp_fiscal_year_intents').delete().eq('org_id', ORG_ID);
    await supabase.from('external_command_outbox').delete().eq('org_id', ORG_ID);
    await supabase.from('external_org_bindings').update({
      config: { company: COMPANY, sibling_key: 'preserved_value' },
    }).eq('id', BINDING_ID);

    activeFake = fakeFiscalYearErp([CAL_2026], { companies: [COMPANY], host: HOST });
    activeFake.failNextWrite('transport'); // network fails on POST

    const orgArg = {
      orgId: ORG_ID,
      bindingId: BINDING_ID,
      siteUrl: `https://${HOST}`,
      activatedAt: '2026-01-01T00:00:00Z',
      company: COMPANY,
      config: { company: COMPANY, sibling_key: 'preserved_value' },
    };

    const res = await ensureOrgFiscalYearLive(
      supabase,
      orgArg,
      () => Promise.resolve(activeFake!.client),
      DEC_1,
      'full',
    );

    // Network down is reported as retryable error
    assert(res.error !== undefined);

    // Outbox row is held
    const { data: outboxRows } = await supabase
      .from('external_command_outbox')
      .select('state')
      .eq('org_id', ORG_ID)
      .eq('domain', 'fiscal_year_setup');
    assertEquals(outboxRows?.[0]?.state, 'held');

    // Observation recorded as needs-operator held
    const { data: bindingRow } = await supabase
      .from('external_org_bindings')
      .select('config')
      .eq('id', BINDING_ID)
      .single();
    const fy = (bindingRow?.config as Record<string, unknown>).fiscal_year as Record<string, unknown>;
    assertEquals(fy.state, 'needs-operator');
    assertEquals(fy.reason, 'held');
  });

  it('generation loss and changed company do not publish status', async () => {
    const testIntentId = 'f5030000-0000-0000-0000-000000000199';
    const testOutboxId = 'f5030000-0000-0000-0000-000000000299';

    await supabase.from('erp_fiscal_year_intents').delete().eq('org_id', ORG_ID);
    await supabase.from('external_command_outbox').delete().eq('org_id', ORG_ID);

    await supabase.from('erp_fiscal_year_intents').insert({
      id: testIntentId,
      org_id: ORG_ID,
      binding_id: BINDING_ID,
      company: COMPANY,
      site_url: `https://${HOST}`,
      activated_at: '2026-01-01T00:00:00Z',
      start_date: '2027-01-01',
      end_date: '2027-12-31',
      year_name: '2027',
      post_started_at: '2026-12-01T08:00:00Z',
      post_outbox_id: testOutboxId,
      post_generation: 1,
    });

    await supabase.from('external_command_outbox').insert({
      id: testOutboxId,
      org_id: ORG_ID,
      domain: 'fiscal_year_setup',
      pmo_record_id: testIntentId,
      idempotency_key: `setup:fiscal-year:${testIntentId}`,
      external_tier: 'erpnext',
      operation: 'create',
      state: 'committed',
      claim_generation: 1,
    });

    // 1. Generation loss
    const { data: genLossOk } = await supabase.rpc('record_fiscal_year_status', {
      p_org_id: ORG_ID,
      p_binding_id: BINDING_ID,
      p_company: COMPANY,
      p_site_url: `https://${HOST}`,
      p_activated_at: '2026-01-01T00:00:00Z',
      p_intent_id: testIntentId,
      p_outbox_id: testOutboxId,
      p_generation: 999999, // Stale generation
      p_status: { state: 'ready', company: COMPANY },
    });
    assertEquals(genLossOk, false);

    // 2. Changed company
    const { data: wrongCompanyOk } = await supabase.rpc('record_fiscal_year_status', {
      p_org_id: ORG_ID,
      p_binding_id: BINDING_ID,
      p_company: 'Unrelated Changed Co', // Mismatched company
      p_site_url: `https://${HOST}`,
      p_activated_at: '2026-01-01T00:00:00Z',
      p_intent_id: testIntentId,
      p_outbox_id: testOutboxId,
      p_generation: 1,
      p_status: { state: 'ready', company: 'Unrelated Changed Co' },
    });
    assertEquals(wrongCompanyOk, false);
  });
  },
});
