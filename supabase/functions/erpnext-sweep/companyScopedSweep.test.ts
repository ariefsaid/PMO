/**
 * WIRE 3 / round-7 B4 [Deno] — the SWEEP must be scoped to the binding's ERP Company. CROSS-TENANT.
 *
 * An ERPNext site routinely hosts several `Company` records. The binding names exactly ONE
 * (`external_org_bindings.config.company`). The webhook already gates inbound events on it
 * (`companyScope.admitsDocForBindingCompany`); the SWEEP did not — its document filters carried only
 * `modified` and `payment_type` — so Company B's Sales Invoices and Receive Payment Entries were polled
 * and adopted into Company A's PMO tenant, appearing in their revenue/AR views with no error at all.
 *
 * These tests drive the LIVE poll (`sweepOrgDoctypesLive`) with a stubbed `fetch` + a fake Supabase
 * client, and assert BOTH halves of the rule where they actually run:
 *   • the server-side filter — the `company` conjunct really appears in the Frappe list query, and
 *   • the per-document gate — a foreign-company document that comes back anyway (a mis-filtering or
 *     compromised ERP) never enters the apply path. The server filter is the optimization; the per-doc
 *     gate is the authority.
 *
 * "Entered the apply path" is observed as the apply's FIRST database read (`external_ref_lineage`, the
 * superseded-name check inside `applyErpFeedEvent`): a document that is filtered out never gets there.
 *
 * Verify: deno test supabase/functions/erpnext-sweep/ --config supabase/functions/erpnext-sweep/deno.json
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { sweepOrgDoctypesLive, sweepFieldsForKind } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OURS = 'PMO Smoke Co';
const THEIRS = 'Other Tenant Ltd';
const SECRET_REF = 'wire3-bench';

/** Answers the binding's credential lookup without touching (or needing permission for) the real
 *  environment: `resolveErpCredentials` reads `<PREFIX>_KEY`/`<PREFIX>_SECRET` through `Deno.env.get`. */
function stubEnv() {
  const original = Deno.env.get;
  const values: Record<string, string> = { WIRE3_BENCH_KEY: 'k', WIRE3_BENCH_SECRET: 's' };
  (Deno.env as unknown as { get: (k: string) => string | undefined }).get = (k: string) => values[k];
  return { restore: () => { (Deno.env as unknown as { get: unknown }).get = original; } };
}

function orgBinding(company: string, ownedDomains: string[] = ['revenue']) {
  return {
    orgId: ORG,
    siteUrl: 'https://erp.example.test',
    secretRef: SECRET_REF,
    company,
    config: {},
    ownedDomains,
    versionMajor: 15,
  };
}

/** A Supabase stand-in that RECORDS every table it is asked for. The sweep only needs the watermark
 *  read/upsert and the in-flight-anchor probe here; the apply path's first read is the oracle. */
function fakeDb() {
  const tables: string[] = [];
  const empty = { data: [] as unknown[], error: null };
  const client = {
    from(table: string) {
      tables.push(table);
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        is: () => builder,
        not: () => builder,
        insert: () => builder,
        update: () => builder,
        upsert: () => builder,
        limit: () => Promise.resolve(empty),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve(empty),
      };
      return builder;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { client: client as unknown as SupabaseClient, tables };
}

/** Stubs global fetch, serving one page of `docsByDoctype` per list request and recording every URL. */
function stubErpFetch(docsByDoctype: Record<string, Array<Record<string, unknown>>>) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(url);
    const doctype = decodeURIComponent(url.split('/api/resource/')[1]?.split('?')[0] ?? '');
    const data = docsByDoctype[doctype] ?? [];
    return Promise.resolve(
      new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  }) as typeof fetch;
  return {
    urls,
    /** The decoded `filters=` JSON of the list request for one doctype. */
    filtersFor(doctype: string): string {
      const url = urls.find((u) => u.includes(`/api/resource/${encodeURIComponent(doctype)}?`)) ?? '';
      const raw = new URL(url).searchParams.get('filters') ?? '';
      return raw;
    },
    restore: () => { globalThis.fetch = original; },
  };
}

const salesInvoice = (name: string, company: string) => ({
  name, company, modified: '2026-07-20 10:00:00', docstatus: 1, amended_from: null,
  customer: 'ACME', posting_date: '2026-07-20', grand_total: '100.00', outstanding_amount: '100.00',
  remarks: 'native invoice',
});

Deno.test("WIRE 3: the poll FETCHES the doc's `company` (without it the per-doc gate is blind and adopts nothing)", () => {
  for (const kind of ['sales-invoice', 'incoming-payment', 'purchase-invoice', 'payment', 'purchase-order'] as const) {
    assert(sweepFieldsForKind(kind).includes('company'), `${kind}'s poll must request the company field`);
  }
  // A GLOBAL master has no company column — requesting one would make Frappe reject the whole list query.
  assert(!sweepFieldsForKind('supplier').includes('company'), 'Supplier is a site-wide master (no company field)');
  assert(!sweepFieldsForKind('customer').includes('company'), 'Customer is a site-wide master (no company field)');
});

