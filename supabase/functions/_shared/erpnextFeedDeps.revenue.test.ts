// Luna re-audit BLOCKs 6/7/8/13 [Deno unit] — the inbound REVENUE feed's money correctness.
//
//  • BLOCK 8  — an inbound lifecycle change must derive the mirror's `status` through the CANONICAL
//               `deriveSiStatus` (revenue rollups key on `status <> 'Cancelled'`, db/revenue.ts): an SI
//               cancelled in ERP that stays `Unpaid` in PMO keeps contributing to project revenue and
//               open AR — a wrong money figure on screen.
//  • BLOCK 6  — the existing-row update path must repair the FINANCIAL + LINK columns, not only the
//               `erp_*` lifecycle ones; a PE adopted BEFORE its Sales Invoice must self-heal its
//               `sales_invoice_id` on a later tick (and must never be UN-linked by an unresolvable one).
//  • BLOCK 7  — adoption must claim `external_refs` BEFORE minting the mirror (the applyEngine
//               `adoptAtomically` strategy), so a losing concurrent racer leaves NO orphan money row.
//  • BLOCK 13 — a project-less inbound SI must actually SURFACE to Finance (a `notifications` row),
//               not merely carry a comment promising it.
//
// Verify: cd supabase/functions/erpnext-sweep && deno test ../_shared/erpnextFeedDeps.revenue.test.ts

import { createErpFeedDeps } from './erpnextFeedDeps.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

interface Call {
  table: string;
  op: 'insert' | 'update' | 'select';
  payload?: Record<string, unknown> | Array<Record<string, unknown>>;
  eq: Array<[string, unknown]>;
  inFilters: Array<[string, unknown[]]>;
}

/** A chainable fake covering every shape erpnextFeedDeps issues: insert / update.eq… / select.eq….
 *  `single` maps a table → the row a `.maybeSingle()` resolves; `list` maps a table → awaited rows. */
