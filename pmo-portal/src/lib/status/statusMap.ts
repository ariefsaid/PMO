import type { StatusVariant } from '@/src/components/ui/StatusPill';

/**
 * THE status vocabulary (ux/1110 F1a): one map per record type from the STORED state to its label
 * and tone. Lists, records, filters, menus and `StatusPill` all read it, so one state has one name
 * and one colour on every screen.
 *
 * Tone is the screen rule ("status colour means exception only"):
 *   neutral    = normal / in flight / terminal-neutral (grey)
 *   waiting    = due soon, or waiting on someone       (amber)
 *   exception  = overdue, over budget, rejected, failed (red)
 *   done       = finished well                         (green)
 *
 * Labels are literal `t('status:...')` calls so the catalogue gates see every key; the stored
 * state is DATA and never changes. Categorical pills (company type, CRM activity kind, severity,
 * role) are not states and stay in `statusVariants.ts`.
 */
export type StatusTone = 'neutral' | 'waiting' | 'exception' | 'done';

/** The translator shape every `t` satisfies (react-i18next's `TFunction` included). */
export type StatusTranslate = (key: string, defaultValue: string) => string;

interface StatusEntry { tone: StatusTone; label: (t: StatusTranslate) => string }

const e = (tone: StatusTone, label: StatusEntry['label']): StatusEntry => ({ tone, label });

