/**
 * The ONE registry of everything a login can be asked to decide (fix-waiting item 1).
 * The home "needs you" list, the Approvals badge and the Approvals inbox all read `useWaitingForYou`, which builds its
 * population from this registry. A new kind of decision is ONE entry here plus its read in `useWaitingForYou`; the
 * type below makes a kind with no entry a compile error, and `waitingKinds.test.ts` fails when the list and the inbox
 * sections drift apart.
 */
export const WAITING_KINDS = [
  'procurement', 'timesheets', 'expense', 'invoice', 'material', 'leave', 'imprest',
  'daily_report', 'work_order_issue', 'delivery_record', 'transfer_receipt', 'quantity_change', 'certificate', 'equipment_plan',
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
  leave: { scopeKey: 'approvals.scope.leave', scopeLabel: 'Leave requests', inboxSection: 'section' },
  imprest: { scopeKey: 'approvals.scope.imprest', scopeLabel: 'Site cash', inboxSection: 'section' },
  daily_report: { scopeKey: 'approvals.scope.daily_report', scopeLabel: 'Daily reports', href: (id) => `/site-reports/${id}`, inboxSection: 'section' },
  work_order_issue: { scopeKey: 'approvals.scope.work_order_issue', scopeLabel: 'Work orders to issue', href: (id) => `/work-orders/${id}`, inboxSection: 'section' },
  delivery_record: { scopeKey: 'approvals.scope.delivery_record', scopeLabel: 'Deliveries to confirm', href: (id) => `/procurement/${id}`, inboxSection: 'section' },
  transfer_receipt: { scopeKey: 'approvals.scope.transfer_receipt', scopeLabel: 'Transfers to receive', href: (id) => `/stock/transfers/${id}`, inboxSection: 'section' },
  quantity_change: { scopeKey: 'approvals.scope.quantity_change', scopeLabel: 'Quantity changes', href: (id) => `/quantity-changes/${id}`, inboxSection: 'section' },
  certificate: { scopeKey: 'approvals.scope.certificate', scopeLabel: 'Subcontract certificates', href: (id) => `/subcontract-certificates/${id}`, inboxSection: 'section' },
  equipment_plan: { scopeKey: 'approvals.scope.equipment_plan', scopeLabel: 'Equipment plans', href: () => '/equipment-plans', inboxSection: 'section' },
};

export const isDatabaseListedKind = (kind: string): kind is DatabaseListedKind => (DATABASE_LISTED_KINDS as readonly string[]).includes(kind);

/** The scope label's i18n key with its namespace (`common` unless the key names its own), so any screen can resolve it. */
export const scopeKeyWithNamespace = (meta: WaitingKindMeta): string => (meta.scopeKey.includes(':') ? meta.scopeKey : `common:${meta.scopeKey}`);
