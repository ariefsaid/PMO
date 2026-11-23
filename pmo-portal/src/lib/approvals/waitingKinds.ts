/**
 * The ONE registry of everything a login can be asked to decide (fix-waiting item 1).
 * The home "needs you" list, the Approvals badge and the Approvals inbox all read `useWaitingForYou`, which builds its
 * population from this registry. A new kind of decision is ONE entry here plus its read in `useWaitingForYou`; the
 * type below makes a kind with no entry a compile error, and `waitingKinds.test.ts` fails when the list and the inbox
 * sections drift apart.
 */
export const WAITING_KINDS = [
  'procurement', 'timesheets', 'expense', 'invoice', 'material', 'leave', 'imprest',
  'daily_report', 'work_order_issue', 'delivery_record', 'work_order_acceptance', 'transfer_receipt', 'quantity_change',
  'certificate', 'equipment_plan',
] as const;

export type WaitingKind = (typeof WAITING_KINDS)[number];

/** Kinds answered by the database function `my_waiting_decisions()`; the rest keep the read their own screen already uses. */
export const DATABASE_LISTED_KINDS = ['daily_report', 'work_order_issue', 'delivery_record', 'transfer_receipt', 'quantity_change', 'certificate', 'equipment_plan'] as const;
export type DatabaseListedKind = (typeof DATABASE_LISTED_KINDS)[number];

export interface WaitingKindMeta {
  /** Scope / tab label in the inbox: i18n key (common) + English source. */
  scopeKey: string;
  scopeLabel: string;
  /** Where one waiting record opens; undefined for kinds whose rows live in their own inbox section. */
  href?: (recordId: string) => string;
  /** Where the kind's section is in the inbox page (a test hook: every kind is shown somewhere). */
  inboxSection: 'queue' | 'section';
}

export const WAITING_KIND_META: Record<WaitingKind, WaitingKindMeta> = {
  procurement: { scopeKey: 'approvals.scope.procurement', scopeLabel: 'Procurement cases', href: (id) => `/procurement/${id}`, inboxSection: 'queue' },
  timesheets: { scopeKey: 'approvals.scope.timesheets', scopeLabel: 'Timesheets', inboxSection: 'queue' },
  expense: { scopeKey: 'approvals.scope.expense', scopeLabel: 'Expense claims', inboxSection: 'section' },
  invoice: { scopeKey: 'approvals.scope.invoice', scopeLabel: 'Customer invoices', inboxSection: 'section' },
  material: { scopeKey: 'materialRequests:inbox.scope', scopeLabel: 'Material requests', href: (id) => `/material-requests/${id}`, inboxSection: 'section' },
  leave: { scopeKey: 'waitingList:scope.leave', scopeLabel: 'Leave requests', inboxSection: 'section' },
  imprest: { scopeKey: 'waitingList:scope.imprest', scopeLabel: 'Site cash', inboxSection: 'section' },
  daily_report: { scopeKey: 'waitingList:scope.daily_report', scopeLabel: 'Daily reports', href: (id) => `/site-reports/${id}`, inboxSection: 'section' },
  work_order_issue: { scopeKey: 'waitingList:scope.work_order_issue', scopeLabel: 'Work orders to issue', href: (id) => `/work-orders/${id}`, inboxSection: 'section' },
  delivery_record: { scopeKey: 'waitingList:scope.delivery_record', scopeLabel: 'Deliveries to confirm', href: (id) => `/procurement/${id}`, inboxSection: 'section' },
  // Client acceptance (BAST) confirmation is its own read (`acceptances_awaiting_my_confirmation`, 1570), never
  // `delivery_record` — that kind is the PURCHASE receipt. `recordId` is the ACCEPTANCE id; the record it opens is
  // the work order, so the caller must map through `work_order_id` (see `approvalItem`/its inbox section), never
  // use this id as a work-order id.
  work_order_acceptance: { scopeKey: 'waitingList:scope.work_order_acceptance', scopeLabel: 'Client acceptances to confirm', inboxSection: 'section' },
  transfer_receipt: { scopeKey: 'waitingList:scope.transfer_receipt', scopeLabel: 'Transfers to receive', href: (id) => `/stock/transfers/${id}`, inboxSection: 'section' },
  quantity_change: { scopeKey: 'waitingList:scope.quantity_change', scopeLabel: 'Quantity changes', href: (id) => `/quantity-changes/${id}`, inboxSection: 'section' },
  certificate: { scopeKey: 'waitingList:scope.certificate', scopeLabel: 'Subcontract certificates', href: (id) => `/subcontract-certificates/${id}`, inboxSection: 'section' },
  equipment_plan: { scopeKey: 'waitingList:scope.equipment_plan', scopeLabel: 'Equipment plans', href: () => '/equipment-plans', inboxSection: 'section' },
};

