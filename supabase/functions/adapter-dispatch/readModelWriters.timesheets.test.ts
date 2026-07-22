// P3b (FR-TSP-072/085, ADR-0059 §3.1/§6) — the `timesheets` read-model writer + the durable
// failure state.
// Verify: cd supabase/functions/adapter-dispatch && deno test --allow-all --config deno.json readModelWriters.timesheets.test.ts
//
// Two properties, both structural rather than cosmetic:
//  1. **The SoT tables are never written.** Posture B means PMO owns `timesheets`/`timesheet_entries`/
//     `profiles`; a service-role mirror write that touched them would silently overwrite user data
//     that RLS cannot protect. Asserted on the client's `from()` call log, not by inspection.
//  2. **A failed push is DURABLE and VISIBLE.** The PMO transition already succeeded, so nothing else
//     will ever surface a failed push — an un-recorded failure is indistinguishable from a push that
//     never happened (ADR-0059 §6).

import { getReadModelWriter, markTimesheetPushOutcome } from './readModelWriters.ts';

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function makeFakeClient() {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const client = {
    from(table: string) {
      return {
        insert: async (row: unknown) => {
          calls.push({ table, method: 'insert', args: [row] });
          return { error: null };
        },
        upsert: async (row: unknown, options: unknown) => {
          calls.push({ table, method: 'upsert', args: [row, options] });
          return { error: null };
        },
        update: (patch: unknown) => {
          calls.push({ table, method: 'update', args: [patch] });
          const chain = {
            eq() {
              return chain;
            },
            then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
          };
          return chain;
        },
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      };
    },
  };
  return { client, calls };
}

const CTX = (client: unknown) => ({ serviceClient: client as never, orgId: 'org-1', callerUserId: 'user-1' });

const COMMAND = {
  domain: 'timesheets',
  operation: 'create',
  record: { id: 'ts-1', erp_doc_kind: 'timesheet', approved_at: '2026-01-12T03:04:05Z' },
} as never;

const CANONICAL = {
  id: 'TS-2026-00011',
  ts_number: 'TS-2026-00011',
  erp_total_hours: '7.25',
  erp_total_costing_amount: '1234.50',
  erp_docstatus: 1,
  erp_modified: '2026-01-12 03:05:00.000000',
  erp_amended_from: null,
} as never;

Deno.test('FR-TSP-072: a timesheets upsert writes ONLY timesheet_erp_mirror, with push_state=pushed and the ERP oracles', async () => {
  const { client, calls } = makeFakeClient();
  await getReadModelWriter('timesheets').upsert(CTX(client), CANONICAL, COMMAND);

  const upserts = calls.filter((c) => c.method === 'upsert');
  assertEquals(upserts.length, 1);
  assertEquals(upserts[0].table, 'timesheet_erp_mirror');
  const row = upserts[0].args[0] as Record<string, unknown>;
  assertEquals(row.org_id, 'org-1');
  assertEquals(row.timesheet_id, 'ts-1');
  assertEquals(row.ts_number, 'TS-2026-00011');
  assertEquals(row.push_state, 'pushed');
  assertEquals(row.push_error, null);
  assertEquals(row.erp_total_hours, '7.25');
  assertEquals(row.erp_total_costing_amount, '1234.50');
  assertEquals(row.erp_docstatus, 1);
  assertEquals(row.approved_at_pushed, '2026-01-12T03:04:05Z');
  assertEquals(upserts[0].args[1], { onConflict: 'timesheet_id' }, 'a re-apply must be idempotent on the 1:1 seam');
});

// ── M-1 (Luna audit round 3) — the sibling of the budget case: MEDIUM-G's sticky `erp_cancelled_at`
// is only safe if a fresh PMO push clears it. An `upsert` updates ONLY the columns it names, so a
// tombstone set by a Desk cancel survived a successful re-push and permanently excluded the row from
// the backstop's candidate query.
Deno.test('M-1 a fresh timesheet push CLEARS the Desk-cancel tombstone (the backstop is never permanently blinded)', async () => {
  const { client, calls } = makeFakeClient();
  await getReadModelWriter('timesheets').upsert(CTX(client), CANONICAL, COMMAND);
  const row = calls.find((c) => c.method === 'upsert')!.args[0] as Record<string, unknown>;
  assert('erp_cancelled_at' in row, 'the fresh push must WRITE erp_cancelled_at — an upsert only updates the columns it names');
  assertEquals(row.erp_cancelled_at, null, 'a successful re-push supersedes the cancelled ERP document');
});

Deno.test('ADR-0059 §3.1: the writer NEVER touches the PMO SoT tables (timesheets/timesheet_entries/profiles)', async () => {
  const { client, calls } = makeFakeClient();
  await getReadModelWriter('timesheets').upsert(CTX(client), CANONICAL, COMMAND);
  for (const table of ['timesheets', 'timesheet_entries', 'profiles']) {
    assert(!calls.some((c) => c.table === table), `the mirror writer must never write ${table}`);
  }
});

Deno.test('ADR-0059 §6: a MISSING approved_at witness THROWS rather than writing a null witness', async () => {
  // Luna's P3a finding, transposed: a sweep finalizing with a NULL actor silently no-op'd an SoD.
  // Here the witness is what ties the mirrored row to the approval it was keyed on — a null one makes
  // the row unauditable, so it must be a loud failure, not a nullable column write.
  const { client, calls } = makeFakeClient();
  const command = { domain: 'timesheets', operation: 'create', record: { id: 'ts-1', erp_doc_kind: 'timesheet' } } as never;
  let threw = false;
  try {
    await getReadModelWriter('timesheets').upsert(CTX(client), CANONICAL, command);
  } catch {
    threw = true;
  }
  assert(threw, 'a push with no server-resolved approved_at witness must throw');
  assertEquals(calls.filter((c) => c.method === 'upsert').length, 0, 'and must write nothing');
});

