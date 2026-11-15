// #895 AC-ACD-002 (outbox half), AC-ACD-003: the SHIPPED handler (`./index.ts`) against the LOCAL database with its real grants,
// RPCs and the 0887 gate (real PostgREST and GoTrue; real sign-ins). Only Odoo is fake. An approved journal dispatched twice
// leaves ONE outbox row `accounting` / `journal:<id>` and one Odoo move; a submitted (not yet approved) one leaves none.
//
// Run (one lock hold; the wrapper hands the local keys in, nothing is read from a file):
//   scripts/with-db-lock.sh bash -c 'eval "$(supabase status -o env | grep -E "^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=")" && \
//     PMO_LOCAL_URL=$API_URL PMO_LOCAL_ANON_KEY=$ANON_KEY PMO_LOCAL_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
//     deno test --allow-all --config supabase/functions/adapter-dispatch/deno.json supabase/functions/adapter-dispatch/journalDispatch.served.test.ts'
import { afterAll, beforeAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createFakeOdoo, type FakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';

const LOCAL_URL = Deno.env.get('PMO_LOCAL_URL');
const ANON = Deno.env.get('PMO_LOCAL_ANON_KEY');
const SERVICE = Deno.env.get('PMO_LOCAL_SERVICE_ROLE_KEY');
// Gated on the dependency (the local stack), never on CI, like the other served tests.
const LOCAL = Boolean(LOCAL_URL && ANON && SERVICE);
if (LOCAL) {
  Deno.env.set('SUPABASE_URL', LOCAL_URL!);
  Deno.env.set('SUPABASE_ANON_KEY', ANON!);
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE!);
}

let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
if (LOCAL) await import('./index.ts');

const ORG = '00000000-0000-0000-0000-000000000001';
const FINANCE = '00000000-0000-0000-0000-0000000000a3';   // seed Finance: the maker
const EXEC = '00000000-0000-0000-0000-0000000000a1';      // seed Executive: the second approver
const PASSWORD = 'Passw0rd!dev';
const ODOO_HOST = 'odoo.journal.served.test';
const ODOO_KEY = 'served-key';
const SECRET_REF = 'served-odoo-895';
const ID = (n: number) => `08950000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const APPROVED = ID(1), SUBMITTED = ID(2);
const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

async function psql(sql: string): Promise<string> {
  const out = await new Deno.Command('docker', {
    args: ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
    stdout: 'piped', stderr: 'piped',
  }).output();
  assert(out.success, `psql failed: ${new TextDecoder().decode(out.stderr)}`);
  return new TextDecoder().decode(out.stdout).trim();
}

const cleanup = () => psql(`
  set session_replication_role = replica;
  delete from public.external_command_outbox where org_id='${ORG}' and domain='accounting' and pmo_record_id in ('${APPROVED}','${SUBMITTED}');
  delete from public.external_refs where org_id='${ORG}' and domain='accounting' and pmo_record_id in ('${APPROVED}','${SUBMITTED}');
  -- replica mode skips FK cascades, so the children go first, by name.
  delete from public.journal_entry_lines where journal_id in ('${APPROVED}','${SUBMITTED}');
  delete from public.journal_entry_authors where journal_id in ('${APPROVED}','${SUBMITTED}');
  delete from public.journal_entries where id in ('${APPROVED}','${SUBMITTED}');
  delete from public.external_master_records where org_id='${ORG}' and external_tier='odoo' and kind='account' and external_id in ('601','101');
  delete from public.external_org_bindings where org_id='${ORG}' and external_tier='odoo';
  delete from vault.secrets where name='${SECRET_REF}';`);

async function seed() {
  await cleanup();
  await psql(`
    select vault.create_secret('${ODOO_KEY}', '${SECRET_REF}');
    insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at)
      values ('${ORG}','odoo','https://${ODOO_HOST}','${SECRET_REF}','active','{"database":"db1","odoo_company_id":1,"desk_journal_id":9}',now());
    insert into public.external_master_records (org_id, external_tier, kind, external_id, code, name, active, source_write_date) values
      ('${ORG}','odoo','account','601','6100','Bank charges',true,'2026-11-01 00:00:00'),
      ('${ORG}','odoo','account','101','1100','Bank',true,'2026-11-01 00:00:00');
    insert into public.journal_entries (id, org_id, kind, entry_date, memo, status, maker_id, approver_id, approved_at) values
      ('${APPROVED}','${ORG}','fee','${today}','Served bank fee','approved','${FINANCE}','${EXEC}',now()),
      ('${SUBMITTED}','${ORG}','fee','${today}','Served unapproved fee','submitted','${FINANCE}',null,null);
    insert into public.journal_entry_lines (org_id, journal_id, line_no, account, debit, credit, label)
      select '${ORG}', j, n, a, d, c, 'fee' from (values ('${APPROVED}'::uuid,1,'6100',25000,0),('${APPROVED}'::uuid,2,'1100',0,25000),
        ('${SUBMITTED}'::uuid,1,'6100',5,0),('${SUBMITTED}'::uuid,2,'1100',0,5)) v(j,n,a,d,c);
    insert into public.journal_entry_authors (org_id, journal_id, profile_id) values ('${ORG}','${APPROVED}','${FINANCE}'),('${ORG}','${SUBMITTED}','${FINANCE}');`);
}

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${LOCAL_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON!, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json() as { access_token?: string };
  assert(body.access_token, `sign-in for ${email} failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

