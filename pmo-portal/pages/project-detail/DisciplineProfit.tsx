import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ListState } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { formatExactMoney } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { useProjectPlanVsActual } from '@/src/hooks/useWorkOrderPlanVsActual';
import { useCostDisciplines } from '@/src/hooks/useWorkOrderCosts';
import { useDisciplineRevenue } from '@/src/hooks/useDisciplineProfit';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { disciplineProfit, type ProfitFigure, type ProfitRow } from '@/src/lib/disciplineProfit';
import { moneyUnits } from '@/src/lib/projectFinances';

/**
 * Profit per discipline (#2669, docs/specs/discipline-profit.spec.md). Renders only what `disciplineProfit` joined from
 * the plan-versus-actual roll-up and the validated-revenue read (FR-DPR-020): nothing is re-summed here. Where the
 * organisation setting is off or the role may not read work-order money, nothing is rendered and no revenue is asked for.
 * An unknown, incomplete or restricted figure reads as such in words, never as zero; a loss reads "Loss of X".
 */
interface Props { projectId: string }

const DisciplineProfit: React.FC<Props> = ({ projectId }) => {
  const { t } = useTranslation('workOrderPva');
  const may = usePermission();
  const canView = may('view', 'workOrderPlan');
  const setting = useOrgSwitch('disciplineProfit', canView);
  const on = canView && setting.data === true;
  const pva = useProjectPlanVsActual(projectId, on);
  const revenue = useDisciplineRevenue(projectId, on);
  const disciplines = useCostDisciplines(on);

  const nameOf = useMemo(() => {
    const m = new Map((disciplines.data ?? []).map((d) => [d.id, d.name]));
    return (id: string | null) => (id === null ? t('profit.noDiscipline', 'No discipline') : m.get(id) ?? t('profit.archivedDiscipline', 'Archived discipline'));
  }, [disciplines.data, t]);

  if (!on) return null;
  const title = t('profit.title', 'Profit per discipline');
  const failed = pva.isError || revenue.isError || disciplines.isError;
  if (pva.isPending || revenue.isPending || disciplines.isPending || failed || !pva.data || revenue.data === undefined) {
    return (
      <Card className="min-w-0" data-testid="discipline-profit">
        <CardHead level={2} className="text-base">{title}</CardHead>
        <CardPad className="pt-0">
          {failed
            ? <ListState variant="error" title={t('profit.loadError', 'Couldn\'t load profit per discipline')} retryLabel={t('profit.retry', 'Try again')} onRetry={() => { void pva.refetch(); void revenue.refetch(); void disciplines.refetch(); }} />
            : <ListState variant="loading" rows={3} />}
        </CardPad>
      </Card>
    );
  }

  const profit = disciplineProfit(pva.data.rollup, revenue.data);
  const money = (value: string | null, currency: string) =>
    value === null ? t('profit.unknown', 'Unknown') : formatExactMoney(value, currency, getNumberLocale()) ?? t('profit.unknown', 'Unknown');
  const figureText = (f: ProfitFigure, currency: string) => {
    if (f.amount !== null) {
      const units = moneyUnits(f.amount);
      if (units !== null && units < 0n) return t('profit.loss', 'Loss of {{amount}}', { amount: money(f.amount.replace('-', ''), currency) });
      return money(f.amount, currency);
    }
    if (f.reason === 'not-comparable') return t('profit.notComparable', 'Not comparable (other currency)');
    if (f.reason === 'incomplete') return t('profit.incomplete', 'Incomplete: validated work without a rate');
    if (f.reason === 'cost-unknown') return t('profit.costUnknown', 'Cost unknown');
    return '';
  };

  const body = profit.restricted
    ? <p role="status" className="text-sm text-muted-foreground">{t('profit.restricted', 'Restricted')}</p>
    : profit.currencies.length === 0 || profit.currencies.every((c) => c.rows.length === 0)
      ? <p role="status" className="text-sm text-muted-foreground">{t('profit.empty', 'No validated revenue or cost per discipline yet.')}</p>
      : profit.currencies.map((c) => (
        <div key={c.currency} className="overflow-x-auto" data-testid={`discipline-profit-${c.currency}`}>
          <table className="w-full text-sm">
            <caption className="py-1 text-left font-medium">{c.currency}</caption>
            <thead><tr className="text-right text-muted-foreground">
              <th scope="col" className="py-1 pr-4 text-left font-normal">{t('profit.col.discipline', 'Discipline')}</th>
              <th scope="col" className="py-1 pr-4 font-normal">{t('profit.col.revenue', 'Revenue')}</th>
              <th scope="col" className="py-1 pr-4 font-normal">{t('profit.col.direct', 'Direct cost')}</th>
              <th scope="col" className="py-1 pr-4 font-normal">{t('profit.col.shared', 'Shared cost')}</th>
              <th scope="col" className="py-1 pr-4 font-normal">{t('profit.col.after', 'Margin after shared cost')}</th>
              <th scope="col" className="py-1 font-normal">{t('profit.col.before', 'Margin before shared cost')}</th>
            </tr></thead>
            <tbody>
              {[...c.rows, c.total].map((r: ProfitRow) => (
                <tr key={r.key} className={r.kind === 'total' ? 'border-t border-border font-semibold' : 'border-t border-border'} data-testid={`discipline-profit-row-${r.kind === 'discipline' ? (r.disciplineId ?? 'none') : r.kind}`}>
                  <th scope="row" className="py-1 pr-4 text-left font-normal">
                    {r.kind === 'total' ? t('profit.total', 'Project total') : r.kind === 'unassigned' ? t('profit.notAssigned', 'Not assigned') : nameOf(r.disciplineId)}
                  </th>
                  <td className="py-1 pr-4 text-right tabular-nums">{r.kind === 'unassigned' ? '' : money(r.revenue, r.currency)}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{r.kind === 'unassigned' ? '' : money(r.direct, r.currency)}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{money(r.allocated, r.currency)}</td>
                  <td className="py-1 pr-4 text-right tabular-nums" data-testid="discipline-profit-after">{r.kind === 'unassigned' ? '' : figureText(r.marginAfter, r.currency)}</td>
                  <td className="py-1 text-right tabular-nums" data-testid="discipline-profit-before">{r.kind === 'unassigned' ? '' : figureText(r.marginBefore, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ));

  return (
    <Card className="min-w-0" data-testid="discipline-profit">
      <CardHead level={2} className="text-base">{title}</CardHead>
      <CardPad className="pt-0">
        {body}
      </CardPad>
    </Card>
  );
};

export default DisciplineProfit;