export const STATUS_MAP = {
  project: {
    Leads: e('neutral', (t) => t('status:project.leads', 'Leads')),
    'PQ Submitted': e('neutral', (t) => t('status:project.pqSubmitted', 'PQ submitted')),
    'Quotation Submitted': e('neutral', (t) => t('status:project.quotationSubmitted', 'Quotation submitted')),
    'Tender Submitted': e('neutral', (t) => t('status:project.tenderSubmitted', 'Tender submitted')),
    Negotiation: e('neutral', (t) => t('status:project.negotiation', 'Negotiation')),
    'Won, Pending KoM': e('done', (t) => t('status:project.wonPendingKom', 'Won, pending kickoff')),
    'Ongoing Project': e('neutral', (t) => t('status:project.ongoing', 'Ongoing')),
    'Internal Project': e('neutral', (t) => t('status:project.internal', 'Internal')),
    'On Hold': e('waiting', (t) => t('status:project.onHold', 'On hold')),
    'Close Out': e('done', (t) => t('status:project.closeOut', 'Close-out')),
    'Loss Tender': e('neutral', (t) => t('status:project.lost', 'Lost')),
    Declined: e('neutral', (t) => t('status:project.declined', 'Declined')),
  },
  procurement: {
    Draft: e('neutral', (t) => t('status:procurement.draft', 'Draft')),
    Requested: e('waiting', (t) => t('status:procurement.requested', 'Requested')),
    Approved: e('done', (t) => t('status:procurement.approved', 'Approved')),
    'Vendor Quoted': e('neutral', (t) => t('status:procurement.vendorQuoted', 'Supplier quote')),
    'Quote Selected': e('neutral', (t) => t('status:procurement.quoteSelected', 'Quote selected')),
    Ordered: e('neutral', (t) => t('status:procurement.ordered', 'Purchase order')),
    Received: e('neutral', (t) => t('status:procurement.received', 'Goods receipt')),
    'Vendor Invoiced': e('neutral', (t) => t('status:procurement.vendorInvoiced', 'Supplier invoice')),
    Paid: e('done', (t) => t('status:procurement.paid', 'Paid')),
    Rejected: e('exception', (t) => t('status:procurement.rejected', 'Rejected')),
    Cancelled: e('neutral', (t) => t('status:procurement.cancelled', 'Cancelled')),
  },
  expense: {
    Draft: e('neutral', (t) => t('status:expense.draft', 'Draft')),
    Submitted: e('waiting', (t) => t('status:expense.submitted', 'Submitted')),
    Approved: e('done', (t) => t('status:expense.approved', 'Approved')),
    Rejected: e('exception', (t) => t('status:expense.rejected', 'Rejected')),
    Paid: e('done', (t) => t('status:expense.paid', 'Paid')),
    Cancelled: e('neutral', (t) => t('status:expense.cancelled', 'Cancelled')),
  },
  imprest: {
    Draft: e('neutral', (t) => t('status:imprest.draft', 'Draft')),
    Submitted: e('waiting', (t) => t('status:imprest.submitted', 'Submitted')),
    Requested: e('waiting', (t) => t('status:imprest.requested', 'Requested')),
    Approved: e('done', (t) => t('status:imprest.approved', 'Approved')),
    Rejected: e('exception', (t) => t('status:imprest.rejected', 'Rejected')),
    Paid: e('done', (t) => t('status:imprest.paid', 'Paid')),
    Cancelled: e('neutral', (t) => t('status:imprest.cancelled', 'Cancelled')),
    Active: e('neutral', (t) => t('status:imprest.active', 'Active')),
  },
  timesheet: {
    Draft: e('neutral', (t) => t('status:timesheet.draft', 'Draft')),
    Submitted: e('waiting', (t) => t('status:timesheet.submitted', 'Submitted')),
    Approved: e('done', (t) => t('status:timesheet.approved', 'Approved')),
    Rejected: e('exception', (t) => t('status:timesheet.rejected', 'Returned')),
  },
  equipmentUsage: {
    Draft: e('neutral', (t) => t('status:equipmentUsage.draft', 'Draft')),
    Submitted: e('waiting', (t) => t('status:equipmentUsage.submitted', 'Submitted')),
    Approved: e('done', (t) => t('status:equipmentUsage.approved', 'Approved')),
    Rejected: e('exception', (t) => t('status:equipmentUsage.rejected', 'Rejected')),
  },
  task: {
    'To Do': e('neutral', (t) => t('status:task.toDo', 'To do')),
    'In Progress': e('neutral', (t) => t('status:task.inProgress', 'In progress')),
    Blocked: e('exception', (t) => t('status:task.blocked', 'Blocked')),
    Done: e('done', (t) => t('status:task.done', 'Done')),
  },
  incident: {
    Open: e('neutral', (t) => t('status:incident.open', 'Open')),
    Investigating: e('neutral', (t) => t('status:incident.investigating', 'Investigating')),
    Closed: e('done', (t) => t('status:incident.closed', 'Closed')),
  },
  document: {
    Draft: e('neutral', (t) => t('status:document.draft', 'Draft')),
    Issued: e('neutral', (t) => t('status:document.issued', 'Issued')),
    Approved: e('done', (t) => t('status:document.approved', 'Approved')),
    Superseded: e('neutral', (t) => t('status:document.superseded', 'Superseded')),
    Archived: e('neutral', (t) => t('status:document.archived', 'Archived')),
  },
  salesInvoice: {
    Draft: e('neutral', (t) => t('status:salesInvoice.draft', 'Draft')),
    Submitted: e('waiting', (t) => t('status:salesInvoice.submitted', 'Submitted')),
    Unpaid: e('waiting', (t) => t('status:salesInvoice.unpaid', 'Unpaid')),
    PartlyPaid: e('waiting', (t) => t('status:salesInvoice.partlyPaid', 'Partly paid')),
    Overdue: e('exception', (t) => t('status:salesInvoice.overdue', 'Overdue')),
    Paid: e('done', (t) => t('status:salesInvoice.paid', 'Paid')),
    Cancelled: e('neutral', (t) => t('status:salesInvoice.cancelled', 'Cancelled')),
  },
  receipt: {
    Scheduled: e('neutral', (t) => t('status:receipt.expected', 'Expected')),
    Paid: e('done', (t) => t('status:receipt.received', 'Received')),
    Received: e('done', (t) => t('status:receipt.received', 'Received')),
    Cancelled: e('neutral', (t) => t('status:receipt.cancelled', 'Cancelled')),
  },
  budgetVersion: {
    Draft: e('neutral', (t) => t('status:budgetVersion.draft', 'Draft')),
    Active: e('done', (t) => t('status:budgetVersion.active', 'Active')),
    Archived: e('neutral', (t) => t('status:budgetVersion.archived', 'Archived')),
  },
  stockDocument: {
    Draft: e('neutral', (t) => t('status:stockDocument.draft', 'Draft')),
    Posted: e('done', (t) => t('status:stockDocument.posted', 'Posted')),
    Cancelled: e('neutral', (t) => t('status:stockDocument.cancelled', 'Cancelled')),
  },
  workOrder: {
    Draft: e('neutral', (t) => t('status:workOrder.draft', 'Draft')),
    Issued: e('neutral', (t) => t('status:workOrder.issued', 'Issued')),
    Closed: e('done', (t) => t('status:workOrder.closed', 'Closed')),
    Cancelled: e('neutral', (t) => t('status:workOrder.cancelled', 'Cancelled')),
  },
  acceptance: {
    Draft: e('neutral', (t) => t('status:acceptance.draft', 'Draft')),
    Confirmed: e('done', (t) => t('status:acceptance.confirmed', 'Confirmed')),
    Withdrawn: e('neutral', (t) => t('status:acceptance.withdrawn', 'Withdrawn')),
  },
  costVariation: {
    Requested: e('waiting', (t) => t('status:costVariation.requested', 'Requested')),
    Approved: e('done', (t) => t('status:costVariation.approved', 'Approved')),
    Revised: e('done', (t) => t('status:costVariation.revised', 'Revised')),
    Rejected: e('exception', (t) => t('status:costVariation.rejected', 'Rejected')),
    Disputed: e('exception', (t) => t('status:costVariation.disputed', 'Disputed')),
  },
  tmClaim: {
    Draft: e('neutral', (t) => t('status:tmClaim.draft', 'Draft')),
    AwaitingConfirmation: e('waiting', (t) => t('status:tmClaim.awaiting', 'Awaiting confirmation')),
    SignedOff: e('done', (t) => t('status:tmClaim.signedOff', 'Signed off')),
    Withdrawn: e('neutral', (t) => t('status:tmClaim.withdrawn', 'Withdrawn')),
  },
  billingMilestone: {
    unknown: e('waiting', (t) => t('status:billingMilestone.unknown', 'Date unknown')),
    planned: e('neutral', (t) => t('status:billingMilestone.planned', 'Planned')),
    'in-progress': e('neutral', (t) => t('status:billingMilestone.inProgress', 'In progress')),
    invoiced: e('neutral', (t) => t('status:billingMilestone.invoiced', 'Invoiced')),
    paid: e('done', (t) => t('status:billingMilestone.paid', 'Paid')),
    overInvoiced: e('exception', (t) => t('status:billingMilestone.overInvoiced', 'Over-invoiced')),
  },
  push: {
    pending: e('neutral', (t) => t('status:push.pending', 'Queued')),
    pushing: e('neutral', (t) => t('status:push.pushing', 'Sending')),
    pushed: e('done', (t) => t('status:push.pushed', 'Posted')),
    failed: e('exception', (t) => t('status:push.failed', 'Failed')),
    held: e('waiting', (t) => t('status:push.held', 'Needs a decision')),
    'never-pushed': e('exception', (t) => t('status:push.neverPushed', 'Never sent')),
    'unstamped-activation': e('exception', (t) => t('status:push.unstamped', 'Not sent at activation')),
    'cancelled-in-erp': e('neutral', (t) => t('status:push.cancelledInErp', 'Cancelled in the accounting system')),
  },
  connection: {
    connected: e('done', (t) => t('status:connection.connected', 'Connected')),
    disconnected: e('neutral', (t) => t('status:connection.disconnected', 'Not connected')),
    unverified: e('neutral', (t) => t('status:connection.unverified', 'Not checked recently')),
    unknown: e('neutral', (t) => t('status:connection.unknown', 'Connection state unavailable')),
    'not-activated': e('waiting', (t) => t('status:connection.notActivated', 'Choose a company')),
    degraded: e('waiting', (t) => t('status:connection.degraded', 'Needs attention')),
    'credential-expiring': e('waiting', (t) => t('status:connection.expiring', 'Key expires soon')),
    unreachable: e('exception', (t) => t('status:connection.unreachable', 'Unreachable')),
    'credential-rejected': e('exception', (t) => t('status:connection.keyRejected', 'Key rejected')),
  },
  odooOutcome: {
    confirmed: e('done', (t) => t('status:odooOutcome.confirmed', 'In Odoo')),
    pending: e('neutral', (t) => t('status:odooOutcome.pending', 'Sent, waiting for Odoo')),
    held: e('waiting', (t) => t('status:odooOutcome.held', 'Needs a decision')),
    'needs-attention': e('waiting', (t) => t('status:odooOutcome.needsAttention', 'Check in Odoo')),
    refused: e('exception', (t) => t('status:odooOutcome.refused', 'Odoo did not accept it')),
  },
  ledgerFreshness: {
    fresh: e('done', (t) => t('status:ledgerFreshness.fresh', 'Up to date')),
    stale: e('waiting', (t) => t('status:ledgerFreshness.stale', 'Not updated for over 30 minutes')),
    'catching-up': e('neutral', (t) => t('status:ledgerFreshness.catchingUp', 'Still reading Odoo history')),
    unavailable: e('exception', (t) => t('status:ledgerFreshness.unavailable', 'Odoo not reachable, showing the last data')),
  },
  ledgerCheck: {
    matches: e('done', (t) => t('status:ledgerCheck.matches', 'Matches Odoo')),
    'not-checked': e('neutral', (t) => t('status:ledgerCheck.notChecked', 'Not checked against Odoo')),
    'out-of-date': e('waiting', (t) => t('status:ledgerCheck.outOfDate', 'Check is out of date')),
    differs: e('exception', (t) => t('status:ledgerCheck.differs', 'Differs from Odoo')),
  },
  budgetHealth: {
    'on-track': e('neutral', (t) => t('status:budgetHealth.onTrack', 'On track')),
    unavailable: e('neutral', (t) => t('status:budgetHealth.unavailable', 'Unavailable')),
    'at-risk': e('waiting', (t) => t('status:budgetHealth.atRisk', 'At risk')),
    'over-budget': e('exception', (t) => t('status:budgetHealth.overBudget', 'Over budget')),
  },
  due: {
    'due-soon': e('waiting', (t) => t('status:due.dueSoon', 'Due soon')),
    overdue: e('exception', (t) => t('status:due.overdue', 'Overdue')),
  },
  importRow: {
    valid: e('done', (t) => t('status:importRow.valid', 'Valid')),
    skipped: e('exception', (t) => t('status:importRow.skipped', 'Skipped')),
  },
  user: {
    Active: e('neutral', (t) => t('status:user.active', 'Active')),
    Disabled: e('neutral', (t) => t('status:user.disabled', 'Disabled')),
  },
  masterRecord: {
    Active: e('neutral', (t) => t('status:masterRecord.active', 'Active')),
    Inactive: e('neutral', (t) => t('status:masterRecord.inactive', 'Inactive')),
    DeletedInOdoo: e('exception', (t) => t('status:masterRecord.deletedInOdoo', 'Deleted in Odoo')),
  },
} as const satisfies Record<string, Record<string, StatusEntry>>;

