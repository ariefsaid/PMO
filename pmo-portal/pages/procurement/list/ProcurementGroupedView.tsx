import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { ProcurementListColumns, ProcurementListRow } from '../ProcurementListRow';
import { groupProcurements, totalsByCurrency, type ProcurementListRole } from './model';
import { MoneyTotalLines } from './MoneyTotalLines';
import { NeedsYouReason } from './NeedsYouReason';

interface ProcurementGroupedViewProps {
  rows: ProcurementWithRefs[];
  role: ProcurementListRole;
  reasonText: ReadonlyMap<string, string>;
}

const GROUPS = [
  { key: 'needs-approval', label: 'group.needsApproval', fallback: 'Needs approval' },
  { key: 'in-progress', label: 'group.inProgress', fallback: 'In progress' },
  { key: 'invoiced', label: 'group.invoiced', fallback: 'Invoiced, not paid' },
  { key: 'done', label: 'group.done', fallback: 'Done' },
] as const;

export const ProcurementGroupedView: React.FC<ProcurementGroupedViewProps> = ({ rows, role, reasonText }) => {
  const { t } = useTranslation('procurementList');
  const groups = groupProcurements(rows);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card" aria-label={t('grouped.label', 'Procurements grouped by next step')}>
      {groups.map((group, index) => {
        const basis = group.key === 'invoiced' ? 'pay' : 'most-real';
        const totals = totalsByCurrency(group.rows, role, basis);
        const tooltip = t(role === 'Engineer' ? 'money.engineer' : basis === 'pay' ? 'money.pay' : 'money.mostReal',
          role === 'Engineer'
            ? 'Request amount only. Supplier invoice and payment amounts are not shown.'
            : basis === 'pay'
              ? 'Supplier invoices use the unpaid balance. Kept in each procurement currency.'
              : 'Most real amount per procurement: paid, then supplier invoice, then purchase order, then request. Summed by currency.');
        const label = t(GROUPS[index].label, GROUPS[index].fallback);
        return (
          <section key={group.key} aria-labelledby={`group-title-${group.key}`} className={index > 0 ? 'border-t border-border' : ''}>
            <header className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3 md:px-4">
              <div className="flex min-w-0 items-baseline gap-2.5">
                <h2 id={`group-title-${group.key}`} className="text-[14px] font-semibold">{label}</h2>
                <span data-testid={`group-count-${group.key}`} className="tabular text-[13px] text-muted-foreground">{group.rows.length}</span>
              </div>
              <MoneyTotalLines totals={totals} tooltip={tooltip} testId={`group-total-${group.key}`} className="items-end" />
            </header>
            {group.rows.length > 0 ? (
              <div>
                <ProcurementListColumns />
                {group.rows.map((row) => (
                  <React.Fragment key={row.id}>
                    {reasonText.has(row.id) && <NeedsYouReason id={row.id} text={reasonText.get(row.id) as string} />}
                    <ProcurementListRow row={row} />
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <p className="px-3.5 pb-3 text-[13px] text-muted-foreground">{t('group.empty', 'No procurements in this group.')}</p>
            )}
          </section>
        );
      })}
    </div>
  );
};
