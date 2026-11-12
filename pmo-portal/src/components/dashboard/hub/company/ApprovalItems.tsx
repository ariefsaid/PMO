import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/src/components/ui/icons';
import { formatTileMoney } from '@/src/lib/format';
import { invoiceGross } from '@/src/lib/revenue/nativeInvoice';
import type { ApprovalPopulationEntry } from '@/src/lib/selectors/approvals';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { ExpenseClaimAwaiting } from '@/src/hooks/useExpenseClaims';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

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
    default: {
      const row = entry.row as TimesheetAwaitingApproval;
      return { key: entry.key, what: t('home.approvalTimesheet', 'Timesheet'), who: row.owner?.full_name ?? null, amount: null, days, href: '/approvals?scope=timesheets' };
    }
  }
}

/** The first approvals as rows inside "Waits on you" (they render as list items of its list). */
export const ApprovalItems: React.FC<{ entries: ApprovalPopulationEntry[]; limit?: number }> = ({ entries, limit = 5 }) => {
  const { t } = useTranslation('dashboard');
  const translate = (key: string, fallback: string, options?: Record<string, unknown>) => t(key, { defaultValue: fallback, ...(options ?? {}) });
  return (
    <>
      {entries.slice(0, limit).map((entry) => {
        const item = approvalItem(entry, translate);
        const waited = item.days === null ? null : t('home.waitingDays', { count: item.days, defaultValue_one: 'waiting {{count}} day', defaultValue_other: 'waiting {{count}} days' });
        return (
          <li key={item.key} data-testid="approval-item">
            <Link to={item.href} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-3 py-2.5 text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <span className="min-w-0">
                <span className="block truncate text-control font-medium">{item.what}</span>
                <span className="block truncate text-control text-muted-foreground">{[item.who, waited].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="text-right text-control font-semibold tabular">{item.amount}</span>
              <Icon name="chev" className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        );
      })}
    </>
  );
};