export type StatusRecord = keyof typeof STATUS_MAP;
/** Every stored state the map knows for a record type. */
export type StatusState<R extends StatusRecord> = keyof (typeof STATUS_MAP)[R] & string;

/** Tone → the `StatusPill` variant that paints it. Exception is red for overdue too: no amber overdue. */
const TONE_VARIANT: Record<StatusTone, StatusVariant> = {
  neutral: 'neutral',
  waiting: 'warn',
  exception: 'lost',
  done: 'won',
};

export function toneVariant(tone: StatusTone): StatusVariant {
  return TONE_VARIANT[tone];
}

function entryFor(record: StatusRecord, state: string): StatusEntry | undefined {
  const states: Record<string, StatusEntry> = STATUS_MAP[record];
  return Object.hasOwn(states, state) ? states[state] : undefined;
}

/** Tone of a state. An unknown state is neutral: never red or green by accident. */
export function statusTone(record: StatusRecord, state: string): StatusTone {
  return entryFor(record, state)?.tone ?? 'neutral';
}

/** The StatusPill variant for a state (for callers that still pass a `variant`). */
export function statusVariantOf(record: StatusRecord, state: string): StatusVariant {
  return toneVariant(statusTone(record, state));
}

/** The one display name of a state. An unknown state reads as its stored text, untranslated. */
export function statusLabel(record: StatusRecord, state: string, t: StatusTranslate): string {
  return entryFor(record, state)?.label(t) ?? state;
}

/** Every record type, for pickers and the coverage tests. */
export const STATUS_RECORDS = Object.keys(STATUS_MAP) as StatusRecord[];
