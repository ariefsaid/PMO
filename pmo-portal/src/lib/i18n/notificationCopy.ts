import type { TFunction } from 'i18next';
import { matchNotificationTitle } from './notificationTitles';
import type { Json } from '@/src/lib/supabase/database.types';
import { formatIsoDay } from '@/src/lib/format';

type NotificationCopy = { body: string | null; message_key: string | null; message_params: Json | null };

/** Old and unrecognised records keep their original body. Parameters are always user text. */
export function notificationBody(row: NotificationCopy, t: TFunction): string | null {
  const params = row.message_params && typeof row.message_params === 'object' && !Array.isArray(row.message_params) ? row.message_params : {};
  const text = (key: string, fallback: string) => typeof params[key] === 'string' ? params[key] : fallback;
  switch (row.message_key) {
    case 'budgetArchiveWarning':
      return t('notifications:budgetArchiveWarning', 'ERPNext may still be enforcing a budget for this project after this archive. Cancel the listed ERPNext Budget documents, or activate a new PMO budget.');
    case 'budgetCancellationHeld':
      return t('notifications:budgetCancellationHeld', "A replacement budget is on hold: an earlier ERPNext budget cancellation for the project still needs a person, or the person who activated this version cannot be identified. Resolve the previous version's budget in ERPNext — the replacement then pushes automatically.");
    case 'budgetRetryAuthorization':
      return t('notifications:budgetRetryAuthorization', "A replacement budget is on hold: the person recorded as having activated the version is no longer allowed to push budgets to ERPNext. The cancellation itself is fine. An Admin or Finance user should retry the push from the project's Budget tab.");
    case 'budgetPushFailed':
      return t('notifications:budgetPushFailed', 'PMO could not push the activated budget to ERPNext ({{reason}}) — ERPNext is still enforcing the previous budget (or none) for this project.', { reason: text('reason', 'unknown error') });
    case 'unassignedInvoice':
      return t('notifications:unassignedInvoice', 'Sales Invoice {{invoice}}{{amount}} arrived from ERPNext without a project and is in the Unassigned bucket. Assign it to a project.', { invoice: text('invoice', ''), amount: text('amount', '') });
    case 'leaveApproved':
    case 'leaveRejected': {
      const day = (key: string) => { const v = text(key, ''); return v ? formatIsoDay(v) : ''; };
      const what = { type: text('type', ''), from: day('from'), to: day('to'), note: text('note', '') };
      const base = row.message_key === 'leaveApproved'
        ? t('notifications:leaveApproved', 'Your leave request was approved: {{type}}, {{from}} to {{to}}.', what)
        : t('notifications:leaveRejected', 'Your leave request was rejected: {{type}}, {{from}} to {{to}}.', what);
      return what.note ? t('notifications:leaveNote', '{{base}} Note: {{note}}', { base, note: what.note }) : base;
    }
    case 'literal':
      return row.body === null ? null : t('notifications:literal', '{{body}}', { body: text('body', row.body) });
    default: return row.body;
  }
}

/**
 * The fixed English titles the database writes (0237 and later workflow hand-offs), by the catalogue key that carries them in the reader's
 * language. A title not listed (free text, or a count in the wording) is shown as stored. Every new database title is ONE line here.
 */
export const NOTIFICATION_TITLE_KEYS: Record<string, string> = {
  "A task was assigned to you": "taskAssigned",
  "Checkpoint is late": "checkpointLate",
  "Customer invoice awaiting your approval": "invoiceAwaiting",
  "Inspection overdue": "inspectionOverdue",
  "Material usage threshold reached": "usageThreshold",
  "Out-of-plan site cash item awaiting your approval": "imprestOutOfPlan",
  "Procurement awaiting your approval": "procurementAwaiting",
  "Quantity change request approved": "qcrApproved",
  "Quantity change request awaiting approval": "qcrAwaiting",
  "Quantity change request returned": "qcrReturned",
  "Reminder: a task is overdue": "taskOverdue",
  "Site cash plan awaiting your approval": "imprestPlanAwaiting",
  "Timesheet awaiting your approval": "timesheetAwaiting",
  "You were mentioned in a comment": "mentioned",
  "Your procurement was approved": "procurementApproved",
  "Your procurement was rejected": "procurementRejected",
  "Your timesheet was approved": "timesheetApproved",
  "Your timesheet was rejected": "timesheetRejected",
  "Material request awaiting your approval": "mrqAwaiting",
  "Your site cash plan was approved": "imprestPlanApproved",
  "Your site cash plan was rejected": "imprestPlanRejected",
  "Your material request was sent back": "mrqReturned",
  "Your material request was refused": "mrqRefused",
  "Your material request was approved": "mrqApproved",
  "Your daily report was sent back": "dsrReturned",
  "Your subcontract certificate was sent back": "certReturned",
  "Your equipment plan was sent back": "eqpReturned",
  "Your equipment plan was approved": "eqpApproved"
};

export function notificationTitle(row: { title: string; message_key: string | null }, t: TFunction): string {
  if (row.message_key === 'leaveApproved') return t('notifications:leaveApprovedTitle', 'Leave approved');
  if (row.message_key === 'leaveRejected') return t('notifications:leaveRejectedTitle', 'Leave rejected');
  if (row.message_key === 'unassignedInvoice') return t('notifications:unassignedInvoiceTitle', 'Invoice needs a project');
  const key = NOTIFICATION_TITLE_KEYS[row.title];
  if (key) return t(`notifications:title.${key}`, row.title);
  const match = matchNotificationTitle(row.title);
  if (!match) return row.title;
  const { nounKey, ...params } = match.params;
  return t(`notifications:titles.${match.key}`, {
    defaultValue: row.title,
    ...params,
    ...(typeof nounKey === 'string' ? { noun: t(`notifications:${nounKey}`) } : {}),
  });
}
