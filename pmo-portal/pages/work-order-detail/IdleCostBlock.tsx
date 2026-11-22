import React, { useContext } from 'react';
import { AuthContext } from '@/src/auth/AuthContext';
import { useTranslation } from 'react-i18next';
import { formatExactMoney, formatNumberExact } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { useProjectIdleCost } from '@/src/hooks/useIdleCost';
import { totalIdleAmount } from '@/src/lib/db/idleCost';

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
  const money = (v: string | null, cur: string) => (v === null ? t('idle.noRate', 'No rate') : formatExactMoney(v, cur, getNumberLocale()) ?? v);
  const cur = rows[0].currency;
  const total = totalIdleAmount(rows);
  const hours = rows.reduce((s, r) => s + Number(r.hours), 0);
  return (
    <div className="mt-4 overflow-x-auto" data-testid={testId}>
      <table className="w-full text-control">
        <caption className="py-1 text-left font-medium">{t('idle.title', 'Idle time cost by reason')}</caption>
        <thead><tr className="text-right text-muted-foreground">
          <th scope="col" className="py-1 pr-4 text-left font-normal">{t('idle.reason', 'Reason')}</th>
          <th scope="col" className="py-1 pr-4 font-normal">{t('idle.hours', 'Hours')}</th>
          <th scope="col" className="py-1 font-normal">{t('idle.cost', 'Cost')}</th>
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.reasonId} className="border-t border-border" data-testid={`${testId}-${r.reasonId}`}>
            <th scope="row" className="py-1 pr-4 text-left font-normal">{r.reasonLabel}</th>
            <td className="py-1 pr-4 text-right tabular-nums">{formatNumberExact(Number(r.hours))}</td>
            <td className="py-1 text-right tabular-nums">{money(r.amount, r.currency)}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr className="border-t border-border font-medium" data-testid={`${testId}-total`}>
          <th scope="row" className="py-1 pr-4 text-left">{t('idle.total', 'Total idle')}</th>
          <td className="py-1 pr-4 text-right tabular-nums">{formatNumberExact(hours)}</td>
          <td className="py-1 text-right tabular-nums">{money(total, cur)}</td>
        </tr></tfoot>
      </table>
      <p className="py-1 text-sm text-muted-foreground">{t('idle.note', 'Shown apart: this time was already paid, so it is part of the direct cost above and is not added again. Cost at the work order\'s average hourly cost.')}</p>
    </div>
  );
};
