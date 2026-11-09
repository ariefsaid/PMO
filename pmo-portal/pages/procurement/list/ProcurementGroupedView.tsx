import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { ProcurementListColumns, ProcurementListRowBase, type OpenRecord } from '../ProcurementListRow';
import { useListReturn } from '@/src/hooks/useListReturn';
import { groupProcurements, totalsByCurrency, type ProcurementListRole } from '@/src/lib/procurement/listModel';
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

/**
 * #2104 — the memoised row. The grouped list re-renders on every page render (a search commit, a
 * return-context URL change); a row whose own record object is unchanged must not re-render its
 * subtree, because there can be ~1k of them.
 */
const GroupedProcurementRow = React.memo(ProcurementListRowBase);

export const ProcurementGroupedView: React.FC<ProcurementGroupedViewProps> = ({ rows, role, reasonText }) => {
  const { t } = useTranslation('procurementList');
  // #2104: ONE return-context hook for the whole list. Each row used to call `useListReturn`
  // itself, which subscribed every row to `location` + `navigate`: any URL change re-rendered the
  // entire list.
  const { openRecord } = useListReturn({ list: 'procurement' });
  // The opener is re-minted on every URL change (it embeds the current path). Hand the rows a
  // function whose identity never changes and which reads the CURRENT opener at click time — a
  // navigation then re-renders nothing, and a click still carries the up-to-date return context.
  const openRecordRef = useRef<OpenRecord>(openRecord);
  useEffect(() => {
    openRecordRef.current = openRecord;
  }, [openRecord]);
  const openRow = useCallback<OpenRecord>((recordPath) => openRecordRef.current(recordPath), []);

  const sections = useMemo(() => groupProcurements(rows).map((group) => {
    const basis = group.key === 'invoiced' ? 'pay' : 'most-real';
    return { group, basis, totals: totalsByCurrency(group.rows, role, basis) };
  }), [rows, role]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card" aria-label={t('grouped.label', 'Procurements grouped by next step')}>
      {sections.map(({ group, basis, totals }, index) => {
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
                    <GroupedProcurementRow row={row} openRecord={openRow} />
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