Deno.test('WIRE 3: the list query is scoped SERVER-SIDE to the binding company', async () => {
  const db = fakeDb();
  const env = stubEnv();
  const erp = stubErpFetch({ 'Sales Invoice': [], 'Payment Entry': [] });
  try {
    await sweepOrgDoctypesLive(db.client, orgBinding(OURS));
    const filters = erp.filtersFor('Sales Invoice');
    assert(
      filters.includes(JSON.stringify(['company', '=', OURS])),
      `the Sales Invoice poll must carry the company conjunct — got filters=${filters}`,
    );
    assert(
      erp.filtersFor('Payment Entry').includes(JSON.stringify(['company', '=', OURS])),
      'the Payment Entry poll must carry it too (alongside the payment_type discriminator)',
    );
    assert(erp.filtersFor('Payment Entry').includes('payment_type'), 'the existing payment_type discriminator must survive');
  } finally {
    erp.restore();
    env.restore();
  }
});

Deno.test("WIRE 3: a Company-B document returned ANYWAY is never adopted (the per-doc gate is the authority)", async () => {
  const db = fakeDb();
  // The ERP ignores the server-side filter (a mis-filtering site, a compromised bench): it returns the
  // other tenant's invoice. Nothing about it may reach the apply path.
  const env = stubEnv();
  const erp = stubErpFetch({ 'Sales Invoice': [salesInvoice('ACC-SINV-B-1', THEIRS)], 'Payment Entry': [] });
  try {
    const result = await sweepOrgDoctypesLive(db.client, orgBinding(OURS));
    assert(result.error === undefined, `the sweep must not error, just skip: ${result.error}`);
    assert(result.applied === 0, "another tenant's invoice must never be applied");
    assert(
      !db.tables.includes('external_ref_lineage') && !db.tables.includes('external_refs'),
      `a foreign-company document must not even enter the apply path — tables touched: ${db.tables.join(',')}`,
    );
  } finally {
    erp.restore();
    env.restore();
  }
});

Deno.test('WIRE 3: OUR company\'s document still flows through (the gate scopes, it does not block)', async () => {
  const db = fakeDb();
  const env = stubEnv();
  const erp = stubErpFetch({ 'Sales Invoice': [salesInvoice('ACC-SINV-A-1', OURS)], 'Payment Entry': [] });
  try {
    await sweepOrgDoctypesLive(db.client, orgBinding(OURS));
    assert(
      db.tables.includes('external_ref_lineage') || db.tables.includes('external_refs'),
      `our own company's invoice must reach the apply path — tables touched: ${db.tables.join(',')}`,
    );
  } finally {
    erp.restore();
    env.restore();
  }
});

Deno.test('WIRE 3: a document that STATES NO company is refused (fail closed)', async () => {
  const db = fakeDb();
  const { company: _c, ...noCompany } = salesInvoice('ACC-SINV-?-1', OURS);
  const env = stubEnv();
  const erp = stubErpFetch({ 'Sales Invoice': [noCompany], 'Payment Entry': [] });
  try {
    const result = await sweepOrgDoctypesLive(db.client, orgBinding(OURS));
    assert(result.applied === 0, 'an ERP that will not say whose money this is cannot be trusted to have meant ours');
    assert(!db.tables.includes('external_ref_lineage'), 'it must not enter the apply path');
  } finally {
    erp.restore();
    env.restore();
  }
});

Deno.test('WIRE 3: an UNSCOPEABLE binding (no configured company) SKIPS the company-scoped kinds entirely', async () => {
  const db = fakeDb();
  const env = stubEnv();
  const erp = stubErpFetch({ 'Sales Invoice': [salesInvoice('ACC-SINV-A-1', OURS)], 'Payment Entry': [] });
  try {
    const result = await sweepOrgDoctypesLive(db.client, orgBinding(''));
    assert(erp.urls.length === 0, `an unscopeable binding must issue NO list query at all — got ${erp.urls.join(' ')}`);
    assert(result.applied === 0, 'nothing may be adopted by a binding that scopes nothing');
    assert(result.error === undefined, 'a misconfigured binding is a logged config error, not a sweep failure');
  } finally {
    erp.restore();
    env.restore();
  }
});

Deno.test('WIRE 3: the GLOBAL masters (Supplier/Customer) are deliberately exempt — still swept, unfiltered', async () => {
  const db = fakeDb();
  const env = stubEnv();
  const erp = stubErpFetch({ Supplier: [], Customer: [] });
  try {
    // A companies-only org with NO configured company: the masters have no company dimension to scope by.
    await sweepOrgDoctypesLive(db.client, orgBinding('', ['companies']));
    assert(erp.urls.some((u) => u.includes('/api/resource/Supplier')), 'Supplier must still be polled');
    assert(erp.urls.some((u) => u.includes('/api/resource/Customer')), 'Customer must still be polled');
    assert(!erp.filtersFor('Supplier').includes('company'), 'a site-wide master carries no company filter');
  } finally {
    erp.restore();
    env.restore();
  }
});
