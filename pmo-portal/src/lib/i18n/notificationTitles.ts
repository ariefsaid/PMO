/**
 * The notification TITLES the database writes in English (`notify_workflow_user`, `insert into notifications`), one entry per
 * template, so the bell can show each in the reader's language. The stored title is the template's identity (the email-event
 * classifier already reads it); a title that matches no entry here is shown as stored.
 *
 * ⚑ Every template a migration writes MUST be listed. `notificationTitles.gate.test.ts` scans the migrations for title
 * literals and fails on one this registry does not know, and checks each entry has English and Bahasa Indonesia text.
 * Parameters are words the template carries (a number of days, a noun phrase from a closed list), never user text.
 */
export interface NotificationTitleMatch { key: string; params: Record<string, string | number> }

/** Exact titles. The key is `notifications:titles.<key>`. */
export const NOTIFICATION_TITLES: Record<string, string> = {
  'A task was assigned to you': 'taskAssigned',
  'Reminder: a task is overdue': 'taskOverdueReminder',
  'Issue is overdue': 'issueOverdue',
  'Checkpoint is late': 'checkpointLate',
  'Client reserved material': 'clientReserved',
  'Contract quantity exceeded': 'contractQuantityExceeded',
  'Customer invoice awaiting your approval': 'customerInvoiceApproval',
  'Inspection overdue': 'inspectionOverdue',
  'Material usage threshold reached': 'materialUsageThreshold',
  'Material request awaiting your approval': 'materialRequestApproval',
  'Out-of-plan site cash item awaiting your approval': 'outOfPlanSiteCash',
  'Procurement awaiting your approval': 'procurementApproval',
  'Quantity change request approved': 'quantityChangeApproved',
  'Quantity change request awaiting approval': 'quantityChangeApproval',
  'Quantity change request returned': 'quantityChangeReturned',
  'Quantity change accepted by the client': 'quantityChangeAccepted',
  'Quantity change declined by the client': 'quantityChangeDeclined',
  'Site cash plan awaiting your approval': 'siteCashPlanApproval',
  'Timesheet awaiting your approval': 'timesheetApproval',
  'You were mentioned in a comment': 'commentMention',
  'Your procurement was approved': 'procurementApproved',
  'Your procurement was rejected': 'procurementRejected',
  'Your timesheet was approved': 'timesheetApproved',
  'Your timesheet was rejected': 'timesheetRejected',
  'Supplier marked at risk': 'supplierAtRisk',
  'Supplier marked inactive': 'supplierInactive',
  'Billing step is overdue': 'billingStepOverdue',
  'Work is done but not yet claimed': 'doneNotClaimed',
  'Action required': 'actionRequired',
};

/** The two expense-style nouns the producers use (kind-dependent), in the form each title carries. */
const NOUNS: Record<string, string> = {
  'Expense claim': 'expenseClaim', 'Cash advance': 'cashAdvance', 'Site float funding': 'siteFloatFunding', 'Site cash replenishment': 'siteCashReplenishment',
};
const LOWER_NOUNS: Record<string, string> = Object.fromEntries(Object.entries(NOUNS).map(([en, key]) => [en.toLowerCase(), key]));

/** The templates whose title carries a closed word or a number. Returns the matching key and its parameters. */
export function matchNotificationTitle(title: string): NotificationTitleMatch | null {
  const exact = NOTIFICATION_TITLES[title];
  if (exact) return { key: exact, params: {} };
  let m = /^Equipment down more than (\d+) days?$/.exec(title);
  if (m) return { key: 'equipmentDown', params: { count: Number(m[1]) } };
  m = /^(.+) expires in (\d+) days?$/.exec(title);
  if (m) return { key: 'documentExpires', params: { type: m[1], count: Number(m[2]) } };
  m = /^(Expense claim|Cash advance|Site float funding|Site cash replenishment) (awaiting your approval|ready to pay|requested|submitted|approved|rejected|paid)$/.exec(title);
  if (m) return { key: `noun_${m[2].replaceAll(' ', '_')}`, params: { nounKey: `nouns.${NOUNS[m[1]]}` } };
  m = /^Your (expense claim|cash advance|site float funding|site cash replenishment) was (approved|rejected|paid)$/.exec(title);
  if (m) return { key: `your_${m[2]}`, params: { nounKey: `nounsLower.${LOWER_NOUNS[m[1]]}` } };
  m = /^Your site cash plan was (\w+)$/.exec(title);
  if (m && ['approved', 'rejected', 'submitted', 'cancelled', 'draft', 'returned'].includes(m[1])) return { key: `sitePlan_${m[1]}`, params: {} };
  return null;
}

/** Every key the matcher can return, for the gate: a template with no text in both languages fails. */
export const NOTIFICATION_TITLE_KEYS: string[] = [
  ...Object.values(NOTIFICATION_TITLES), 'equipmentDown', 'documentExpires',
  ...['awaiting_your_approval', 'ready_to_pay', 'requested', 'submitted', 'approved', 'rejected', 'paid'].map((s) => `noun_${s}`),
  ...['approved', 'rejected', 'paid'].map((s) => `your_${s}`),
  ...['approved', 'rejected', 'submitted', 'cancelled', 'draft', 'returned'].map((s) => `sitePlan_${s}`),
];
export const NOTIFICATION_NOUN_KEYS = Object.values(NOUNS);
