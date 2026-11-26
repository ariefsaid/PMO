import React, { useContext } from 'react';
import { AuthContext } from '@/src/auth/AuthContext';
import { useTranslation } from 'react-i18next';
import { formatNumberExact, formatTableMoney } from '@/src/lib/format';
import { useProjectIdleCost } from '@/src/hooks/useIdleCost';
import { totalIdleAmount } from '@/src/lib/db/idleCost';
import { sumDecimal } from '@/src/lib/exactDecimal';

/**
 * Idle time of one work order by idle reason (#2673, FR-IHC-006): hours and cost of recorded idle time at the work
 * order's hourly cost. Rendered only when the read returns rows, so an organisation with either switch off sees nothing.
 * It is a lost-time view of cost already inside the direct cost, never added to it. Cost words only.
 */
type Props = { projectId: string | undefined; workOrderId: string; testId: string };
/** Loads only with a project and a signed-in session (the read is org-scoped); a bare render shows nothing. */
export const IdleCostBlock: React.FC<Props> = ({ projectId, ...rest }) => {
  const signedIn = useContext(AuthContext) !== undefined;
  return projectId && signedIn ? <IdleCostRows projectId={projectId} {...rest} /> : null;
};

const IdleCostRows: React.FC<Props & { projectId: string }> = ({ projectId, workOrderId, testId }) => {
  const { t } = useTranslation('workOrderPva');
  const q = useProjectIdleCost(projectId);
  const rows = (q.data ?? []).filter((r) => r.workOrderId === workOrderId);
  if (rows.length === 0) return null;
  const money = (v: string | null, cur: string) => (v === null ? t('idle.noRate', 'No rate') : formatTableMoney(v, cur) ?? v);
  const cur = rows[0].currency;
  const total = totalIdleAmount(rows);
  const hours = rows.reduce((s, r) => s + Number(r.hours), 0);
  // The scope is people_and_equipment (1731) exactly when the read carries the split.
  const split = rows.some((r) => r.peopleAmount !== null || r.equipmentAmount !== null);
  const sum = (pick: (r: (typeof rows)[number]) => string | null) => {
    const v = rows.map(pick).filter((x): x is string => x !== null);
    return v.length === 0 ? null : sumDecimal(v, 2);
  };
  return (
    <div className="mt-4 overflow-x-auto" data-testid={testId}>
      <table className="w-full text-control">
        <caption className="py-1 text-left font-semibold">{t('idle.title', 'Idle time cost by reason')}</caption>
        <thead><tr className="text-right text-muted-foreground">
          <th scope="col" className="py-1 pr-4 text-left font-normal">{t('idle.reason', 'Reason')}</th>
          <th scope="col" className="py-1 pr-4 font-normal">{t('idle.hours', 'Hours')}</th>
          {split && <th scope="col" className="py-1 pr-4 font-normal">{t('idle.people', 'People')}</th>}
          {split && <th scope="col" className="py-1 pr-4 font-normal">{t('idle.equipment', 'Equipment')}</th>}
          <th scope="col" className="py-1 font-normal">{t('idle.cost', 'Cost')}</th>
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.reasonId} className="border-t border-border" data-testid={`${testId}-${r.reasonId}`}>
            <th scope="row" className="py-1 pr-4 text-left font-normal">{r.reasonLabel}</th>
            <td className="py-1 pr-4 text-right tabular-nums">{formatNumberExact(Number(r.hours))}</td>
            {split && <td className="py-1 pr-4 text-right tabular-nums">{money(r.peopleAmount, r.currency)}</td>}
            {split && <td className="py-1 pr-4 text-right tabular-nums">{money(r.equipmentAmount ?? '0.00', r.currency)}</td>}
            <td className="py-1 text-right tabular-nums">{money(r.amount, r.currency)}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr className="border-t border-border font-medium" data-testid={`${testId}-total`}>
          <th scope="row" className="py-1 pr-4 text-left">{t('idle.total', 'Total idle')}</th>
          <td className="py-1 pr-4 text-right tabular-nums">{formatNumberExact(hours)}</td>
          {split && <td className="py-1 pr-4 text-right tabular-nums">{money(sum((r) => r.peopleAmount), cur)}</td>}
          {split && <td className="py-1 pr-4 text-right tabular-nums">{money(sum((r) => r.equipmentAmount), cur)}</td>}
          <td className="py-1 text-right tabular-nums">{money(total, cur)}</td>
        </tr></tfoot>
      </table>
      <p className="py-1 text-sm text-muted-foreground">{split
        ? t('idle.noteFull', 'Shown apart: the people hours are already in labour cost and the standby money is already in equipment cost, so they are not added again. People are the crew present each day at the work order\'s average hourly cost.')
        : t('idle.note', 'Shown apart: this time was already paid, so it is part of the direct cost above and is not added again. Cost at the work order\'s average hourly cost.')}</p>
    </div>
  );
};