Deno.test('FR-TSP-085: a classified failure is recorded durably as push_state=failed + a client-safe reason', async () => {
  const { client, calls } = makeFakeClient();
  await markTimesheetPushOutcome(CTX(client), 'ts-1', '2026-01-12T03:04:05Z', {
    code: 'employee-unlinked',
    message: "no confirmed erp_employees link for user 'user-1'",
  });
  const upserts = calls.filter((c) => c.method === 'upsert');
  assertEquals(upserts.length, 1);
  assertEquals(upserts[0].table, 'timesheet_erp_mirror');
  const row = upserts[0].args[0] as Record<string, unknown>;
  assertEquals(row.push_state, 'failed');
  assertEquals(row.timesheet_id, 'ts-1');
  assertEquals(row.approved_at_pushed, '2026-01-12T03:04:05Z');
  assert(String(row.push_error).includes('employee-unlinked'), 'the classified code must be visible to the operator');
});

Deno.test('FR-TSP-085: a HELD command is recorded as push_state=held (terminal until an operator acts)', async () => {
  const { client, calls } = makeFakeClient();
  await markTimesheetPushOutcome(CTX(client), 'ts-1', '2026-01-12T03:04:05Z', { code: 'command-held', message: 'held for operator' });
  const row = (calls.find((c) => c.method === 'upsert')?.args[0] ?? {}) as Record<string, unknown>;
  assertEquals(row.push_state, 'held');
});

Deno.test('FR-TSP-056: an EMPTY approved sheet is recorded as pushed with NO ts_number (a success, not a retry)', async () => {
  // A zero-entry / all-zero-hours sheet must not sit in the sweep's retry queue forever, and must not
  // be sent to ERP at all (a Timesheet with an empty time_logs table is a hard 417 MandatoryError).
  const { client, calls } = makeFakeClient();
  await markTimesheetPushOutcome(CTX(client), 'ts-1', '2026-01-12T03:04:05Z', null);
  const row = (calls.find((c) => c.method === 'upsert')?.args[0] ?? {}) as Record<string, unknown>;
  assertEquals(row.push_state, 'pushed');
  // ⚑ NEW-7: "NO ts_number" is asserted as the recorder never NAMING the column, not as it WRITING a
  // null. On a fresh row the two are identical (the column defaults to NULL, which is what this case
  // is about); on a re-recorded row they are not — writing the null erases a live ERPNext Timesheet
  // number. Asserting the payload literal is what let that erasure ship, so the oracle moved down to
  // the real property.
  assert(!('ts_number' in row), 'the recorder must not claim a document number it never learned');
  assertEquals(row.push_error, null);
});

/**
 * ⚑ NEW-7 (Luna audit round 4, 2026-07-22) — THE FAILURE RECORDER MUST NOT ERASE A LIVE ERP DOCUMENT
 * NUMBER. Exactly the shape of the M-1 fix above, inverted: an `upsert` updates ONLY the columns it
 * NAMES, and this writer named `ts_number: null` unconditionally.
 *
 * So a sheet that HAD been pushed (`push_state='pushed'`, `ts_number='TS-2026-00042'`, a real ERPNext
 * Timesheet) and whose LATER re-push attempt was rejected (ERP unreachable, held, employee unlinked)
 * had its `ts_number` wiped to NULL. `PushStateBadge` then showed a failed push with no document
 * number, the ERPNext Timesheet still existed and still carried hours, and the only pointer PMO had to
 * it was gone — so nobody could reconcile it. The recorder learns NOTHING about a document number on
 * any of its paths (it is by definition the no-document outcome), so it must not claim to: it leaves
 * the column alone. A fresh row still gets the column default (NULL); a known number survives.
 */
Deno.test('NEW-7: the failure recorder never NAMES ts_number — a live ERP document number survives a failed re-push', async () => {
  const { client, calls } = makeFakeClient();
  await markTimesheetPushOutcome(CTX(client), 'ts-1', '2026-01-12T03:04:05Z', { code: 'external-unreachable', message: 'boom' });
  const row = (calls.find((c) => c.method === 'upsert')?.args[0] ?? {}) as Record<string, unknown>;
  assert(
    !('ts_number' in row),
    'the recorder must OMIT ts_number: an upsert only updates the columns it names, and naming it null ' +
      'erases the number of an ERPNext Timesheet that still exists',
  );
});

Deno.test('NEW-7: a HELD outcome likewise leaves a known ts_number intact', async () => {
  const { client, calls } = makeFakeClient();
  await markTimesheetPushOutcome(CTX(client), 'ts-1', '2026-01-12T03:04:05Z', { code: 'command-held', message: 'held for operator' });
  const row = (calls.find((c) => c.method === 'upsert')?.args[0] ?? {}) as Record<string, unknown>;
  assert(!('ts_number' in row), 'a held outcome learns no document number either — it must not null one out');
});

Deno.test('the failure recorder never touches the PMO SoT tables either', async () => {
  const { client, calls } = makeFakeClient();
  await markTimesheetPushOutcome(CTX(client), 'ts-1', '2026-01-12T03:04:05Z', { code: 'external-unreachable', message: 'boom' });
  for (const table of ['timesheets', 'timesheet_entries', 'profiles']) {
    assert(!calls.some((c) => c.table === table), `the failure recorder must never write ${table}`);
  }
});