function fakeServiceClient(options: {
  single?: Record<string, Record<string, unknown> | null>;
  list?: Record<string, Array<Record<string, unknown>>>;
  insertError?: Record<string, { message: string; code?: string }>;
} = {}) {
  const calls: Call[] = [];

  function builder(table: string, op: Call['op'], payload?: Call['payload']) {
    const eq: Array<[string, unknown]> = [];
    const inFilters: Array<[string, unknown[]]> = [];
    const record = () => calls.push({ table, op, payload, eq, inFilters });
    const b = {
      eq(col: string, val: unknown) { eq.push([col, val]); return b; },
      in(col: string, vals: unknown[]) { inFilters.push([col, vals]); return b; },
      limit(_n: number) { return b; },
      maybeSingle() {
        record();
        return Promise.resolve({ data: options.single?.[table] ?? null, error: null });
      },
      then(resolve: (v: { data: unknown; error: unknown }) => void) {
        record();
        resolve({ data: options.list?.[table] ?? [], error: options.insertError?.[table] ?? null });
      },
    };
    return b;
  }

  const client = {
    from(table: string) {
      return {
        insert: (payload: Call['payload']) => builder(table, 'insert', payload),
        update: (payload: Record<string, unknown>) => builder(table, 'update', payload),
        select: (_cols: string) => builder(table, 'select'),
      };
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

const findInsert = (calls: Call[], table: string) => calls.find((c) => c.table === table && c.op === 'insert');
const findUpdate = (calls: Call[], table: string) => calls.find((c) => c.table === table && c.op === 'update');

// ── BLOCK 8 ────────────────────────────────────────────────────────────────────────────────────────

Deno.test('BLOCK 8: an inbound SI CANCEL derives status=Cancelled (so the revenue rollup stops counting it)', async () => {
  const { client, calls } = fakeServiceClient();
  const deps = createErpFeedDeps(client, 'org-1', 'sales-invoice');
  await deps.tombstoneMirror('pmo-si-1', '2026-07-18T00:00:00.000Z');

  const patch = findUpdate(calls, 'sales_invoices')?.payload as Record<string, unknown>;
  assert(patch.erp_docstatus === 2, 'expected the tombstone to stamp erp_docstatus=2');
  assert(patch.status === 'Cancelled', `expected the derived status to become 'Cancelled', got ${String(patch.status)}`);
});

Deno.test('BLOCK 8: an inbound SI update derives status through deriveSiStatus (submitted + outstanding 0 ⇒ Paid)', async () => {
  const { client, calls } = fakeServiceClient();
  const deps = createErpFeedDeps(client, 'org-1', 'sales-invoice');
  await deps.updateMirror('pmo-si-1', { id: 'pmo-si-1', erp_docstatus: 1, erp_outstanding_amount: '0.00' }, 1000);

  const patch = findUpdate(calls, 'sales_invoices')?.payload as Record<string, unknown>;
  assert(patch.status === 'Paid', `expected status 'Paid' for a submitted, fully-settled SI, got ${String(patch.status)}`);
});

Deno.test('BLOCK 8: an inbound SI update with outstanding remaining derives Unpaid (never silently Paid)', async () => {
  const { client, calls } = fakeServiceClient();
  const deps = createErpFeedDeps(client, 'org-1', 'sales-invoice');
  await deps.updateMirror('pmo-si-1', { id: 'pmo-si-1', erp_docstatus: 1, erp_outstanding_amount: '125000.00' }, 1000);

  const patch = findUpdate(calls, 'sales_invoices')?.payload as Record<string, unknown>;
  assert(patch.status === 'Unpaid', `expected status 'Unpaid', got ${String(patch.status)}`);
});

Deno.test('BLOCK 8: an inbound Receive-PE cancel drops it out of Paid (a cancelled receipt is not money received)', async () => {
  const { client, calls } = fakeServiceClient({ list: { incoming_payments: [] } });
  const deps = createErpFeedDeps(client, 'org-1', 'incoming-payment');
  await deps.tombstoneMirror('pmo-ip-1', '2026-07-18T00:00:00.000Z');

  const patch = findUpdate(calls, 'incoming_payments')?.payload as Record<string, unknown>;
  assert(patch.status !== 'Paid', `expected a cancelled receipt to leave 'Paid', got ${String(patch.status)}`);
  assert(patch.status === 'Scheduled', `expected 'Scheduled' (the only non-Paid value the check constraint allows), got ${String(patch.status)}`);
});

// ── SHOULD-FIX 2, the IP twin: an Incoming Payment's `status` was ALSO derived unconditionally
// (`deriveIpStatus(null) === 'Scheduled'`), so a partial webhook omitting `docstatus` flipped a
// settled 'Paid' receipt back to 'Scheduled'. Same putIfPresent discipline as the SI path. ──────────
Deno.test('SHOULD-FIX 2 (IP twin): a partial Receive-PE payload with NO docstatus leaves `status` untouched (a Paid receipt never flips to Scheduled)', async () => {
  const { client, calls } = fakeServiceClient();
  const deps = createErpFeedDeps(client, 'org-1', 'incoming-payment');
  // A lifecycle webhook carrying an amount but not the docstatus oracle.
  await deps.updateMirror('pmo-ip-1', { id: 'pmo-ip-1', amount: '250.00' }, 1000);

  const patch = findUpdate(calls, 'incoming_payments')?.payload as Record<string, unknown>;
  assert(!('status' in patch), `expected NO status write without a docstatus, got status=${String(patch.status)}`);
  assert(patch.amount === '250.00', `expected the carried amount to still be repaired, got ${String(patch.amount)}`);
});

Deno.test('SHOULD-FIX 2 (IP twin): a Receive-PE payload that DOES carry docstatus still derives status', async () => {
  const { client, calls } = fakeServiceClient();
  const deps = createErpFeedDeps(client, 'org-1', 'incoming-payment');
  await deps.updateMirror('pmo-ip-1', { id: 'pmo-ip-1', erp_docstatus: 1 }, 1000);

  const patch = findUpdate(calls, 'incoming_payments')?.payload as Record<string, unknown>;
  assert(patch.status === 'Paid', `expected a submitted receipt to derive 'Paid', got ${String(patch.status)}`);
});

// ── Money-safety audit SHOULD-FIX 2: a PARTIAL inbound payload must never re-derive `status` ───────
//
// Every financial column is written through `putIfPresent` (absent ⇒ untouched), but `status` used to
// be assigned UNCONDITIONALLY from `deriveSiStatus(outstanding, docstatus)`. `deriveSiStatus(null, 1)`
// is deliberately 'Unpaid' (null is NOT zero, siStatus.ts) — so a SETTLED invoice (outstanding 0,
// 'Paid') receiving ANY lifecycle webhook that carries `docstatus:1` but no `outstanding_amount`
// flipped back to 'Unpaid' and re-entered `open_ar` at its FULL amount until the next sweep tick.
// Frappe lets the operator pick the webhook's field subset, so the payload genuinely may omit it.

Deno.test('SHOULD-FIX 2: a partial SI payload with NO outstanding_amount leaves `status` untouched (a Paid invoice never flips to Unpaid)', async () => {
  const { client, calls } = fakeServiceClient();
  const deps = createErpFeedDeps(client, 'org-1', 'sales-invoice');
  // A lifecycle-only webhook: docstatus present, the money oracle absent.
  await deps.updateMirror('pmo-si-1', { id: 'pmo-si-1', erp_docstatus: 1 }, 1000);

  const patch = findUpdate(calls, 'sales_invoices')?.payload as Record<string, unknown>;
  assert(
    !('status' in patch),
    `expected NO status write without the outstanding oracle, got status=${String(patch.status)}`,
  );
});

Deno.test('SHOULD-FIX 2: a partial SI payload still repairs the columns it DOES carry', async () => {
  const { client, calls } = fakeServiceClient();
  const deps = createErpFeedDeps(client, 'org-1', 'sales-invoice');
  await deps.updateMirror('pmo-si-1', { id: 'pmo-si-1', erp_docstatus: 1, amount: '500.00' }, 1000);

  const patch = findUpdate(calls, 'sales_invoices')?.payload as Record<string, unknown>;
  assert(patch.amount === '500.00', `expected the carried amount to be repaired, got ${String(patch.amount)}`);
  assert(!('status' in patch), 'expected status to stay untouched when only non-oracle fields arrived');
});

Deno.test('SHOULD-FIX 2: a CANCEL (docstatus 2) still derives status even with no outstanding_amount', async () => {
  const { client, calls } = fakeServiceClient();
  const deps = createErpFeedDeps(client, 'org-1', 'sales-invoice');
  await deps.updateMirror('pmo-si-1', { id: 'pmo-si-1', erp_docstatus: 2 }, 1000);

  const patch = findUpdate(calls, 'sales_invoices')?.payload as Record<string, unknown>;
  assert(patch.status === 'Cancelled', `expected a cancel to derive 'Cancelled', got ${String(patch.status)}`);
});

Deno.test('SHOULD-FIX 2: an explicit outstanding of 0 still derives Paid (the oracle IS carried)', async () => {
  const { client, calls } = fakeServiceClient();
  const deps = createErpFeedDeps(client, 'org-1', 'sales-invoice');
  await deps.updateMirror('pmo-si-1', { id: 'pmo-si-1', erp_docstatus: 1, erp_outstanding_amount: 0 }, 1000);

  const patch = findUpdate(calls, 'sales_invoices')?.payload as Record<string, unknown>;
  assert(patch.status === 'Paid', `expected 'Paid' for an explicit zero outstanding, got ${String(patch.status)}`);
});

// ── BLOCK 6 ────────────────────────────────────────────────────────────────────────────────────────

Deno.test('BLOCK 6: an inbound SI update repairs the FINANCIAL columns (amount/outstanding/date), not just erp_*', async () => {
  const { client, calls } = fakeServiceClient();
  const deps = createErpFeedDeps(client, 'org-1', 'sales-invoice');
  await deps.updateMirror('pmo-si-1', {
    id: 'pmo-si-1',
    amount: '125000.00',
    erp_outstanding_amount: '125000.00',
    invoice_date: '2026-07-01',
    reference_number: 'PO-9',
    erp_docstatus: 1,
  }, 1000);

  const patch = findUpdate(calls, 'sales_invoices')?.payload as Record<string, unknown>;
  assert(patch.amount === '125000.00', `expected the amount to be repaired, got ${String(patch.amount)}`);
  assert(patch.erp_outstanding_amount === '125000.00', 'expected outstanding to be repaired');
  assert(patch.invoice_date === '2026-07-01', 'expected invoice_date to be repaired');
  assert(patch.reference_number === 'PO-9', 'expected reference_number to be repaired');
});

Deno.test('BLOCK 6: an update NEVER clobbers a column the change does not carry (no NULL-ing of live money)', async () => {
  const { client, calls } = fakeServiceClient();
  const deps = createErpFeedDeps(client, 'org-1', 'sales-invoice');
  await deps.updateMirror('pmo-si-1', { id: 'pmo-si-1', erp_docstatus: 1, erp_outstanding_amount: '10.00' }, 1000);

  const patch = findUpdate(calls, 'sales_invoices')?.payload as Record<string, unknown>;
  assert(!('amount' in patch), 'expected an absent amount to be OMITTED from the patch, never written as null');
  assert(!('project_id' in patch), 'expected the PMO-owned project_id to never be touched by the feed');
});

Deno.test('BLOCK 6: a PE adopted BEFORE its SI self-heals its sales_invoice_id once the SI is mapped', async () => {
  const { client, calls } = fakeServiceClient({ single: { external_refs: { pmo_record_id: 'pmo-si-77' } } });
  const deps = createErpFeedDeps(client, 'org-1', 'incoming-payment');
  await deps.updateMirror('pmo-ip-1', {
    id: 'pmo-ip-1',
    erp_docstatus: 1,
    amount: '5000.00',
    references: [{ reference_doctype: 'Sales Invoice', reference_name: 'SINV-0007' }],
  }, 1000);

  const patch = findUpdate(calls, 'incoming_payments')?.payload as Record<string, unknown>;
  assert(patch.sales_invoice_id === 'pmo-si-77', `expected the late link to be repaired, got ${String(patch.sales_invoice_id)}`);
});

Deno.test('BLOCK 6: an unresolvable SI reference never UN-links an already-linked payment', async () => {
  const { client, calls } = fakeServiceClient({ single: { external_refs: null } });
  const deps = createErpFeedDeps(client, 'org-1', 'incoming-payment');
  await deps.updateMirror('pmo-ip-1', {
    id: 'pmo-ip-1',
    erp_docstatus: 1,
    references: [{ reference_doctype: 'Sales Invoice', reference_name: 'SINV-0007' }],
  }, 1000);

  const patch = findUpdate(calls, 'incoming_payments')?.payload as Record<string, unknown>;
  assert(!('sales_invoice_id' in patch), 'expected an unresolved reference to leave sales_invoice_id untouched, not null it');
});

// ── BLOCK 7 ────────────────────────────────────────────────────────────────────────────────────────

Deno.test('BLOCK 7: the revenue feed adopts atomically — the ref is claimed for the id the mirror is then minted with', async () => {
  const { client, calls } = fakeServiceClient();
  const deps = createErpFeedDeps(client, 'org-1', 'sales-invoice');
  assert(!!deps.adoptAtomically, 'expected the ERPNext feed to supply the claim-then-mint adopt strategy');

  const id = deps.adoptAtomically!.newPmoRecordId();
  await deps.adoptAtomically!.mintWithId({ id, si_number: 'SINV-0001', amount: '125000.00', erp_docstatus: 1 }, 1000, id);

  const insert = findInsert(calls, 'sales_invoices')?.payload as Record<string, unknown>;
  assert(insert.id === id, `expected the mirror to be minted with the PRE-CLAIMED id ${id}, got ${String(insert.id)}`);
  assert(insert.amount === '125000.00', 'expected the adopted invoice to carry its amount');
});

Deno.test('BLOCK 7: mirrorExists reports a claimed-but-unminted ref (the repair signal), scoped to the org', async () => {
  const absent = fakeServiceClient({ single: { sales_invoices: null } });
  const depsAbsent = createErpFeedDeps(absent.client, 'org-1', 'sales-invoice');
  assert((await depsAbsent.adoptAtomically!.mirrorExists('pmo-si-1')) === false, 'expected a missing mirror row to report false');
  const probe = absent.calls.find((c) => c.table === 'sales_invoices' && c.op === 'select');
  assert(probe?.eq.some(([c, v]) => c === 'org_id' && v === 'org-1') ?? false, 'expected the existence probe to be org-scoped');

  const present = fakeServiceClient({ single: { sales_invoices: { id: 'pmo-si-1' } } });
  const depsPresent = createErpFeedDeps(present.client, 'org-1', 'sales-invoice');
  assert((await depsPresent.adoptAtomically!.mirrorExists('pmo-si-1')) === true, 'expected an existing mirror row to report true');
});

// ── BLOCK 13 ───────────────────────────────────────────────────────────────────────────────────────

Deno.test('BLOCK 13: a project-less inbound SI raises a Finance notification (the Unassigned bucket is surfaced, not silent)', async () => {
  const { client, calls } = fakeServiceClient({ list: { profiles: [{ id: 'user-fin-1' }, { id: 'user-admin-1' }] } });
  const deps = createErpFeedDeps(client, 'org-1', 'sales-invoice');
  const id = deps.adoptAtomically!.newPmoRecordId();
  await deps.adoptAtomically!.mintWithId({ id, si_number: 'SINV-0001', amount: '125000.00', erp_docstatus: 1 }, 1000, id);

  const recipients = calls.find((c) => c.table === 'profiles' && c.op === 'select');
  assert(!!recipients, 'expected the Finance recipients to be looked up');
  assert(recipients?.eq.some(([c, v]) => c === 'org_id' && v === 'org-1') ?? false, 'expected the recipient lookup to be org-scoped');

  const notify = findInsert(calls, 'notifications');
  assert(!!notify, 'expected a notifications row for a project-less inbound SI');
  const rows = notify!.payload as Array<Record<string, unknown>>;
  assert(Array.isArray(rows) && rows.length === 2, `expected one notification per Finance recipient, got ${JSON.stringify(rows)}`);
  assert(rows.every((r) => r.org_id === 'org-1'), 'expected every notification to be org-stamped');
  assert(rows.some((r) => r.owner_id === 'user-fin-1'), 'expected the Finance user to be notified');
  assert(rows.every((r) => String(r.title).length > 0), 'expected a human title');
  assert(rows.every((r) => (r.metadata as Record<string, unknown>).sales_invoice_id === id), 'expected the notification to point at the adopted invoice');
  assert(rows.every((r) => String(r.body ?? '').includes('SINV-0001')), 'expected the body to name the invoice so it is actionable');
});

Deno.test('BLOCK 13: a failed notification write never loses the adopted invoice (surfacing is best-effort, adoption is not)', async () => {
  const { client, calls } = fakeServiceClient({
    list: { profiles: [{ id: 'user-fin-1' }] },
    insertError: { notifications: { message: 'notifications insert failed', code: 'XX000' } },
  });
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { errors.push(a); };
  try {
    const deps = createErpFeedDeps(client, 'org-1', 'sales-invoice');
    const id = deps.adoptAtomically!.newPmoRecordId();
    await deps.adoptAtomically!.mintWithId({ id, si_number: 'SINV-0001', erp_docstatus: 1 }, 1000, id);
    assert(!!findInsert(calls, 'sales_invoices'), 'expected the invoice itself to still be adopted');
    assert(errors.length === 1, `expected the notification failure to be logged, got ${errors.length} logs`);
  } finally {
    console.error = original;
  }
});
