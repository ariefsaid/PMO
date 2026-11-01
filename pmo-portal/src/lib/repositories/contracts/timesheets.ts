/** Timesheet repository contract. */
import type { saveTimesheetWeek } from '@/src/lib/db/timesheets';
import type {
  reopenTimesheet,
  attestTimesheetNoErpDocument,
  listReopenableApprovedTimesheets,
} from '@/src/lib/db/timesheetTransition';
import type { listPushesNeedingAttention, confirmEmployeeLink, getPushState } from '@/src/lib/db/timesheetPush';
import type { TimesheetRow, TimesheetWithEntries } from '@/src/lib/db/timesheets';
import type { TimesheetApprovalViewerRole, TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';
import type { EntryUpsert } from '@/src/lib/timesheet-edit';

export interface TimesheetRepository {
  saveWeek: typeof saveTimesheetWeek;
  reopen: typeof reopenTimesheet;
  attestNoErpDocument: typeof attestTimesheetNoErpDocument;
  listReopenableApproved: typeof listReopenableApprovedTimesheets;
  listPushesNeedingAttention: typeof listPushesNeedingAttention;
  confirmEmployeeLink: typeof confirmEmployeeLink;
  getPushState: typeof getPushState;

  list(userId: string): Promise<TimesheetWithEntries[]>;
  createDraft(weekStartDate: string, userId: string): Promise<TimesheetRow>;
  upsertEntries(entries: EntryUpsert[]): Promise<void>;
  deleteEntry(id: string): Promise<void>;
  submit(id: string): Promise<void>;
  approve(id: string, notes?: string): Promise<void>;
  reject(id: string, notes?: string): Promise<void>;
  listAwaitingApproval(
    selfId: string,
    viewerRole: TimesheetApprovalViewerRole | null,
  ): Promise<TimesheetAwaitingApproval[]>;
  /** P3b (FR-TSP-005/041): push an already-APPROVED sheet to the org's external system. A no-op when
   *  the org does not employ one for `timesheets` — never a rejection (the approval already committed). */
  pushApproved(timesheetId: string): Promise<void>;
}
