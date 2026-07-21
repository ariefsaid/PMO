// Luna BLOCK A4 [Deno unit] — erpnextFeedDeps.createErpFeedDeps's `tombstoneMirror` (the LineageDeps
// cancel path applyFeed.applyCancel drives on an inbound SI docstatus:2 event). ERPNext auto-unlinks
// any Receive Payment Entry's `references` when the Sales Invoice it cites is cancelled — PMO's
// `incoming_payments.sales_invoice_id` goes stale unless the feed reconciles it too (AC-SAR-022).
// `reconcileSiCancelAutoUnlink` (transitionPolicy.ts) is the EXISTING pure helper for this — proven here
// wired into the feed side (the outbound/dispatch side is owned by the other agent).
//
// Verify: cd supabase/functions/erpnext-sweep && deno test ../_shared/erpnextFeedDeps.test.ts

import { createErpFeedDeps } from './erpnextFeedDeps.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

interface Call {
  table: string;
  op: 'update' | 'select';
  patch?: Record<string, unknown>;
  eq: Array<[string, unknown]>;
}

/** A minimal chainable fake matching exactly the `.from(table).update(patch).eq(a,b).eq(c,d)` /
 *  `.from(table).select(cols).eq(a,b).eq(c,d)` shapes `erpnextFeedDeps.ts` issues — both directly
 *  `await`-ed (no `.maybeSingle()`), so each builder is itself a thenable. */
function fakeServiceClient(selectResults: Record<string, Array<Record<string, unknown>>>) {
  const calls: Call[] = [];

  function makeUpdateBuilder(table: string, patch: Record<string, unknown>) {
    const eq: Array<[string, unknown]> = [];
    const builder = {
      eq(col: string, val: unknown) {
        eq.push([col, val]);
        return builder;
      },
      then(resolve: (v: { error: null }) => void) {
        calls.push({ table, op: 'update', patch, eq });
        resolve({ error: null });
      },
    };
    return builder;
  }

  function makeSelectBuilder(table: string) {
    const eq: Array<[string, unknown]> = [];
    const builder = {
      eq(col: string, val: unknown) {
        eq.push([col, val]);
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve: (v: { data: Array<Record<string, unknown>>; error: null }) => void) {
        calls.push({ table, op: 'select', eq });
        resolve({ data: selectResults[table] ?? [], error: null });
      },
    };
    return builder;
  }

  const client = {
    from(table: string) {
      return {
        update: (patch: Record<string, unknown>) => makeUpdateBuilder(table, patch),
        select: (_cols: string) => makeSelectBuilder(table),
      };
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

Deno.test('Luna BLOCK A4: an SI cancel with a referencing Receive PE unlinks its sales_invoice_id (reconcileSiCancelAutoUnlink wired feed-side)', async () => {
  const { client, calls } = fakeServiceClient({
    incoming_payments: [{ id: 'pmo-ip-1' }],
  });
  const deps = createErpFeedDeps(client, 'org-1', 'sales-invoice');
  await deps.tombstoneMirror('pmo-si-1', '2026-07-17T00:00:00.000Z');

  const siUpdate = calls.find((c) => c.table === 'sales_invoices' && c.op === 'update');
  assert(!!siUpdate, 'expected the SI mirror row itself to be tombstoned');
  assert(siUpdate?.patch?.erp_docstatus === 2, 'expected the SI tombstone patch to carry erp_docstatus=2');

  const referencingLookup = calls.find((c) => c.table === 'incoming_payments' && c.op === 'select');
  assert(!!referencingLookup, 'expected a lookup for incoming_payments rows referencing the cancelled SI');
  assert(
    referencingLookup?.eq.some(([col, val]) => col === 'sales_invoice_id' && val === 'pmo-si-1') ?? false,
    'expected the lookup to filter on sales_invoice_id = the cancelled SI pmo id',
  );

  const unlink = calls.find((c) => c.table === 'incoming_payments' && c.op === 'update');
  assert(!!unlink, 'expected the referencing incoming_payments row to be updated (unlinked)');
  assert(unlink?.patch?.sales_invoice_id === null, 'expected sales_invoice_id to be nulled (reconcileSiCancelAutoUnlink patch)');
  assert(
    unlink?.eq.some(([col, val]) => col === 'id' && val === 'pmo-ip-1') ?? false,
    'expected the unlink to target the exact referencing incoming_payments row',
  );
});

Deno.test('Luna BLOCK A4: an SI cancel with NO referencing Receive PE performs no unlink write (nothing to reconcile)', async () => {
  const { client, calls } = fakeServiceClient({ incoming_payments: [] });
  const deps = createErpFeedDeps(client, 'org-1', 'sales-invoice');
  await deps.tombstoneMirror('pmo-si-2', '2026-07-17T00:00:00.000Z');

  const unlink = calls.find((c) => c.table === 'incoming_payments' && c.op === 'update');
  assert(!unlink, 'expected NO incoming_payments update when no row references the cancelled SI');
});

Deno.test('Luna BLOCK A4: a non-SI kind (e.g. purchase-invoice) tombstones its own mirror only — no incoming_payments lookup at all (scoped to the AR SI cancel case)', async () => {
  const { client, calls } = fakeServiceClient({});
  const deps = createErpFeedDeps(client, 'org-1', 'purchase-invoice');
  await deps.tombstoneMirror('pmo-pi-1', '2026-07-17T00:00:00.000Z');

  const lookup = calls.find((c) => c.table === 'incoming_payments');
  assert(!lookup, 'expected no incoming_payments touch for a non-SI kind cancel');
  const piUpdate = calls.find((c) => c.table === 'procurement_invoices' && c.op === 'update');
  assert(!!piUpdate, 'expected the PI mirror row itself to be tombstoned as before');
});
