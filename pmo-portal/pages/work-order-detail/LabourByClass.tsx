import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumberExact, formatTableMoney } from '@/src/lib/format';
import { useLabourClasses } from '@/src/hooks/useLabourCost';
import type { LabourFigure } from '@/src/lib/workOrderPlanVsActual';

/**
 * Priced labour of one work order by class (#2670, FR-LCM-021). Rendered only when the work order has priced labour,
 * so an organisation that never turned labour cost on sees nothing new. The figures are part of the direct cost the
 * screen already shows (never added again). Cost words only; the figures come from `rollupProject`.
 */
export const LabourByClass: React.FC<{ labour: readonly LabourFigure[]; currency: string; testId: string }> = ({ labour, currency, testId }) => {
  const { t } = useTranslation('workOrderPva');
  const classes = useLabourClasses();
  const nameOf = (id: string | null) => (id === null
    ? t('labour.allClasses', 'Crew and head count, all classes')
    : classes.data?.find((c) => c.id === id)?.name ?? t('labour.unknownClass', 'Other class'));
  return (
    <div className="mt-4 overflow-x-auto" data-testid={testId}>
      <table className="w-full text-control">
        <caption className="py-1 text-left font-semibold">{t('labour.title', 'Labour cost by class')}</caption>
        <thead><tr className="text-right text-muted-foreground">
          <th scope="col" className="py-1 pr-4 text-left font-normal">{t('labour.class', 'Class')}</th>
          <th scope="col" className="py-1 pr-4 font-normal">{t('labour.hours', 'Hours')}</th>
          <th scope="col" className="py-1 font-normal">{t('labour.cost', 'Cost')}</th>
        </tr></thead>
        <tbody>{labour.map((l) => (
          <tr key={l.classId ?? 'all'} className="border-t border-border" data-testid={`${testId}-${l.classId ?? 'all'}`}>
            <th scope="row" className="py-1 pr-4 text-left font-normal">{nameOf(l.classId)}</th>
            <td className="py-1 pr-4 text-right tabular-nums">{l.hours === null ? '—' : formatNumberExact(l.hours)}</td>
            <td className="py-1 text-right tabular-nums">{formatTableMoney(l.amount, currency) ?? l.amount}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="py-1 text-sm text-muted-foreground">{t('labour.note', 'Part of the direct cost above, from approved hours at each person\'s cost rate.')}</p>
    </div>
  );
};
