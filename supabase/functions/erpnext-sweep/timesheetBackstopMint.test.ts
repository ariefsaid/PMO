/**
 * AC-TSP-022 [Deno] — THE BACKSTOP DRIVES AN APPROVED WEEK THAT NEVER REACHED THE OUTBOX.
 *
 * The failure this pass exists for is "the browser died before the fetch reached the server". That
 * leaves NO mirror row and NO outbox row — so the shipped implementation could neither SEE the sheet
 * (its queue read `timesheet_erp_mirror` only) nor DRIVE it (with no outbox row it parked the row
 * `held`, which its own candidate query excludes, making it terminal). PMO said Approved, the client's
 * ERP never heard about the hours, and nothing would ever re-drive them.
 *
 * Budget's "never mint an unattributed outbox row" rule does NOT transfer: a budget version carries no
 * actor of its own, but a timesheet always does — its `approved_by`, read SERVER-SIDE by
 * `approved_timesheet_for_push` (0138), which re-asserts that actor's authorization AND offboarding
 * status on every tick. So the minted row is attributable and auditable.
 *
 * These drive the SHIPPED `timesheetBackstopDepsLive` against a fake DB that records real writes —
 * the same idiom as `budgetHeldPrecondition.test.ts`.
 *
 * Verify: deno test supabase/functions/erpnext-sweep/ --config supabase/functions/erpnext-sweep/deno.json
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { timesheetBackstopDepsLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = '00000000-0000-4000-8000-0000000000aa';
const SHEET = '11111111-0000-0000-0000-000000000001';
const APPROVER = '22222222-0000-0000-0000-000000000002';
const AUTHOR = '33333333-0000-0000-0000-000000000003';
/** Inside the backstop's 14-day lookback (the queue is bounded so a long history cannot starve it). */
const APPROVED_AT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const ACTIVATED_AT = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const ENTRIES = [{ project_id: 'p-1', entry_date: '2026-07-13', hours: '5.00', project_org_id: ORG }];

function orgBinding() {
  return {
    orgId: ORG,
    siteUrl: 'https://erp.example.test',
    secretRef: 'mint-bench',
    company: 'PMO Smoke Co',
    config: {},
    ownedDomains: ['timesheets'],
    versionMajor: 15,
    activatedAt: ACTIVATED_AT,
  };
}

interface Write { table: string; op: string; payload: Record<string, unknown> }

interface DbOptions {
  /** `timesheets` rows the approved-sheet query may return: id + approved_at (already status-scoped). */
  approvedSheets?: Array<{ id: string; approved_at: string }>;
  /** `timesheet_erp_mirror` rows that already exist (queue rows AND the absent-detection anti-join). */
  mirrorRows?: Array<{ timesheet_id: string; push_state: string; erp_cancelled_at: string | null }>;
  /** The sheet's recorded approver (`timesheets.approved_by`); null ⇒ nothing to attribute to. */
  approvedBy?: string | null;
  /** Whether an outbox row already exists for the derived key. */
  existingOutbox?: boolean;
}

