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

interface QueryShape {
  eq: Array<[string, unknown]>;
  ilike?: [string, string];
  in?: [string, unknown[]];
}

interface Call extends QueryShape {
  table: string;
  op: 'update' | 'select' | 'insert';
  patch?: Record<string, unknown>;
}

/** Either the ORIGINAL plain `{table: rows}` fixture map (every existing test in this file), or a
 *  function for finer per-query control (needed once two different SELECTs hit the same table with
 *  different filters — e.g. the Employee link's work-email probe vs the action-required recipient
 *  lookup both read `profiles`). */
type SelectResults = Record<string, Array<Record<string, unknown>>>;
type SelectFn = (table: string, query: QueryShape) => Array<Record<string, unknown>>;

/** A chainable fake matching exactly the `.from(table).update(patch).eq(a,b)…` /
 *  `.from(table).select(cols).eq(a,b)…[.ilike()/.in()][.maybeSingle()]` /
 *  `.from(table).insert(payload)` shapes `erpnextFeedDeps.ts` issues. A bare `await` on the builder
 *  (no `.maybeSingle()`) resolves the array form; `.maybeSingle()` resolves the single-row form. */
function fakeServiceClient(selectResults: SelectResults | SelectFn) {
  const calls: Call[] = [];
  const resolveRows: SelectFn = typeof selectResults === 'function'
    ? selectResults
    : (table) => selectResults[table] ?? [];

  function makeBuilder(table: string, op: Call['op'], patch?: Record<string, unknown>) {
    const eq: Array<[string, unknown]> = [];
    let ilikeVal: [string, string] | undefined;
    let inVal: [string, unknown[]] | undefined;
    const builder = {
      eq(col: string, val: unknown) {
        eq.push([col, val]);
        return builder;
      },
      ilike(col: string, val: string) {
        ilikeVal = [col, val];
        return builder;
      },
      in(col: string, vals: unknown[]) {
        inVal = [col, vals];
        return builder;
      },
      maybeSingle() {
        calls.push({ table, op, patch, eq, ilike: ilikeVal, in: inVal });
        const rows = op === 'select' ? resolveRows(table, { eq, ilike: ilikeVal, in: inVal }) : [];
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(resolve: (v: { data: Array<Record<string, unknown>>; error: null }) => void) {
        calls.push({ table, op, patch, eq, ilike: ilikeVal, in: inVal });
        const rows = op === 'select' ? resolveRows(table, { eq, ilike: ilikeVal, in: inVal }) : [];
        resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  const client = {
    from(table: string) {
      return {
        update: (patch: Record<string, unknown>) => makeBuilder(table, 'update', patch),
        select: (_cols: string) => makeBuilder(table, 'select'),
        insert: (payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
          calls.push({ table, op: 'insert', patch: Array.isArray(payload) ? { rows: payload } : payload, eq: [] });
          return Promise.resolve({ data: null, error: null });
        },
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

// ── P3b Slice 3 — the Employee adopt (AC-TSP-090/091/092, task 3.5/3.6) ───────────────────────────

Deno.test('AC-TSP-090 an inbound Employee with no mapping mints ONE erp_employees row with the FULL canonical + a non-null erp_modified, link_state unlinked (never auto-confirmed)', async () => {
  const { client, calls } = fakeServiceClient({ profiles: [{ id: 'profile-1' }] }); // unique work-email match
  const deps = createErpFeedDeps(client, 'org-1', 'employee');
  await deps.mintMirror(
    {
      id: 'HR-EMP-00001',
      employee_number: 'HR-EMP-00001',
      employee_name: 'Spike Employee',
      work_email: 'spike@example.com',
      erp_user_id: 'Administrator',
      erp_status: 'Active',
      erp_docstatus: 0,
    },
    Date.parse('2026-07-20T09:00:00.000Z'),
  );

  const insert = calls.find((c) => c.table === 'erp_employees' && c.op === 'insert');
  assert(!!insert, 'expected ONE erp_employees insert');
  assert(insert!.patch!.employee_number === 'HR-EMP-00001', 'expected the FULL canonical employee_number mirrored');
  assert(insert!.patch!.employee_name === 'Spike Employee', 'expected employee_name mirrored');
  assert(insert!.patch!.work_email === 'spike@example.com', 'expected work_email mirrored');
  assert(insert!.patch!.erp_user_id === 'Administrator', 'expected erp_user_id mirrored');
  assert(insert!.patch!.erp_status === 'Active', 'expected erp_status mirrored');
  assert(insert!.patch!.link_state === 'unlinked', 'AC-TSP-092: link_state must default unlinked at mint — NEVER auto-confirmed');
  assert(typeof insert!.patch!.erp_modified === 'string' && insert!.patch!.erp_modified !== '', 'the 0103 lesson: erp_modified must be a real stamp, never absent/null');
});

Deno.test('AC-TSP-090 the Employee adopt NEVER writes a `profiles` row (FR-TSP-093: an ERP Employee never becomes a PMO identity)', async () => {
  const { client, calls } = fakeServiceClient({ profiles: [{ id: 'profile-1' }] });
  const deps = createErpFeedDeps(client, 'org-1', 'employee');
  await deps.mintMirror(
    { id: 'HR-EMP-00002', employee_number: 'HR-EMP-00002', work_email: 'x@example.com' },
    Date.parse('2026-07-20T09:00:00.000Z'),
  );
  const profilesWrite = calls.find((c) => c.table === 'profiles' && (c.op === 'insert' || c.op === 'update'));
  assert(!profilesWrite, 'expected NO insert/update to profiles — profile_id LINKS an existing user, never creates one');
});

Deno.test('AC-TSP-091/092 OQ-TSP-10(C): a UNIQUE work-email match PROPOSES the link (link_state=proposed), never confirms it', async () => {
  const { client, calls } = fakeServiceClient({ profiles: [{ id: 'profile-42' }] });
  const deps = createErpFeedDeps(client, 'org-1', 'employee');
  await deps.mintMirror(
    { id: 'HR-EMP-00003', employee_number: 'HR-EMP-00003', work_email: 'unique@example.com' },
    Date.parse('2026-07-20T09:00:00.000Z'),
  );
  const linkUpdate = calls.find((c) => c.table === 'erp_employees' && c.op === 'update');
  assert(!!linkUpdate, 'expected an erp_employees UPDATE proposing the link');
  assert(linkUpdate!.patch!.link_state === 'proposed', 'expected link_state=proposed, never confirmed');
  assert(linkUpdate!.patch!.profile_id === 'profile-42', 'expected profile_id set to the matched profile');
  assert(linkUpdate!.patch!.link_proposed_reason === 'work-email-exact-match', 'expected the auditable proposal reason');
  assert(
    linkUpdate!.eq.some(([col, val]) => col === 'link_state' && val === 'unlinked'),
    'the proposal update must be scoped to link_state=unlinked — never re-propose over an existing proposed/confirmed/rejected row',
  );
  const notif = calls.find((c) => c.table === 'notifications' && c.op === 'insert');
  assert(!notif, 'a clean unique match needs no action-required notification');
});

Deno.test('AC-TSP-092 ZERO work-email matches: link stays unlinked, NO erp_employees link update, ONE action-required notification', async () => {
  // The ilike work-email probe finds zero matches; the (separate) eq+in recipient lookup for the
  // action-required notification finds one Admin — both hit `profiles` with a DIFFERENT filter shape.
  const { client, calls } = fakeServiceClient((table, query) =>
    table === 'profiles' && !query.ilike ? [{ id: 'admin-1' }] : []);
  const deps = createErpFeedDeps(client, 'org-1', 'employee');
  await deps.mintMirror(
    { id: 'HR-EMP-00004', employee_number: 'HR-EMP-00004', work_email: 'nomatch@example.com' },
    Date.parse('2026-07-20T09:00:00.000Z'),
  );
  const linkUpdate = calls.find((c) => c.table === 'erp_employees' && c.op === 'update');
  assert(!linkUpdate, 'zero matches must NEVER auto-resolve — no erp_employees update at all');
  const notifInsert = calls.find((c) => c.table === 'notifications' && c.op === 'insert');
  assert(!!notifInsert, 'expected ONE action-required notification for the zero-match case');
  const rows = (notifInsert!.patch as { rows: Array<{ metadata: { action_required: string } }> }).rows;
  assert(rows.every((r) => r.metadata.action_required === 'employee-link-no-match'), 'expected the no-match reason code');
});

Deno.test('AC-TSP-092 MULTIPLE work-email matches (ambiguous): link stays unlinked, NO erp_employees link update, action-required surfaced', async () => {
  const { client, calls } = fakeServiceClient({ profiles: [{ id: 'p1' }, { id: 'p2' }] });
  const deps = createErpFeedDeps(client, 'org-1', 'employee');
  await deps.mintMirror(
    { id: 'HR-EMP-00005', employee_number: 'HR-EMP-00005', work_email: 'shared@example.com' },
    Date.parse('2026-07-20T09:00:00.000Z'),
  );
  const linkUpdate = calls.find((c) => c.table === 'erp_employees' && c.op === 'update');
  assert(!linkUpdate, 'an ambiguous match must NEVER auto-resolve — no erp_employees update at all');
  const notifInsert = calls.find((c) => c.table === 'notifications' && c.op === 'insert');
  const rows = (notifInsert!.patch as { rows: Array<{ metadata: { action_required: string } }> }).rows;
  assert(rows.every((r) => r.metadata.action_required === 'employee-link-ambiguous'), 'expected the ambiguous reason code');
});

Deno.test('AC-TSP-092 an Employee adopted with NO work_email skips the match probe entirely and surfaces action-required', async () => {
  const { client, calls } = fakeServiceClient({ profiles: [{ id: 'p1' }] });
  const deps = createErpFeedDeps(client, 'org-1', 'employee');
  await deps.mintMirror(
    { id: 'HR-EMP-00006', employee_number: 'HR-EMP-00006', work_email: null },
    Date.parse('2026-07-20T09:00:00.000Z'),
  );
  const profilesSelect = calls.find((c) => c.table === 'profiles' && c.op === 'select' && c.ilike);
  assert(!profilesSelect, 'no work_email means no email match probe should even run');
  const notifInsert = calls.find((c) => c.table === 'notifications' && c.op === 'insert');
  const rows = (notifInsert!.patch as { rows: Array<{ metadata: { action_required: string } }> }).rows;
  assert(rows.every((r) => r.metadata.action_required === 'employee-link-no-email'), 'expected the no-email reason code');
});

Deno.test('AC-TSP-094 updateMirror on an Employee mirrors erp_status flipping to Left and leaves link_state/profile_id untouched', async () => {
  const { client, calls } = fakeServiceClient((table) => (table === 'erp_employees' ? [{ work_email: 'x@example.com', link_state: 'confirmed' }] : []));
  const deps = createErpFeedDeps(client, 'org-1', 'employee');
  await deps.updateMirror(
    'pmo-emp-1',
    { id: 'HR-EMP-00001', erp_status: 'Left', work_email: 'x@example.com' },
    Date.parse('2026-07-20T09:00:00.000Z'),
  );
  const update = calls.find((c) => c.table === 'erp_employees' && c.op === 'update');
  assert(!!update, 'expected an erp_employees update');
  assert(update!.patch!.erp_status === 'Left', 'expected erp_status=Left mirrored');
  assert(!('link_state' in update!.patch!), 'FR-TSP-092.4: updateMirror must NEVER touch link_state');
  assert(!('profile_id' in update!.patch!), 'FR-TSP-092.4: updateMirror must NEVER touch profile_id');
});

Deno.test("AC-TSP-092.4 updateMirror on a CONFIRMED Employee whose work_email changed surfaces employee-link-email-changed WITHOUT re-pointing the link", async () => {
  const { client, calls } = fakeServiceClient((table) => {
    if (table === 'erp_employees') return [{ work_email: 'old@example.com', link_state: 'confirmed' }];
    if (table === 'profiles') return [{ id: 'admin-1' }]; // the action-required recipient lookup
    return [];
  });
  const deps = createErpFeedDeps(client, 'org-1', 'employee');
  await deps.updateMirror('pmo-emp-1', { id: 'HR-EMP-00001', work_email: 'new@example.com' }, Date.parse('2026-07-20T09:00:00.000Z'));

  const notifInsert = calls.find((c) => c.table === 'notifications' && c.op === 'insert');
  assert(!!notifInsert, 'expected an action-required notification for the confirmed-link email change');
  const rows = (notifInsert!.patch as { rows: Array<{ metadata: { action_required: string } }> }).rows;
  assert(rows.every((r) => r.metadata.action_required === 'employee-link-email-changed'), 'expected the email-changed reason code');

  const update = calls.find((c) => c.table === 'erp_employees' && c.op === 'update');
  assert(update!.patch!.work_email === 'new@example.com', 'the mirror column itself still updates (display accuracy)');
  assert(!('profile_id' in update!.patch!), 'the confirmed link must NEVER be re-pointed by an update');
  assert(!('link_state' in update!.patch!), 'the confirmed link_state must NEVER be altered by an update');
});

Deno.test('AC-TSP-092.4 updateMirror on a NON-confirmed Employee row (e.g. proposed) whose work_email changed does NOT surface the email-changed notice', async () => {
  const { client, calls } = fakeServiceClient((table) => (table === 'erp_employees' ? [{ work_email: 'old@example.com', link_state: 'proposed' }] : []));
  const deps = createErpFeedDeps(client, 'org-1', 'employee');
  await deps.updateMirror('pmo-emp-1', { id: 'HR-EMP-00001', work_email: 'new@example.com' }, Date.parse('2026-07-20T09:00:00.000Z'));

  const notifInsert = calls.find((c) => c.table === 'notifications' && c.op === 'insert');
  assert(!notifInsert, 'a non-confirmed link changing email is not the security-sensitive case — no notification expected');
  const update = calls.find((c) => c.table === 'erp_employees' && c.op === 'update');
  assert(update!.patch!.work_email === 'new@example.com', 'the mirror column still updates for a non-confirmed row');
});

Deno.test('AC-TSP-040 the `timesheet` kind provides NO adoptAtomically strategy — the never-adopt throw must fire BEFORE any external_refs claim (no orphaned claimed-but-unminted mapping)', () => {
  const { client } = fakeServiceClient({});
  const deps = createErpFeedDeps(client, 'org-1', 'timesheet');
  assert(
    deps.adoptAtomically === undefined,
    'Luna BLOCK 7\'s claim-first strategy claims external_refs BEFORE mintWithId runs — for a kind that must NEVER adopt, that claim would orphan a PMO id nothing is ever minted for. The timesheet kind must fall back to the legacy mintMirror-only path, where the throw fires before any external_refs write.',
  );
});

Deno.test('AC-TSP-090 the `employee` kind KEEPS the claim-first adoptAtomically strategy (it legitimately adopts, unlike timesheet)', () => {
  const { client } = fakeServiceClient({});
  const deps = createErpFeedDeps(client, 'org-1', 'employee');
  assert(deps.adoptAtomically !== undefined, 'employee legitimately adopts — the claim-first race-safety strategy must stay wired for it');
});

// ── P3b Slice 6 — never adopt a native Timesheet (AC-TSP-040, task 6.2) ──────────────────────────

Deno.test('AC-TSP-040 an unmapped native Timesheet mints ZERO rows in timesheets/timesheet_entries/timesheet_erp_mirror, and surfaces ONE action-required', async () => {
  const { client, calls } = fakeServiceClient({ profiles: [{ id: 'admin-1' }] });
  const deps = createErpFeedDeps(client, 'org-1', 'timesheet');

  let threw: unknown = null;
  try {
    await deps.mintMirror({ id: 'TS-2026-00099' }, Date.parse('2026-07-20T09:00:00.000Z'));
  } catch (err) {
    threw = err;
  }
  assert(threw !== null, 'AC-TSP-040: minting a native Timesheet must NEVER silently succeed — it must throw a classified error');
  assert(
    (threw as { code?: string } | null)?.code === 'commit-rejected',
    `expected a commit-rejected AdapterError, got ${JSON.stringify(threw)}`,
  );
  assert(
    (threw as { message?: string }).message?.includes('native-timesheet-not-adopted') ?? false,
    'expected the native-timesheet-not-adopted classification in the error message',
  );

  for (const forbiddenTable of ['timesheets', 'timesheet_entries', 'timesheet_erp_mirror']) {
    const write = calls.find((c) => c.table === forbiddenTable && (c.op === 'insert' || c.op === 'update'));
    assert(!write, `AC-TSP-040: expected NO write to '${forbiddenTable}' — PMO owns entry AND approval, never minted from an ERP doc`);
  }

  const notifInsert = calls.find((c) => c.table === 'notifications' && c.op === 'insert');
  assert(!!notifInsert, 'expected ONE action-required notification for the never-adopted native Timesheet');
  const rows = (notifInsert!.patch as { rows: Array<{ metadata: { action_required: string } }> }).rows;
  assert(rows.every((r) => r.metadata.action_required === 'timesheet-native-not-adopted'), 'expected the native-not-adopted reason code');
});

// ── P3b Slice 6 — desk-cancel reopens the push state (AC-TSP-041, task 6.3) ──────────────────────

Deno.test('AC-TSP-041 a desk-cancelled (mapped) Timesheet REOPENS push_state to failed alongside the standard cancel patch, and surfaces action-required', async () => {
  const { client, calls } = fakeServiceClient({ profiles: [{ id: 'admin-1' }] });
  const deps = createErpFeedDeps(client, 'org-1', 'timesheet');
  await deps.tombstoneMirror('pmo-ts-1', '2026-07-20T00:00:00.000Z');

  const update = calls.find((c) => c.table === 'timesheet_erp_mirror' && c.op === 'update');
  assert(!!update, 'expected the timesheet_erp_mirror row to be tombstoned');
  assert(update!.patch!.erp_docstatus === 2, 'expected the standard cancel patch (erp_docstatus=2)');
  assert(update!.patch!.push_state === 'failed', 'AC-TSP-041/FR-TSP-084: desk-cancel must REOPEN push_state to failed');
  // HIGH-1 (Luna re-audit, 2026-07-21): `timesheet_erp_mirror.id` is its OWN generated uuid — the PMO
  // record lives in the SEPARATE `timesheet_id` column (migration 0136). A filter on `.eq('id', …)`
  // would match ZERO rows (a silent Postgres no-op, not an error) and this mirror would never actually
  // reopen. Assert the REAL filter column+value, not just that patch/table came out right — a fake
  // that only checks those would still pass with the predicate deleted entirely.
  assert(
    update!.eq.some(([col, val]) => col === 'timesheet_id' && val === 'pmo-ts-1'),
    "HIGH-1: expected the tombstone update to filter on timesheet_id = 'pmo-ts-1' (the mirror's own FK to the PMO row) — filtering on 'id' would match no row at all",
  );
  assert(
    !update!.eq.some(([col]) => col === 'id'),
    "HIGH-1: the tombstone update must NOT filter on the mirror's own 'id' column — that is a random uuid, never the PMO record id",
  );

  const timesheetsWrite = calls.find((c) => c.table === 'timesheets');
  assert(!timesheetsWrite, "FR-TSP-004(ii): the PMO timesheets row itself is NEVER touched — PMO's approval is not ERP's to revoke");

  const notifInsert = calls.find((c) => c.table === 'notifications' && c.op === 'insert');
  assert(!!notifInsert, 'expected an action-required notification for the desk cancel');
  const rows = (notifInsert!.patch as { rows: Array<{ metadata: { action_required: string } }> }).rows;
  assert(rows.every((r) => r.metadata.action_required === 'timesheet-desk-cancelled'), 'expected the desk-cancelled reason code');
});

Deno.test('HIGH-1 updateMirror on a mapped Timesheet filters on timesheet_id, never the mirror\'s own id', async () => {
  const { client, calls } = fakeServiceClient({});
  const deps = createErpFeedDeps(client, 'org-1', 'timesheet');
  await deps.updateMirror('pmo-ts-2', { id: 'TS-2026-00050' }, Date.parse('2026-07-20T09:00:00.000Z'));
  const update = calls.find((c) => c.table === 'timesheet_erp_mirror' && c.op === 'update');
  assert(!!update, 'expected a timesheet_erp_mirror update');
  assert(
    update!.eq.some(([col, val]) => col === 'timesheet_id' && val === 'pmo-ts-2'),
    "HIGH-1: expected updateMirror to filter on timesheet_id = 'pmo-ts-2'",
  );
});

Deno.test('HIGH-1 readMirrorSourceMod on a Timesheet reads by timesheet_id, never the mirror\'s own id (a wrong filter silently disables the staleness guard)', async () => {
  const { client, calls } = fakeServiceClient({
    timesheet_erp_mirror: [{ erp_modified: '2026-07-20T09:00:00.000Z' }],
  });
  const deps = createErpFeedDeps(client, 'org-1', 'timesheet');
  const ms = await deps.readMirrorSourceMod('pmo-ts-3');
  assert(ms === Date.parse('2026-07-20T09:00:00.000Z'), 'expected the fixture row to be found and its erp_modified parsed');
  const select = calls.find((c) => c.table === 'timesheet_erp_mirror' && c.op === 'select');
  assert(!!select, 'expected a timesheet_erp_mirror select');
  assert(
    select!.eq.some(([col, val]) => col === 'timesheet_id' && val === 'pmo-ts-3'),
    "HIGH-1: expected readMirrorSourceMod to filter on timesheet_id = 'pmo-ts-3'",
  );
});

Deno.test('MEDIUM-1 a Desk-controlled work_email is ESCAPED before it reaches ilike (no wildcard injection)', async () => {
  // `work_email` is editable by anyone with ERPNext Desk access — the exact untrusted input 0140's
  // human-confirm step exists to contain. Unescaped, `.ilike()` treats `%`/`_` as wildcards, so
  // `finance.lead%` matches `finance.lead@corp.com` UNIQUELY and is auto-proposed with
  // `link_proposed_reason: 'work-email-exact-match'` — a FALSE claim shown to the confirming Admin.
  // After the confirm, that user's hours post against the attacker's Employee costing rate.
  const { client, calls } = fakeServiceClient({ profiles: [{ id: 'victim-1' }] });
  const deps = createErpFeedDeps(client, 'org-1', 'employee');
  await deps.mintMirror({ id: 'HR-EMP-00009', work_email: 'finance.lead%' }, Date.parse('2026-07-20T09:00:00.000Z'));

  const lookup = calls.find((c) => c.table === 'profiles' && c.op === 'select' && !!c.ilike);
  assert(!!lookup, 'expected the work-email profile lookup');
  assert(
    lookup!.ilike![1] === 'finance.lead\\%',
    `MEDIUM-1: the % must reach ilike ESCAPED (literal percent, not a prefix wildcard) — got ${JSON.stringify(lookup!.ilike![1])}`,
  );
});

Deno.test('AC-TSP-041 a non-timesheet cancel (e.g. purchase-invoice) does NOT gain a push_state field (additive only, byte-for-byte for other kinds)', async () => {
  const { client, calls } = fakeServiceClient({});
  const deps = createErpFeedDeps(client, 'org-1', 'purchase-invoice');
  await deps.tombstoneMirror('pmo-pi-9', '2026-07-20T00:00:00.000Z');
  const update = calls.find((c) => c.table === 'procurement_invoices' && c.op === 'update');
  assert(!('push_state' in update!.patch!), 'push_state is a timesheet-only reopen — must not leak onto other kinds');
});
