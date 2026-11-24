import type { TFunction } from 'i18next';
import { matchNotificationTitle } from './notificationTitles';
import type { Json } from '@/src/lib/supabase/database.types';
import { formatIsoDay } from '@/src/lib/format';
import { withEnglishOrgTerms } from './orgTerms';

type NotificationCopy = {
  body: string | null;
  message_key: string | null;
  message_params: Json | null;
  title?: string | null;
  metadata?: Json | null;
};

/** Titles whose body carries a person's words (a comment, a return or refusal reason, a task note): never rewritten. */
const PERSON_TEXT_TITLE = /^(mentioned|taskAssigned)$|(Returned|Rejected|Refused)$/;

/** A body the database wrote itself (its title is one of the fixed system titles) names terms in shipped English. A person's
 *  words and a title nobody recognises are never rewritten. */
function isSystemBody(row: NotificationCopy): boolean {
  const title = row.title;
  if (!title || row.message_key !== null && row.message_key !== 'literal') return false;
  const key = NOTIFICATION_TITLE_KEYS[title];
  if (key) return !PERSON_TEXT_TITLE.test(key);
  return matchNotificationTitle(title) !== null;
}

function getMetadataEntityType(metadata: Json | null | undefined): string | null {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const entity = (metadata as Record<string, unknown>).entity;
    if (entity && typeof entity === 'object' && !Array.isArray(entity)) {
      const type = (entity as Record<string, unknown>).type;
      if (typeof type === 'string') return type;
    }
  }
  return null;
}

function localizeApprovalNotificationBody(row: NotificationCopy, body: string, t: TFunction): string | null {
  // Timesheet APPROVAL / AWAITING week label only. A REJECTED row is deliberately never localized here:
  // 0856 requires a non-blank rejection_reason, so a rejected body is the person's own text — and that text can
  // be byte-identical to the generated label (`Timesheet week of YYYY-MM-DD`), which read-side is indistinguishable
  // from 1562's defensive blank-reason fallback. Root ruling (fix-waiting 4, R-4): keep the stored literal for EVERY
  // rejected body instead of guessing; the rejected title still localizes through `notificationTitle`. Metadata
  // `entity.type = 'timesheet'` alone is not an identity here, because it cannot tell an approval from a rejection.
  const timesheetMatch = /^Timesheet week of (\d{4}-\d{2}-\d{2})$/.exec(body);
  const isTimesheetApprovalProducer =
    row.title === 'Your timesheet was approved' || row.title === 'Timesheet awaiting your approval';
  if (timesheetMatch && isTimesheetApprovalProducer) {
    const iso = timesheetMatch[1];
    const formattedDate = formatIsoDay(iso) !== '—' ? formatIsoDay(iso) : iso;
    return t('notifications:timesheetWeek', 'Timesheet week of {{date}}', { date: formattedDate });
  }

  // Quantity change request (QCR, 1176/1177) awaiting, approved, returned prefix and the client decision.
  // The titles are the ones 1176/1177 write; the metadata type is the identity `notify_workflow_user` stamps.
  const isQcrProducer =
    row.title === 'Quantity change request awaiting approval' ||
    row.title === 'Quantity change request approved' ||
    row.title === 'Quantity change request returned' ||
    row.title === 'Quantity change accepted by the client' ||
    row.title === 'Quantity change declined by the client' ||
    getMetadataEntityType(row.metadata) === 'quantity_change_request';
  if (isQcrProducer) {
    if (body === 'A quantity change request has been submitted for your approval.') {
      return t('notifications:qcrAwaitingBody', 'A quantity change request has been submitted for your approval.');
    }
    if (body === 'Your quantity change request was approved internally. Record when it is sent to the client.') {
      return t('notifications:qcrApprovedBody', 'Your quantity change request was approved internally. Record when it is sent to the client.');
    }
    // 1177:189-191 qcr_record_decision — the client accepted (a quantity DID change) or declined (none did).
    if (body === 'The contract quantities were updated.') {
      return t('notifications:qcrClientAcceptedBody', 'The contract quantities were updated.');
    }
    if (body === 'No quantity was changed.') {
      return t('notifications:qcrClientDeclinedBody', 'No quantity was changed.');
    }
    const qcrReturnedMatch = /^Your quantity change request was returned: ([\s\S]+)$/.exec(body);
    if (qcrReturnedMatch) {
      return t('notifications:qcrReturnedBody', 'Your quantity change request was returned: {{reason}}', { reason: qcrReturnedMatch[1] });
    }
  }

  return null;
}

/** Old and unrecognised records keep their original body. Parameters are always user text. */
export function notificationBody(row: NotificationCopy, t: TFunction, locale?: string): string | null {
  const body = notificationBodyText(row, t);
  return body !== null && locale && isSystemBody(row) ? withEnglishOrgTerms(body, locale) : body;
}

function notificationBodyText(row: NotificationCopy, t: TFunction): string | null {
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
    case 'leaveRequestPending': {
      const day = (key: string) => { const v = text(key, ''); return v ? formatIsoDay(v) : ''; };
      return t('notifications:leaveRequestPending', 'A leave request needs your decision: {{person}}, {{type}}, {{from}} to {{to}}.', {
        person: text('person', ''), type: text('type', ''), from: day('from'), to: day('to'),
      });
    }
    case 'literal': {
      if (row.body === null) return null;
      const rawBody = text('body', row.body);
      return localizeApprovalNotificationBody(row, rawBody, t) ?? t('notifications:literal', '{{body}}', { body: rawBody });
    }
    default: {
      if (row.body !== null) {
        return localizeApprovalNotificationBody(row, row.body, t) ?? row.body;
      }
      return null;
    }
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
  "Leave request needs your decision": "leaveRequestPending",
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