/** Odoo is the fake; everything else (PostgREST, GoTrue, JWKS) is the real local stack. The payload carries a forged amount. */
async function dispatch(jwt: string, odoo: FakeOdoo, journalId: string) {
  const realFetch = globalThis.fetch;
  const realResolveDns = Deno.resolveDns;
  Deno.resolveDns = (async () => ['203.0.113.10']) as unknown as typeof Deno.resolveDns;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).host !== ODOO_HOST) return realFetch(request);
    return odoo.fetch(request.url, { method: request.method, headers: { Authorization: String(request.headers.get('authorization')) }, body: await request.text() });
  }) as typeof fetch;
  try {
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'accounting', operation: 'create', idempotencyKey: crypto.randomUUID(),
        record: { id: journalId, erp_doc_kind: 'manual-journal', lines: [{ account: '6100', debit: '1.00', credit: '0.00' }] } }),
    }));
    return { status: res.status, body: JSON.parse(await res.text()) as Record<string, unknown> };
  } finally {
    globalThis.fetch = realFetch;
    Deno.resolveDns = realResolveDns;
  }
}

describe({ name: 'AC-ACD-002 / AC-ACD-003 a manual journal dispatched against the real database', ignore: !LOCAL }, () => {
  let financeJwt = '';
  const odoo = createFakeOdoo({ key: ODOO_KEY, today });
  odoo.seed('res.company', [{ id: 1, name: 'Main Co', currency_id: [5, 'IDR'] }]);
  odoo.seed('account.journal', [{ id: 9, name: 'Miscellaneous', code: 'MISC', type: 'general' }]);
  beforeAll(async () => {
    await seed();
    financeJwt = await signIn('finance@acme.test');
  });
  afterAll(async () => { await cleanup(); });

  it('AC-ACD-002 an approved journal dispatched twice leaves one outbox row accounting/journal:<id> and one posted move', async () => {
    const first = await dispatch(financeJwt, odoo, APPROVED);
    assertEquals(first.status, 200, JSON.stringify(first.body));
    // Once posted, the journal is no longer approved: a second dispatch is refused before any outbox or Odoo call.
    const second = await dispatch(financeJwt, odoo, APPROVED);
    assertEquals([second.status, second.body.message], [403, 'only an approved journal can be posted']);
    assertEquals(await psql(`select count(*)||'/'||min(idempotency_key)||'/'||min(state) from public.external_command_outbox where org_id='${ORG}' and domain='accounting' and pmo_record_id='${APPROVED}'`),
      `1/journal:${APPROVED}/confirmed`);
    assertEquals(odoo.rows('account.move').length, 1, 'one Odoo move');
    assertEquals(await psql(`select status||'/'||posted_date from public.journal_entries where id='${APPROVED}'`), `posted/${today}`);
  });

  it('AC-ACD-003 the body comes from the approved journal, never the payload: the move carries 25000.00, not the forged 1.00', () => {
    const [move] = odoo.rows('account.move') as Array<{ line_ids?: unknown }>;
    const lines = odoo.rows('account.move.line') as Array<{ debit?: number }>;
    assert(move);
    assertEquals(lines.reduce((s, l) => s + Number(l.debit ?? 0), 0), 25000);
  });

  it('AC-ACD-002 a submitted journal (no second approver yet) is refused 403: no outbox row, no Odoo call', async () => {
    const before = odoo.calls.length;
    const r = await dispatch(financeJwt, odoo, SUBMITTED);
    assertEquals(r.status, 403, JSON.stringify(r.body));
    assertEquals(await psql(`select count(*) from public.external_command_outbox where domain='accounting' and pmo_record_id='${SUBMITTED}'`), '0');
    assertEquals(odoo.calls.length, before);
  });
});
