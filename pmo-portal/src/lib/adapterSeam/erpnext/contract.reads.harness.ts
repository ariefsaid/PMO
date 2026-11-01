/**
 * ERPNext's harness for the read suites (spec §6.2): feeds the SHIPPED mirror and snapshot code a fake ERP and
 * answers in PMO terms. No behaviour lives here.
 */
import { FakePostgrest } from '@/test/postgrestFake.ts';
import type { ActualsLine, ActualsReadScenario, ErpHarness, ErpPurchaseDoc, MirroredPurchase } from '../contractSuite/harness.ts';
import { refreshActuals } from './actualsSnapshot.ts';
import { KIND_DOMAIN, KIND_MIRROR_TABLE, kindFromDoctypeAndPaymentType } from './feedKinds.ts';
import { feedPurchaseMirror } from './purchaseMirrorFeed.ts';

const DOCTYPE: Record<ErpPurchaseDoc['kind'], string> = { 'purchase-order': 'Purchase Order', 'bill': 'Purchase Invoice' };
const KIND_OF: Record<string, MirroredPurchase['kind']> = { 'Purchase Order': 'purchase-order', 'Purchase Invoice': 'bill' };

/** A fake ERPNext listing the given documents per doctype, honouring the feed's modified/name cursor filters. */
function listingFetch(docs: Record<string, Array<Record<string, unknown>>>): typeof fetch {
  return (async (url: string) => {
    const u = new URL(url);
    const doctype = decodeURIComponent(u.pathname.split('/').pop()!);
    const filters = JSON.parse(u.searchParams.get('filters') ?? '[]') as Array<[string, string, unknown]>;
    const selected = (docs[doctype] ?? []).filter((doc) => filters.every(([field, op, value]) => {
      if (field === 'parent' && op === 'in') return (value as string[]).includes(String(doc.parent));
      if (field === 'modified' && op === '=') return doc.modified === value;
      if (field === 'modified' && op === '>') return String(doc.modified) > String(value);
      if (field === 'name' && op === '>') return String(doc.name) > String(value);
      if (field === 'name' && op === '>=') return String(doc.name) >= String(value);
      return true;
    })).sort((a, b) => String(a.modified).localeCompare(String(b.modified)) || String(a.name).localeCompare(String(b.name)));
    const start = Number(u.searchParams.get('limit_start') ?? 0);
    const pageLength = Number(u.searchParams.get('limit_page_length') ?? 500);
    return new Response(JSON.stringify({ data: selected.slice(start, start + pageLength) }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

export async function mirrorPurchases(docs: readonly ErpPurchaseDoc[]): Promise<MirroredPurchase[]> {
  const byDoctype: Record<string, Array<Record<string, unknown>>> = {};
  for (const d of docs) {
    const isBill = d.kind === 'bill';
    (byDoctype[DOCTYPE[d.kind]] ??= []).push({
      name: d.reference, supplier: 'SUP-1', supplier_name: d.supplier, currency: 'IDR', grand_total: d.total, docstatus: 1,
      status: isBill ? 'Unpaid' : 'To Bill', modified: d.modifiedAt, project: null,
      ...(isBill ? { posting_date: '2026-02-01', due_date: '2026-03-01', outstanding_amount: d.total, is_return: 0 } : { transaction_date: '2026-01-05', schedule_date: '2026-01-20' }),
    });
  }
  const fake = new FakePostgrest({ external_sync_watermarks: [] }, { upsertKeys: { external_sync_watermarks: ['org_id', 'external_tier', 'domain'] } });
  const mirrored: unknown[] = [];
  const rpc = async (_name: string, args: { p_rows: unknown[] }) => { mirrored.push(...args.p_rows); return { data: args.p_rows.length, error: null }; };
  const serviceClient = { from: (t: string) => fake.from(t), rpc } as never;
  const client = { fetchImpl: listingFetch(byDoctype), apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', maxRetries: 0 };
  await feedPurchaseMirror(serviceClient, { client, orgId: 'org-1', company: 'Example Co' });
  const rows = mirrored as Array<{ erp_doctype: string; erp_name: string; grand_total: string | null }>;
  return rows.filter((r) => KIND_OF[r.erp_doctype]).map((r) => ({ kind: KIND_OF[r.erp_doctype], reference: r.erp_name, total: r.grand_total }));
}

const PAYMENT_TYPE: Record<Parameters<ErpHarness['classifyPayment']>[0], string | undefined> = {
  received: 'Receive', paid: 'Pay', unrecognised: 'Unknown', blank: '', absent: undefined,
};

export const classifyPayment: ErpHarness['classifyPayment'] = (direction) => {
  const kind = kindFromDoctypeAndPaymentType('Payment Entry', PAYMENT_TYPE[direction]);
  if (kind === 'incoming-payment') return { kind: 'receipt', domain: KIND_DOMAIN[kind] as 'revenue', table: KIND_MIRROR_TABLE[kind] as 'incoming_payments' };
  if (kind === 'payment') return { kind: 'vendor-payment', domain: KIND_DOMAIN[kind] as 'procurement', table: KIND_MIRROR_TABLE[kind] as 'payments' };
  return { kind: 'skipped' };
};

/** Sums the mirrored ledger through the shipped refresh and returns the snapshot it published. */
export async function readActuals({ ledger, projectLinks }: ActualsReadScenario): Promise<ActualsLine[]> {
  const rows = ledger.map((l, i) => ({
    id: `gl-${String(i).padStart(8, '0')}`, org_id: 'org-1', project: l.project, cost_center: l.costCentre ?? null,
    account: l.account, fiscal_year: l.fiscalYear, debit: l.debit, credit: l.credit, is_cancelled: false,
  }));
  const fake = new FakePostgrest({ erp_gl_entry_mirror: rows, erp_actuals_snapshot: [] });
  const client = { from: (table: string) => fake.from(table), rpc: (fn: string, args: Record<string, unknown>) => fake.rpc(fn, args) };
  await refreshActuals(client as never, 'org-1', { projectMap: projectLinks });
  const published = fake.rpcCalls.filter((c) => c.fn === 'replace_erp_snapshot' && c.args.p_table === 'erp_actuals_snapshot');
  return published.flatMap((c) => (c.args.p_rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    pmoProjectId: (r.project_id as string | null) ?? null, costCentre: (r.cost_center as string | null) ?? null,
    account: String(r.account), fiscalYear: String(r.fiscal_year), debit: Number(r.debit), credit: Number(r.credit), net: Number(r.net),
  }));
}