export const isDatabaseListedKind = (kind: string): kind is DatabaseListedKind => (DATABASE_LISTED_KINDS as readonly string[]).includes(kind);

/** The scope label's i18n key with its namespace (`common` unless the key names its own), so any screen can resolve it. */
export const scopeKeyWithNamespace = (meta: WaitingKindMeta): string => (meta.scopeKey.includes(':') ? meta.scopeKey : `common:${meta.scopeKey}`);

type Translate = (key: string, defaultValue: string, options?: Record<string, unknown>) => string;

/**
 * The scope / tab label of a kind in the reader's language. One literal `t()` call per kind (not a key built from a variable), so the
 * catalogue gate that finds keys by their call sites sees each of them.
 */
export function scopeLabelText(kind: WaitingKind, t: Translate): string {
  switch (kind) {
    case 'leave': return t('waitingList:scope.leave', 'Leave requests');
    case 'imprest': return t('waitingList:scope.imprest', 'Site cash');
    case 'daily_report': return t('waitingList:scope.daily_report', 'Daily reports');
    case 'work_order_issue': return t('waitingList:scope.work_order_issue', 'Work orders to issue');
    case 'delivery_record': return t('waitingList:scope.delivery_record', 'Deliveries to confirm');
    case 'work_order_acceptance': return t('waitingList:scope.work_order_acceptance', 'Client acceptances to confirm');
    case 'transfer_receipt': return t('waitingList:scope.transfer_receipt', 'Transfers to receive');
    case 'quantity_change': return t('waitingList:scope.quantity_change', 'Quantity changes');
    case 'certificate': return t('waitingList:scope.certificate', 'Subcontract certificates');
    case 'equipment_plan': return t('waitingList:scope.equipment_plan', 'Equipment plans');
    default: return t(WAITING_KIND_META[kind].scopeKey, WAITING_KIND_META[kind].scopeLabel);
  }
}

/** The heading of a kind's inbox section, with the number waiting. */
export function waitingHeadingText(kind: DatabaseListedKind | 'leave' | 'imprest' | 'work_order_acceptance', count: number, t: Translate): string {
  switch (kind) {
    case 'leave': return t('waitingList:heading.leave', 'Leave requests waiting for you ({{count}})', { count });
    case 'imprest': return t('waitingList:heading.imprest', 'Site cash waiting for you ({{count}})', { count });
    case 'daily_report': return t('waitingList:heading.daily_report', 'Daily reports to validate ({{count}})', { count });
    case 'work_order_issue': return t('waitingList:heading.work_order_issue', 'Work orders to issue ({{count}})', { count });
    case 'delivery_record': return t('waitingList:heading.delivery_record', 'Deliveries to confirm ({{count}})', { count });
    case 'work_order_acceptance': return t('waitingList:heading.work_order_acceptance', 'Client acceptances to confirm ({{count}})', { count });
    case 'transfer_receipt': return t('waitingList:heading.transfer_receipt', 'Transfers to receive ({{count}})', { count });
    case 'quantity_change': return t('waitingList:heading.quantity_change', 'Quantity changes to decide ({{count}})', { count });
    case 'certificate': return t('waitingList:heading.certificate', 'Subcontract certificates to approve ({{count}})', { count });
    case 'equipment_plan': return t('waitingList:heading.equipment_plan', 'Equipment plans to approve ({{count}})', { count });
  }
}
