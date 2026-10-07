// AC-EXP-122 [Deno] — the sweep's per-kind poll filters (FR-EXP-113). Payment Entry carries Supplier, Customer AND
// Employee parties; Journal Entry is shared with every native ledger entry. Also pins each kind's watermark key:
// `expense-payment` and `expense-receipt` share one domain AND one doctype, so a `<domain>::<doctype>` cursor
// alone would let one kind's poll advance past the other's unread changes. Pins EVERY kind's key, not just these.
// Verify: cd supabase/functions/erpnext-sweep && deno test expensePollDiscriminators.test.ts --config deno.json --allow-env --allow-net --allow-read

(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { pollFiltersForKind, sweepFieldsForKind, sweepWatermarkDomain } = await import('./index.ts');
import { DOCTYPE_REGISTRY } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';

function assertEquals(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\nexpected ${e}\n     got ${a}`);
}

const CO = 'PMO Smoke Co';
const KEY = 'expj:0b7a8c2e-1111-4222-8333-444455556666:1791367200123';

Deno.test('AC-EXP-122 procurement and revenue Payment Entry polls exclude Employee entries', () => {
  const pay = pollFiltersForKind('payment', CO)!;
  assertEquals(pay.extraFilters, [['payment_type', '=', 'Pay'], ['party_type', '!=', 'Employee'], ['company', '=', CO]]);
  assertEquals(pay.admits({ payment_type: 'Pay', party_type: 'Employee', company: CO }), false);
  assertEquals(pay.admits({ payment_type: 'Pay', party_type: 'Supplier', company: CO }), true);
  assertEquals(pay.admits({ payment_type: 'Receive', party_type: 'Supplier', company: CO }), false);
  const rec = pollFiltersForKind('incoming-payment', CO)!;
  assertEquals(rec.extraFilters, [['payment_type', '=', 'Receive'], ['party_type', '!=', 'Employee'], ['company', '=', CO]]);
  assertEquals(rec.admits({ payment_type: 'Receive', party_type: 'Employee', company: CO }), false);
  assertEquals(rec.admits({ payment_type: 'Receive', party_type: 'Customer', company: CO }), true);
});

Deno.test('AC-EXP-122 expense Payment Entry polls admit only Employee entries in their direction', () => {
  const p = pollFiltersForKind('expense-payment', CO)!;
  assertEquals(p.extraFilters, [['payment_type', '=', 'Pay'], ['party_type', '=', 'Employee'], ['company', '=', CO]]);
  assertEquals(p.admits({ payment_type: 'Pay', party_type: 'Employee', company: CO }), true);
  assertEquals(p.admits({ payment_type: 'Receive', party_type: 'Employee', company: CO }), false);
  assertEquals(p.admits({ payment_type: 'Pay', party_type: 'Supplier', company: CO }), false);
  const r = pollFiltersForKind('expense-receipt', CO)!;
  assertEquals(r.extraFilters, [['payment_type', '=', 'Receive'], ['party_type', '=', 'Employee'], ['company', '=', CO]]);
  assertEquals(r.admits({ payment_type: 'Receive', party_type: 'Employee', company: 'Other Co' }), false);
});

Deno.test('AC-EXP-122 the Journal Entry poll admits only PMO expense keys of this company', () => {
  const j = pollFiltersForKind('expense-journal', CO)!;
  assertEquals(j.extraFilters, [['user_remark', 'like', 'exp%'], ['company', '=', CO]]);
  assertEquals(j.admits({ user_remark: KEY, company: CO }), true);
  assertEquals(j.admits({ user_remark: 'expense reclass', company: CO }), false);
  assertEquals(j.admits({ user_remark: KEY, company: 'Other Co' }), false);
  assertEquals(pollFiltersForKind('expense-journal', null), null);
});

Deno.test('AC-EXP-122 a kind with no discriminator keeps its pre-existing scope (company only)', () => {
  const si = pollFiltersForKind('sales-invoice', CO)!;
  assertEquals(si.extraFilters, [['company', '=', CO]]);
  assertEquals(si.admits({ company: CO }), true);
  const supplier = pollFiltersForKind('supplier', null)!;
  assertEquals(supplier.extraFilters, []);
  assertEquals(supplier.admits({}), true);
});

Deno.test('AC-EXP-122 each poll requests the fields its filters read', () => {
  assertEquals(sweepFieldsForKind('payment').includes('party_type'), true);
  assertEquals(sweepFieldsForKind('incoming-payment').includes('party_type'), true);
  assertEquals(sweepFieldsForKind('expense-payment').includes('party_type'), true);
  assertEquals(sweepFieldsForKind('expense-receipt').includes('payment_type'), true);
  const je = sweepFieldsForKind('expense-journal');
  assertEquals(['user_remark', 'company', 'docstatus', 'modified'].every((f) => je.includes(f)), true, JSON.stringify(je));
});

// Every shipped cursor key, pinned: a stored watermark is looked up by this exact string, so a key that moves resets
// that poll to the beginning (a full re-read) — and a new kind landing on a shared (domain, doctype) would silently
// re-key its neighbour. Adding a kind means adding its line here, deliberately.
const SHIPPED_WATERMARK_KEYS: Record<string, string> = {
  'purchase-request': 'procurement::Material Request',
  rfq: 'procurement::Request for Quotation',
  quotation: 'procurement::Supplier Quotation',
  'purchase-order': 'procurement::Purchase Order',
  'goods-receipt': 'procurement::Purchase Receipt',
  'purchase-invoice': 'procurement::Purchase Invoice',
  payment: 'procurement::Payment Entry',
  supplier: 'companies::Supplier',
  contact: 'companies::Contact',
  customer: 'companies::Customer',
  'sales-invoice': 'revenue::Sales Invoice',
  'incoming-payment': 'revenue::Payment Entry',
  timesheet: 'timesheets::Timesheet',
  employee: 'timesheets::Employee',
  budget: 'budget::Budget',
  'expense-journal': 'expenses::Journal Entry',
  'expense-payment': 'expenses::Payment Entry::expense-payment',
  'expense-receipt': 'expenses::Payment Entry::expense-receipt',
};

Deno.test('AC-EXP-122 every kind keeps its shipped watermark key; the two expense Payment Entry kinds keep separate ones', () => {
  const actual = Object.fromEntries(
    (Object.keys(DOCTYPE_REGISTRY) as Array<keyof typeof DOCTYPE_REGISTRY>).map((kind) => [kind, sweepWatermarkDomain(kind)]),
  );
  assertEquals(Object.keys(actual).sort(), Object.keys(SHIPPED_WATERMARK_KEYS).sort(), 'a kind was added or removed: pin its key');
  for (const [kind, key] of Object.entries(SHIPPED_WATERMARK_KEYS)) assertEquals(actual[kind], key, kind);
});