function fakeDb(opts: DbOptions = {}) {
  const writes: Write[] = [];
  const filters: Record<string, unknown[]> = {};

  const client = {
    from(table: string) {
      const eqs: Record<string, unknown> = {};
      let inFilter: { col: string; vals: unknown[] } | null = null;
      let gte: { col: string; val: unknown } | null = null;

      const rowsFor = (): unknown[] => {
        if (table === 'timesheets') {
          const sheets = opts.approvedSheets ?? [];
          return sheets
            .filter((s) => !gte || String(s.approved_at) >= String(gte.val))
            .map((s) => ({ id: s.id }));
        }
        if (table === 'timesheet_erp_mirror') {
          const rows = opts.mirrorRows ?? [];
          return rows.filter((r) => !inFilter || inFilter.vals.includes(r.timesheet_id));
        }
        return [];
      };

      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => { eqs[col] = val; return builder; },
        is: () => builder,
        gte: (col: string, val: unknown) => { gte = { col, val }; return builder; },
        in: (col: string, vals: unknown[]) => { inFilter = { col, vals }; return builder; },
        not: () => builder,
        order: () => builder,
        limit: () => builder,
        contains: () => builder,
        maybeSingle: () => {
          if (table === 'timesheets') return Promise.resolve({ data: { approved_by: opts.approvedBy ?? null }, error: null });
          if (table === 'external_command_outbox') {
            return Promise.resolve({
              data: opts.existingOutbox
                ? { id: 'outbox-1', domain: 'timesheets', pmo_record_id: SHEET, idempotency_key: 'k', state: 'pending', external_record_id: null, canonical: null, claim_generation: 0, payload_digest: null, operation: 'create', payload: {}, actor_user_id: APPROVER }
                : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        single: () => Promise.resolve({ data: null, error: null }),
        insert: (payload: Record<string, unknown>) => {
          writes.push({ table, op: 'insert', payload });
          // A minted outbox row becomes readable to the immediately-following re-read.
          if (table === 'external_command_outbox') opts.existingOutbox = true;
          return Promise.resolve({ data: null, error: null });
        },
        update: (payload: Record<string, unknown>) => { writes.push({ table, op: 'update', payload }); return builder; },
        upsert: (payload: Record<string, unknown>) => { writes.push({ table, op: 'upsert', payload }); return Promise.resolve({ data: null, error: null }); },
        then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
          filters[table] = [eqs];
          return Promise.resolve({ data: rowsFor(), error: null }).then(resolve);
        },
      };
      return builder;
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === 'approved_timesheet_for_push') {
        return Promise.resolve({ data: [{ timesheet_id: args.p_timesheet_id, user_id: AUTHOR, approved_at: APPROVED_AT, entries: ENTRIES }], error: null });
      }
      // Fail the REPLAY authorization on purpose: the mint has already happened by then, and this stops
      // the drive deterministically at the DB boundary instead of reaching for bench credentials.
      if (fn === 'domain_owned_by_tier') return Promise.resolve({ data: false, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;

  return { client, writes };
}

const candidate = (push_state: string) => ({ timesheet_id: SHEET, push_state, erp_cancelled_at: null });

Deno.test('AC-TSP-022: an approved sheet with NO mirror row IS a candidate (the browser-died-before-the-fetch case)', async () => {
  const { client } = fakeDb({
    approvedSheets: [{ id: SHEET, approved_at: APPROVED_AT }],
    mirrorRows: [],
  });
  const deps = timesheetBackstopDepsLive(client, orgBinding(), new Set());
  const rows = await deps.listPendingTimesheetPushes(ORG, 200);
  assert(rows.length === 1, `expected the un-mirrored approved sheet to be queued, got ${JSON.stringify(rows)}`);
  assert(rows[0].timesheet_id === SHEET, 'the queued row is the approved sheet');
  assert(rows[0].push_state === 'absent', `an un-mirrored sheet is queued as 'absent', got ${rows[0].push_state}`);
});

Deno.test('AC-TSP-022: a sheet that ALREADY has a mirror row is never double-queued', async () => {
  const { client } = fakeDb({
    approvedSheets: [{ id: SHEET, approved_at: APPROVED_AT }],
    mirrorRows: [{ timesheet_id: SHEET, push_state: 'pushed', erp_cancelled_at: null }],
  });
  const deps = timesheetBackstopDepsLive(client, orgBinding(), new Set());
  const rows = await deps.listPendingTimesheetPushes(ORG, 200);
  // The mirror half of the query only returns pending/failed (asserted by the live query's own
  // predicates); what THIS proves is that the `absent` half does not re-add an already-mirrored sheet.
  assert(rows.filter((r) => r.push_state === 'absent').length === 0, `a mirrored sheet must not be queued as absent: ${JSON.stringify(rows)}`);
});

Deno.test('AC-TSP-022: ⚑ hours approved BEFORE the binding was activated are never retroactively posted', async () => {
  const { client } = fakeDb({
    approvedSheets: [{ id: SHEET, approved_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString() }],
    mirrorRows: [],
  });
  const deps = timesheetBackstopDepsLive(client, orgBinding(), new Set());
  const rows = await deps.listPendingTimesheetPushes(ORG, 200);
  assert(rows.length === 0, `a week approved before the integration existed is out of scope, got ${JSON.stringify(rows)}`);
});

Deno.test('AC-TSP-022: the `absent` scan is BOUNDED — a long-settled sheet can never starve a newly stranded one', async () => {
  const { client } = fakeDb({
    // Approved well inside the binding's lifetime, but far outside the recovery lookback.
    approvedSheets: [{ id: SHEET, approved_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString() }],
    mirrorRows: [],
  });
  const deps = timesheetBackstopDepsLive(client, orgBinding(), new Set());
  const rows = await deps.listPendingTimesheetPushes(ORG, 200);
  assert(rows.length === 0, `outside the lookback the sheet is a human's problem, not an unannounced push: ${JSON.stringify(rows)}`);
});

Deno.test('AC-TSP-022: the gate hands back the sheet\'s server-read subject (approver, author, entries)', async () => {
  const { client } = fakeDb({ approvedBy: APPROVER });
  const deps = timesheetBackstopDepsLive(client, orgBinding(), new Set());
  const gate = await deps.assertApprovedForPush(candidate('pending'));
  assert(gate.ok, 'the gate passes for an approved sheet');
  if (!gate.ok) return;
  assert(gate.subject?.approvedBy === APPROVER, 'the ACTOR is the sheet\'s own approved_by');
  assert(gate.subject?.userId === AUTHOR, 'the author comes from the gate RPC, never a payload');
  assert(JSON.stringify(gate.subject?.entries) === JSON.stringify(ENTRIES), 'the entries come from the gate RPC');
});

Deno.test('AC-TSP-022: with NO outbox row the backstop MINTS one attributed to the approver — never parks it `held`', async () => {
  const { client, writes } = fakeDb({ approvedBy: APPROVER, existingOutbox: false });
  const deps = timesheetBackstopDepsLive(client, orgBinding(), new Set());
  // The drive continues into the shared reconcile machinery, which this fake stops at the replay
  // authorization (domain_owned_by_tier ⇒ false). Everything under test has already happened.
  await deps.driveTimesheetPush(candidate('pending'), APPROVED_AT, { approvedBy: APPROVER, userId: AUTHOR, entries: ENTRIES }).catch(() => undefined);

  const mint = writes.find((w) => w.table === 'external_command_outbox' && w.op === 'insert');
  assert(mint !== undefined, 'the approved week must be MINTED into the outbox, not stranded');
  assert(mint!.payload.actor_user_id === APPROVER, `the row is attributed to the approver, got ${String(mint!.payload.actor_user_id)}`);
  assert(mint!.payload.state === 'pending' && mint!.payload.operation === 'create', 'a fresh create command');
  assert(mint!.payload.domain === 'timesheets' && mint!.payload.pmo_record_id === SHEET, 'keyed on the sheet');
  assert(String(mint!.payload.idempotency_key) === `ts:${SHEET}:${APPROVED_AT}`, `the SAME deterministic key the UI derives, got ${String(mint!.payload.idempotency_key)}`);
  const payload = mint!.payload.payload as Record<string, unknown>;
  assert(payload.erp_doc_kind === 'timesheet' && payload.user_id === AUTHOR && payload.approved_at === APPROVED_AT, 'the payload is the gate\'s server truth');
  assert(JSON.stringify(payload.entries) === JSON.stringify(ENTRIES), 'the hours pushed are the gate\'s own entries');
  assert(typeof mint!.payload.payload_digest === 'string' && (mint!.payload.payload_digest as string).length === 64, 'the payload digest binds the key to this payload');

  const held = writes.find((w) => w.table === 'timesheet_erp_mirror' && JSON.stringify(w.payload).includes('held'));
  assert(held === undefined, `the sheet must NOT be parked terminal-held: ${JSON.stringify(held)}`);
});

Deno.test('AC-TSP-022: a sheet with NO recorded approver is never minted — an unattributable command is recorded, not pushed', async () => {
  const { client, writes } = fakeDb({ approvedBy: null, existingOutbox: false });
  const deps = timesheetBackstopDepsLive(client, orgBinding(), new Set());
  await deps.driveTimesheetPush(candidate('pending'), APPROVED_AT, undefined).catch(() => undefined);

  assert(!writes.some((w) => w.table === 'external_command_outbox'), 'nothing is minted without a resolved actor');
  const parked = writes.find((w) => w.table === 'timesheet_erp_mirror');
  assert(parked !== undefined, 'the refusal is durable, never a silent drop');
  assert(JSON.stringify(parked!.payload).includes('timesheet-push-no-outbox-candidate'), `the reason is recorded: ${JSON.stringify(parked!.payload)}`);
});

Deno.test('AC-TSP-022: an `absent` candidate\'s refusal is INSERTED (a compare-and-set would record nothing)', async () => {
  const { client, writes } = fakeDb({ approvedBy: null, existingOutbox: false });
  const deps = timesheetBackstopDepsLive(client, orgBinding(), new Set());
  await deps.recordGateRefusal(candidate('absent'), 'timesheet-not-approved (status Submitted)');
  const parked = writes.find((w) => w.table === 'timesheet_erp_mirror');
  assert(parked?.op === 'insert', `an absent candidate has no row to update — the refusal must be inserted, got ${parked?.op}`);
  assert(parked!.payload.push_state === 'failed' && parked!.payload.push_error === 'timesheet-not-approved (status Submitted)', 'the reason is recorded verbatim');
});

Deno.test('AC-TSP-022: a MIRRORED candidate\'s refusal stays a compare-and-set (never a blind write over a concurrent success)', async () => {
  const { client, writes } = fakeDb({ approvedBy: null, existingOutbox: false });
  const deps = timesheetBackstopDepsLive(client, orgBinding(), new Set());
  await deps.recordGateRefusal(candidate('failed'), 'timesheet-not-approved (status Submitted)');
  const parked = writes.find((w) => w.table === 'timesheet_erp_mirror');
  assert(parked?.op === 'update', `a mirrored candidate is updated under its own predicate, got ${parked?.op}`);
});
