/**
 * #762 [Deno] — feed robustness for receipts with tax withheld.
 *
 * A Receive Payment Entry whose withholding PMO cannot confirm (two marked withholding deductions, or a
 * header whose cash amounts differ) is an ERP document a human must reconcile. The poll still imports it
 * — cash only, tax unknown — raises an "Action required" notice, advances its cursor, and keeps syncing
 * the receipts behind it.
 *
 * Drives the LIVE poll (the shipped `sweepOrgDoctypesLive`) with a stubbed `fetch` + a fake Supabase
 * client, like `sweepWedge.test.ts`.
 *
 * Verify: deno test supabase/functions/erpnext-sweep/ --config supabase/functions/erpnext-sweep/deno.json
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { sweepOrgDoctypesLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OURS = 'PMO Smoke Co';
const SECRET_REF = 'wht-bench';

function stubEnv() {
  const original = Deno.env.get;
  const values: Record<string, string> = { WHT_BENCH_KEY: 'k', WHT_BENCH_SECRET: 's' };
  (Deno.env as unknown as { get: (k: string) => string | undefined }).get = (k: string) => values[k];
  return { restore: () => { (Deno.env as unknown as { get: unknown }).get = original; } };
}

const binding = { orgId: ORG, siteUrl: 'https://erp.example.test', secretRef: SECRET_REF, company: OURS,
  config: {}, ownedDomains: ['revenue'], versionMajor: 15 };

interface DbOp { table: string; op: string; payload?: unknown }

/** Records every write; answers `profiles` with one active Finance recipient so a notice can land. */
function fakeDb() {
  const ops: DbOp[] = [];
  const client = {
    from(table: string) {
      const rows = table === 'profiles' ? [{ id: 'finance-1' }] : [];
      const result = { data: rows as unknown[], error: null };
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder, eq: () => builder, in: () => builder, is: () => builder, not: () => builder,
        order: () => builder, contains: () => builder, ilike: () => builder,
        insert: (payload: unknown) => { ops.push({ table, op: 'insert', payload }); return Promise.resolve({ data: null, error: null }); },
        update: (payload: unknown) => { ops.push({ table, op: 'update', payload }); return builder; },
        upsert: (payload: unknown) => {
          ops.push({ table, op: 'upsert', payload });
          const cursor = (payload as { watermark_cursor?: string | null }).watermark_cursor;
          const error = table === 'external_sync_watermarks' && cursor === null
            ? { code: '23502', message: 'null value in column "watermark_cursor" violates not-null constraint' }
            : null;
          return Promise.resolve({ data: null, error });
        },
        limit: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve(result),
      };
      return builder;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { client: client as unknown as SupabaseClient, ops };
}

const listRow = (name: string, modified: string) => ({
  name, modified, docstatus: 1, amended_from: null, company: OURS, payment_type: 'Receive',
  // ERPNext states party_type on every Pay/Receive entry (and the poll requests it); a row without it is not adopted.
  party_type: 'Customer', party: 'ACME', posting_date: '2026-10-01', reference_no: `REF-${name}`, paid_amount: 980, received_amount: 980,
});
const marked = (amount: number, slip: string) => ({ amount, description: `Withholding slip: ${slip}` });
const AMBIGUOUS = { ...listRow('ACC-PAY-0001', '2026-10-01 09:00:00'),
  deductions: [marked(10, 'WHT-A'), marked(10, 'WHT-B')], references: [] };
const LATER = { ...listRow('ACC-PAY-0002', '2026-10-01 10:00:00'), deductions: [marked(20, 'WHT-C')], references: [] };

/** Payment Entry list → both rows; a per-name read → that row's full document (with its deductions). */
function stubErpFetch(fullDocs: Array<Record<string, unknown>>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const [doctype, name] = url.pathname.replace('/api/resource/', '').split('/').map(decodeURIComponent);
    const json = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data }), {
      status: 200, headers: { 'content-type': 'application/json' } }));
    if (doctype !== 'Payment Entry') return json([]);
    if (name) return json(fullDocs.find((d) => d.name === name) ?? {});
    // deno-lint-ignore no-unused-vars
    return json(fullDocs.map(({ deductions, references, ...row }) => row));
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; } };
}

Deno.test('AC-WHT-003: a receipt with unconfirmable withholding still syncs, is flagged, and the receipts behind it sync too', async () => {
  const db = fakeDb();
  const env = stubEnv();
  const erp = stubErpFetch([AMBIGUOUS, LATER]);
  try {
    const result = await sweepOrgDoctypesLive(db.client, binding);
    assert(result.error === undefined, `the Payment Entry poll must not fail: ${result.error}`);

    const advance = db.ops.find((o) => o.table === 'external_sync_watermarks' && o.op === 'upsert'
      && String((o.payload as { domain?: string }).domain).endsWith('Payment Entry')
      && Boolean((o.payload as { watermark_cursor?: string | null }).watermark_cursor));
    assert(!!advance, 'the Payment Entry cursor must advance');
    assert((advance!.payload as { watermark_cursor?: string }).watermark_cursor === '2026-10-01 10:00:00',
      `the cursor must move past both receipts, got ${JSON.stringify(advance!.payload)}`);

    const receipts = db.ops.filter((o) => o.table === 'incoming_payments' && o.op === 'insert')
      .map((o) => o.payload as Record<string, unknown>);
    const flagged = receipts.find((r) => r.ip_number === 'ACC-PAY-0001');
    const later = receipts.find((r) => r.ip_number === 'ACC-PAY-0002');
    assert(!!flagged, 'the receipt with unconfirmable withholding is still imported');
    assert(flagged!.amount === '980.00' && flagged!.withheld_amount === null && flagged!.withholding_slip_number === null,
      `cash only, tax unknown: ${JSON.stringify(flagged)}`);
    assert(!('withholding_review' in flagged!), 'the review marker is never written as a column');
    assert(!!later && later.amount === '1000.00' && later.withheld_amount === '20.00',
      `the later receipt syncs with its confirmed withholding: ${JSON.stringify(later)}`);

    const notices = db.ops.filter((o) => o.table === 'notifications' && o.op === 'insert')
      .flatMap((o) => o.payload as Array<Record<string, unknown>>);
    const notice = notices.find((n) => (n.metadata as Record<string, unknown>)?.action_required === 'receipt-withholding-unconfirmed');
    assert(!!notice, `an Action required notice is raised: ${JSON.stringify(notices)}`);
    assert(notice!.title === 'Action required' && (notice!.metadata as Record<string, unknown>).erpName === 'ACC-PAY-0001',
      `the notice names the receipt: ${JSON.stringify(notice)}`);
    assert(notices.every((n) => (n.metadata as Record<string, unknown>)?.erpName !== 'ACC-PAY-0002'),
      'a confirmed receipt raises no notice');
  } finally {
    erp.restore();
    env.restore();
  }
});
