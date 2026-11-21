import React, { useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Card, CardHead, CardPad, ListState } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useRevenuePlanSettings } from '@/src/hooks/useWorkOrderRevenuePlan';
import { useProjectDailyTarget } from '@/src/hooks/useWorkOrderDailyTarget';
import { formatExactMoney } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { revenueGap } from '@/src/lib/revenuePlan';

interface Props { projectId: string }

/**
 * Month-to-date roll-up on the project page (#2672, FR-WDT-021): per work order, target to date, actual to date and the
 * projection to month end, and one total per currency (never blended). Renders nothing while the organisation's switch is
 * off or for a role that may not read it. Same SQL figures as the work-order page, so the two always agree (AC-WDT-014).
 */
const DailyTargetRollup: React.FC<Props> = ({ projectId }) => {
  const queries = useContext(QueryClientContext);
  const auth = useContext(AuthContext);
  if (!queries || !auth) return null;
  return <Inner projectId={projectId} />;
};

const Inner: React.FC<Props> = ({ projectId }) => {
  const { t } = useTranslation('workOrderRevenuePlan');
  const canView = usePermission()('view', 'workOrderRevenuePlan');
  const settings = useRevenuePlanSettings();
  const on = canView && settings.data?.enabled === true;
  const q = useProjectDailyTarget(projectId, on);
  if (!on) return null;
  const head = <CardHead>{t('dailyRollup.title', 'Daily target, month to date')}</CardHead>;
  if (q.isPending) return <Card data-testid="project-daily-target">{head}<CardPad><ListState variant="loading" rows={3} /></CardPad></Card>;
  if ((q.error as { code?: string } | null)?.code === '42501') {
    return <Card data-testid="project-daily-target">{head}<CardPad><p role="status" className="text-control text-muted-foreground">{t('restricted', 'The revenue plan is restricted for your role.')}</p></CardPad></Card>;
  }
  if (q.isError) return <Card data-testid="project-daily-target">{head}<CardPad><ListState variant="error" title={t('daily.loadError', "Couldn't load the daily target")} retryLabel={t('retry', 'Try again')} onRetry={() => void q.refetch()} /></CardPad></Card>;
  const data = q.data;
  if (!data) return null;
  const money = (v: string, currency: string) => formatExactMoney(v, currency, getNumberLocale()) ?? v;
  const gapText = (gap: string, currency: string) => {
    const g = revenueGap(gap);
    return g.state === 'behind' ? t('daily.behind', '{{amount}} behind target', { amount: money(g.by, currency) })
      : g.state === 'ahead' ? t('daily.ahead', '{{amount}} ahead of target', { amount: money(g.by, currency) }) : t('daily.onTarget', 'On target');
  };
  const projection = (v: string | null, currency: string) => (v === null ? t('dailyRollup.projectionNone', 'Not enough days yet') : money(v, currency));
  return (
    <Card data-testid="project-daily-target">
      {head}
      <CardPad>
        {data.rows.length === 0 ? <p className="text-control text-muted-foreground">{t('rollup.empty', 'No work orders to plan yet.')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-control">
              <caption className="sr-only">{t('dailyRollup.caption', 'Daily target month to {{date}} per work order', { date: data.asOf })}</caption>
              <thead><tr className="text-right text-muted-foreground">
                <th scope="col" className="py-1 pr-4 text-left font-normal">{t('rollup.workOrder', 'Work order')}</th>
                <th scope="col" className="py-1 pr-4 font-normal">{t('daily.mtdTarget', 'Target to date')}</th>
                <th scope="col" className="py-1 pr-4 font-normal">{t('daily.mtdActual', 'Actual to date')}</th>
                <th scope="col" className="py-1 pr-4 font-normal">{t('daily.mtdGap', 'Gap to date')}</th>
                <th scope="col" className="py-1 font-normal">{t('daily.projection', 'Projection to month end')}</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.workOrderId} className="border-t border-border" data-testid={`daily-target-row-${r.workOrderId}`}>
                    <th scope="row" className="py-1 pr-4 text-left font-normal"><Link className="text-primary underline-offset-2 hover:underline" to={`/work-orders/${r.workOrderId}`}>{r.woNumber ?? r.title}</Link></th>
                    <td className="py-1 pr-4 text-right tabular-nums">{r.hasTarget ? money(r.mtdTarget, r.currency) : t('daily.noTarget', 'No target entered')}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{money(r.mtdActual, r.currency)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{r.hasTarget ? gapText(r.mtdGap, r.currency) : '—'}</td>
                    <td className="py-1 text-right tabular-nums">{projection(r.projection, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
              {data.totals.length > 0 && <tfoot>
                {data.totals.map((x) => (
                  <tr key={x.currency} className="border-t border-border font-medium" data-testid={`daily-target-total-${x.currency}`}>
                    <th scope="row" className="py-1 pr-4 text-left font-medium">{t('dailyRollup.total', 'Total ({{currency}}, work orders with a target)', { currency: x.currency })}</th>
                    <td className="py-1 pr-4 text-right tabular-nums">{money(x.mtdTarget, x.currency)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{money(x.mtdActual, x.currency)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{gapText(x.mtdGap, x.currency)}</td>
                    <td className="py-1 text-right tabular-nums">{projection(x.projection, x.currency)}</td>
                  </tr>
                ))}
              </tfoot>}
            </table>
          </div>
        )}
      </CardPad>
    </Card>
  );
};

export default DailyTargetRollup;
