import { formatDay, formatTileMoney } from '@/src/lib/format';
import { invoiceGross } from '@/src/lib/revenue/nativeInvoice';
import type { ApprovalPopulationEntry } from '@/src/lib/selectors/approvals';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { ExpenseClaimAwaiting } from '@/src/hooks/useExpenseClaims';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { WaitingStep } from '@/src/lib/repositories/materialRequests';
import type { LeaveRequestRow } from '@/src/lib/db/leave';
import type { WaitingDecisionRow } from '@/src/lib/db/waitingDecisions';
import { isDatabaseListedKind, scopeLabelText, WAITING_KIND_META } from '@/src/lib/approvals/waitingKinds';

export interface ApprovalItem { key: string; what: string; who: string | null; amount: string | null; days: number | null; href: string }

const daysSince = (iso: string | null | undefined, now: number) => {
  if (!iso) return null;
  const time = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).getTime();
  return Number.isFinite(time) ? Math.max(0, Math.floor((now - time) / 86400000)) : null;
};

/** One approval as what · who · amount · how long it has waited, linked to where it is decided. */
export function approvalItem(entry: ApprovalPopulationEntry, t: (key: string, fallback: string, options?: Record<string, unknown>) => string, now = Date.now()): ApprovalItem {
  const days = daysSince(entry.createdAt, now);
  const money = (amount: number | null | undefined, currency: string) => (amount == null ? null : formatTileMoney(amount, currency) ?? null);
  switch (entry.kind) {
    case 'procurement': {
      const row = entry.row as ProcurementWithRefs;
      return { key: entry.key, what: row.title, who: row.requested_by?.full_name ?? null, amount: money(row.total_value, row.currency), days, href: `/procurement/${row.id}` };
    }
    case 'expense': {
      const { claim } = entry.row as ExpenseClaimAwaiting;
      return { key: entry.key, what: claim.title, who: claim.claimant?.full_name ?? null, amount: money(claim.amount, claim.float?.currency ?? claim.currency), days, href: `/expenses/${claim.id}` };
    }
    case 'invoice': {
      const row = entry.row as SalesInvoiceRow;
      const name = [row.pmo_number, row.customer_name].filter(Boolean).join(' · ');
      return { key: entry.key, what: name || t('home.approvalInvoice', 'Client invoice'), who: null, amount: money(invoiceGross(row), row.currency), days, href: `/sales-invoices/${row.id}` };
    }
    case 'material': {
      const step = entry.row as WaitingStep;
      return { key: entry.key, what: t('home.approvalMaterial', 'Material request, step {{n}}: {{label}}', { n: step.stepPosition, label: step.label }), who: null, amount: null, days, href: `/material-requests/${step.requestId}` };
    }
    case 'leave': {
      const row = entry.row as LeaveRequestRow;
      return { key: entry.key, what: t('home.approvalLeave', '{{name}}: leave {{from}} to {{to}}', { name: row.person_name, from: formatDay(row.start_date), to: formatDay(row.end_date) }), who: null, amount: null, days, href: '/approvals?scope=leave' };
    }
    case 'imprest': {
      const row = entry.row as { id: string; float_id: string; number?: string | null; month?: string | null };
      return { key: entry.key, what: row.number ?? t('home.approvalImprest', 'Site cash plan {{month}}', { month: row.month ? formatDay(row.month) : '' }), who: null, amount: null, days, href: `/imprest/${row.float_id}` };
    }
    case 'timesheets': {
      const row = entry.row as TimesheetAwaitingApproval;
      // Whose timesheet and which week, so two rows from one person are told apart.
      const owner = row.owner?.full_name;
      const what = owner
        ? t('home.approvalTimesheetOf', "{{name}}'s timesheet, week of {{week}}", { name: owner, week: formatDay(row.week_start_date) })
        : t('home.approvalTimesheetWeek', 'Timesheet, week of {{week}}', { week: formatDay(row.week_start_date) });
      return { key: entry.key, what, who: null, amount: null, days, href: '/approvals?scope=timesheets' };
    }
    default: {
      if (!isDatabaseListedKind(entry.kind)) throw new Error(`approvalItem: kind ${entry.kind} has no row mapping`);
      const row = entry.row as WaitingDecisionRow;
      const meta = WAITING_KIND_META[entry.kind];
      return { key: entry.key, what: `${scopeLabelText(entry.kind, (key, fallback) => t(key.includes(':') ? key : `common:${key}`, fallback))}: ${row.title}`, who: null, amount: null, days, href: meta.href ? meta.href(row.recordId) : '/approvals' };
    }
  }
}
