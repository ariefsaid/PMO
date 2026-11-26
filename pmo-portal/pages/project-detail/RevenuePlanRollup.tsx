import React, { useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Card, CardHead, CardPad, ListState } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectRevenuePlan, useRevenuePlanSettings } from '@/src/hooks/useWorkOrderRevenuePlan';
import { formatTableMoney } from '@/src/lib/format';
import { revenueGap } from '@/src/lib/revenuePlan';

interface Props { projectId: string }

/**
 * Revenue plan roll-up on the project page (#2671, FR-WRP-021): per work order, plan to date, actual and gap, and one
 * total per currency (never blended). Renders nothing while the organisation's switch is off or for a role that may not
 * read it. Reads the same SQL figures as the work-order page, so the two always agree (AC-WRP-013).
 */
const RevenuePlanRollup: React.FC<Props> = ({ projectId }) => {
  // Outside the app's providers (a bare render) there is nothing to read: show nothing, as when the plan is off.
  const queries = useContext(QueryClientContext);
  const auth = useContext(AuthContext);
  if (!queries || !auth) return null;
  return <RollupInner projectId={projectId} />;
};

const RollupInner: React.FC<Props> = ({ projectId }) => {
  const { t } = useTranslation('workOrderRevenuePlan');
  const canView = usePermission()('view', 'workOrderRevenuePlan');
  const settings = useRevenuePlanSettings();
  const on = canView && settings.data?.enabled === true;
  const q = useProjectRevenuePlan(projectId, on);
  if (!on) return null;
  const title = t('rollup.title', 'Revenue plan');
  const head = <CardHead>{title}</CardHead>;
  if (q.isPending) return <Card data-testid="project-revenue-plan">{head}<CardPad><ListState variant="loading" rows={3} /></CardPad></Card>;
  if ((q.error as { code?: string } | null)?.code === '42501') {
    return <Card data-testid="project-revenue-plan">{head}<CardPad><p role="status" className="text-control text-muted-foreground">{t('restricted', 'The revenue plan is restricted for your role.')}</p></CardPad></Card>;
  }
  if (q.isError) return <Card data-testid="project-revenue-plan">{head}<CardPad><ListState variant="error" title={t('loadError', "Couldn't load the revenue plan")} retryLabel={t('retry', 'Try again')} onRetry={() => void q.refetch()} /></CardPad></Card>;
  const data = q.data;
  if (!data) return null;
  const money = (v: string, currency: string) => formatTableMoney(v, currency) ?? v;
  const gapText = (gap: string, currency: string, hasPlan: boolean) => {
    if (!hasPlan) return t('noPlan', 'No plan entered');
    const g = revenueGap(gap);
    return g.state === 'behind' ? t('behind', '{{amount}} behind plan', { amount: money(g.by, currency) })
      : g.state === 'ahead' ? t('ahead', '{{amount}} ahead of plan', { amount: money(g.by, currency) }) : t('onPlan', 'On plan');
  };
  return (
    <Card data-testid="project-revenue-plan">
      {head}
      <CardPad>
        {data.rows.length === 0 ? <p className="text-control text-muted-foreground">{t('rollup.empty', 'No work orders to plan yet.')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-control">
              <caption className="sr-only">{t('rollup.caption', 'Revenue plan to {{date}} per work order', { date: data.asOf })}</caption>
              <thead><tr className="text-right text-muted-foreground">
                <th scope="col" className="py-1 pr-4 text-left font-normal">{t('rollup.workOrder', 'Work order')}</th>
                <th scope="col" className="py-1 pr-4 font-normal">{t('planToDate', 'Plan to date')}</th>
                <th scope="col" className="py-1 pr-4 font-normal">{t('actualToDate', 'Actual to date')}</th>
                <th scope="col" className="py-1 font-normal">{t('gap', 'Gap')}</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.workOrderId} className="border-t border-border" data-testid={`revenue-plan-row-${r.workOrderId}`}>
                    <th scope="row" className="py-1 pr-4 text-left font-normal"><Link className="text-primary underline-offset-2 hover:underline" to={`/work-orders/${r.workOrderId}`}>{r.woNumber ?? r.title}</Link></th>
                    <td className="py-1 pr-4 text-right tabular-nums">{r.hasPlan ? money(r.planToDate, r.currency) : '—'}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{money(r.actualToDate, r.currency)}{r.pendingReports > 0 && <div className="text-muted-foreground">{t('rollup.pending', '{{count}} not yet validated', { count: r.pendingReports })}</div>}</td>
                    <td className="py-1 text-right tabular-nums">{gapText(r.gap, r.currency, r.hasPlan)}</td>
                  </tr>
                ))}
              </tbody>
              {data.totals.length > 0 && <tfoot>
                {data.totals.map((x) => (
                  <tr key={x.currency} className="border-t border-border font-medium" data-testid={`revenue-plan-total-${x.currency}`}>
                    <th scope="row" className="py-1 pr-4 text-left font-medium">{t('rollup.total', 'Total ({{currency}}, planned work orders)', { currency: x.currency })}</th>
                    <td className="py-1 pr-4 text-right tabular-nums">{money(x.planToDate, x.currency)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{money(x.actualToDate, x.currency)}</td>
                    <td className="py-1 text-right tabular-nums">{gapText(x.gap, x.currency, true)}</td>
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

export default RevenuePlanRollup;
