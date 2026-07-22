// P3b FR-TSP-010 — the Approved-only gate, unit-proven at the seam.
// Verify: cd supabase/functions/adapter-dispatch && deno test --allow-all --config deno.json approvalGuard.test.ts
//
// The property under test is NOT "an error code maps to a status" — it is that the gate's verdict and
// the pushed CONTENT both come from a server-side DB read under the caller's own identity, with no
// branch in which an absent/forged payload can stand in for either (ADR-0059 §3.3).

import { assertEquals, assert } from 'jsr:@std/assert';
import { enforceTimesheetApproved, isTimesheetPush, type ApprovalRpcClient } from './approvalGuard.ts';

const push = (over: Record<string, unknown> = {}) =>
  ({ domain: 'timesheets', operation: 'create', record: { id: 'ts-1', erp_doc_kind: 'timesheet', ...over } }) as never;

const client = (result: { data: unknown; error: { code?: string; message: string } | null }): ApprovalRpcClient & { calls: unknown[] } => {
  const calls: unknown[] = [];
  return {
    calls,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  };
};

const APPROVED_ROW = {
  timesheet_id: 'ts-1',
  user_id: 'user-1',
  approved_at: '2026-01-12T03:04:05Z',
  entries: [{ project_id: 'p-a', entry_date: '2026-01-05', hours: '7.25', project_org_id: 'org-a' }],
};

Deno.test('isTimesheetPush: true only for a timesheets-domain timesheet command', () => {
  assert(isTimesheetPush(push()));
  assert(!isTimesheetPush({ domain: 'revenue', operation: 'create', record: { id: 'si-1', erp_doc_kind: 'sales-invoice' } } as never));
  assert(!isTimesheetPush({ domain: 'timesheets', operation: 'create', record: { id: 'x', erp_doc_kind: 'sales-invoice' } } as never));
  assert(!isTimesheetPush({ domain: 'procurement', operation: 'create', record: { id: 'x', erp_doc_kind: 'timesheet' } } as never));
});

Deno.test('FR-TSP-010: an Approved sheet passes AND hands back the SERVER-read sheet (author, witness, entries)', async () => {
  const c = client({ data: [APPROVED_ROW], error: null });
  const result = await enforceTimesheetApproved(c, 'ts-1');
  assert(result.ok);
  assertEquals(result.status, 200);
  assertEquals(result.sheet?.user_id, 'user-1');
  assertEquals(result.sheet?.approved_at, '2026-01-12T03:04:05Z');
  assertEquals(result.sheet?.entries.length, 1);
  assertEquals(c.calls, [{ fn: 'approved_timesheet_for_push', args: { p_timesheet_id: 'ts-1' } }]);
});

Deno.test('FR-TSP-010: a non-Approved sheet (P0001) is refused 422 timesheet-not-approved — THE OWNER RULING', async () => {
  const result = await enforceTimesheetApproved(client({ data: null, error: { code: 'P0001', message: 'timesheet-not-approved (status Submitted)' } }), 'ts-1');
  assertEquals(result.ok, false);
  assertEquals(result.status, 422);
  assertEquals(result.message, 'timesheet-not-approved');
  assertEquals(result.sheet, undefined);
});

Deno.test('FR-TSP-011/054: an unauthorized or cross-org caller (42501) is refused 403', async () => {
  const result = await enforceTimesheetApproved(client({ data: null, error: { code: '42501', message: 'not authorized' } }), 'ts-1');
  assertEquals(result.ok, false);
  assertEquals(result.status, 403);
  assertEquals(result.message, 'not-authorized');
});

Deno.test('an unknown timesheet (P0002) is refused 404', async () => {
  const result = await enforceTimesheetApproved(client({ data: null, error: { code: 'P0002', message: 'timesheet not found' } }), 'ts-1');
  assertEquals(result.status, 404);
  assertEquals(result.message, 'not-found');
});

Deno.test('FAIL CLOSED: an unclassified RPC error is refused, never treated as approved', async () => {
  const result = await enforceTimesheetApproved(client({ data: null, error: { message: 'connection reset' } }), 'ts-1');
  assertEquals(result.ok, false);
  assertEquals(result.status, 422);
  assertEquals(result.message, 'approval-check-failed');
});

Deno.test('FAIL CLOSED: an EMPTY result set with no error is refused — there is no "absent ⇒ allowed" branch', async () => {
  // The trap this closes (Luna BLOCK-4's shape): a guard that only inspects `error` treats "no row"
  // as success and pushes a sheet whose state it never actually read.
  for (const data of [[], null, undefined]) {
    const result = await enforceTimesheetApproved(client({ data, error: null }), 'ts-1');
    assertEquals(result.ok, false, `data=${JSON.stringify(data)} must not pass the gate`);
    assertEquals(result.message, 'approval-check-failed');
  }
});

Deno.test('FAIL CLOSED: a row missing its approved_at witness is refused (ADR-0059 §6 — never a null witness)', async () => {
  const result = await enforceTimesheetApproved(client({ data: [{ ...APPROVED_ROW, approved_at: null }], error: null }), 'ts-1');
  assertEquals(result.ok, false);
  assertEquals(result.message, 'approval-check-failed');
});
