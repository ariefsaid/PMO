/** Timesheet repository implementation, including the approved-sheet external push (FR-TSP-005/041). */
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import { timesheetPushKey } from '@/src/lib/adapterSeam/erpnext/timesheetPushKey';
import {
  listTimesheets,
  saveTimesheetWeek,
  createDraftTimesheet,
  upsertTimesheetEntries,
  deleteTimesheetEntry,
} from '@/src/lib/db/timesheets';
import {
  submitTimesheet,
  approveTimesheet,
  rejectTimesheet,
  listTimesheetsAwaitingApproval,
  reopenTimesheet,
  attestTimesheetNoErpDocument,
  listReopenableApprovedTimesheets,
} from '@/src/lib/db/timesheetTransition';
import {
  approvedTimesheetForPush,
  listPushesNeedingAttention,
  confirmEmployeeLink,
  getPushState,
} from '@/src/lib/db/timesheetPush';
import { wrap } from './repositoryErrors';
import type { TimesheetRepository } from './contracts/timesheets';

export const timesheetRepository: TimesheetRepository = {
  // Preserve the established error contracts for these existing timesheet operations.
  saveWeek: saveTimesheetWeek,
  reopen: reopenTimesheet,
  attestNoErpDocument: attestTimesheetNoErpDocument,
  listReopenableApproved: listReopenableApprovedTimesheets,
  listPushesNeedingAttention,
  confirmEmployeeLink,
  getPushState,
  list: (userId) => wrap(() => listTimesheets(userId)),
  createDraft: (weekStartDate, userId) => wrap(() => createDraftTimesheet(weekStartDate, userId)),
  upsertEntries: (entries) => wrap(() => upsertTimesheetEntries(entries)),
  deleteEntry: (id) => wrap(() => deleteTimesheetEntry(id)),
  submit: (id) => wrap(() => submitTimesheet(id)),
  approve: (id, notes) => wrap(() => approveTimesheet(id, notes)),
  reject: (id, notes) => wrap(() => rejectTimesheet(id, notes)),
  listAwaitingApproval: (selfId, viewerRole) =>
    wrap(() => listTimesheetsAwaitingApproval(selfId, viewerRole)),
  // P3b (FR-TSP-005/006/041) — push an ALREADY-APPROVED sheet to the external system. Called AFTER
  // `transition_timesheet` has committed, never inside it: the approval must never depend on external
  // liveness (ADR-0059 §3.2), so a rejection here surfaces as durable push state, never as a failed
  // approval.
  pushApproved: (timesheetId) =>
    wrap(async () => {
      // FR-TSP-005: a cold/absent ownership map ⇒ 'pmo' ⇒ a benign NO-OP. Deliberately NOT a rejection
      // (contrast `revenue`'s `revenue-not-enabled`): `timesheets` is a shipped PMO feature and the
      // approval has already succeeded — rejecting here would break approval for every existing client.
      if (routeDomainWrite('timesheets') !== 'external') return;
      // The gate RPC is server truth for status + authorization + the entries (FR-TSP-010/011); the
      // client asserts nothing. It throws 42501/P0001 before a command is ever built, and the edge
      // function re-reads it under the caller's JWT before any ERP call.
      const gate = await approvedTimesheetForPush(timesheetId);
      // ⚑ ONE IDENTITY PER SHEET (Luna r2 BLOCK 3). Every field of this command — INCLUDING the record
      // id and therefore the key — is the gate's own DB-canonical text, never the caller's argument.
      // `approved_timesheet_for_push` casts whatever spelling it is given to `uuid` and returns the
      // canonical one; everything downstream compares that id as TEXT (the outbox `pmo_record_id`, the
      // `ts-correct:` advisory lock, the one-in-flight index, external_refs). Keying off the raw
      // argument therefore made one sheet TWO identities — the foreground row keyed `ts:<UPPER>:…`
      // while the sweep searched `ts:<lower>:…`, so the sweep minted a SECOND command and ERPNext
      // received the week twice. (The served boundary re-derives both from the same gate, so this is
      // defence in depth, not the only enforcement point.)
      await dispatchDomainCommand(
        'timesheets',
        'create',
        {
          id: gate.timesheet_id,
          erp_doc_kind: 'timesheet',
          user_id: gate.user_id,
          approved_at: gate.approved_at,
          entries: gate.entries,
        },
        { idempotencyKey: timesheetPushKey(gate.timesheet_id, gate.approved_at) },
      );
    }),
};
