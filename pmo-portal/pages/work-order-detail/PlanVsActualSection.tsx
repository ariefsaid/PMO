import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ListState, RecordSection } from '@/src/components/ui';
import WorkOrderPlanModal from '../project-detail/WorkOrderPlanModal';
import { formatExactMoney } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { planVariance } from '@/src/lib/workOrderPlanVsActual';
import type { Margin } from '@/src/lib/projectFinances';
import type { ProjectPlanVsActual } from '@/src/lib/repositories/workOrderFinance';
import type { CostDiscipline } from '@/src/lib/db/workOrderCosts';
import { LabourByClass } from './LabourByClass';
import { IdleCostBlock } from './IdleCostBlock';

interface Props {
  workOrderId: string;
  /** The #2519 project read (`useProjectPlanVsActual`); this section only picks its work order out of it (FR-WPVA-010). */
  query: { data?: ProjectPlanVsActual; isPending: boolean; isError: boolean; refetch: () => unknown };
  disciplines: CostDiscipline[];
  /** Needed only for the idle-time block (#2673); without it the block does not load. */
  projectId?: string;
  /** The reader may enter the plan (`manage workOrderPlan`); the Plan action then opens the project tab's dialog. */
  canPlan?: boolean;
}

/**
 * Plan versus actual on the work order's own page (#2570, FR-WPVA-040): planned and actual cost, revenue, both
 * margins, discipline rows and the work order's share of shared cost. Shows ONLY what `rollupProject` derived for
 * this work order, so it equals the project tab's row (AC-WPVA-016). Overspend reads in words (FR-WPVA-041); a role
 * that cannot read the money sees "restricted", never a zero (FR-WPVA-013).
 */
export const PlanVsActualSection: React.FC<Props> = ({ workOrderId, query, disciplines, projectId, canPlan = false }) => {
  const { t } = useTranslation('workOrderPva');
  const [planning, setPlanning] = useState(false);
  const title = t('title', 'Plan vs actual');
  if (query.isPending) return <RecordSection title={title} data-testid="wo-page-pva"><ListState variant="loading" rows={3} /></RecordSection>;
  if (query.isError || !query.data) {
    return (
      <RecordSection title={title} data-testid="wo-page-pva">
        <ListState variant="error" title={t('loadError', "Couldn't load plan vs actual")} retryLabel={t('retry', 'Try again')} onRetry={() => void query.refetch()} />
      </RecordSection>
    );
  }
  const { rollup, workOrders } = query.data;
  if (rollup.restricted) {
    return (
      <RecordSection title={title} data-testid="wo-page-pva">
        <p role="status" className="text-control text-muted-foreground">{t('restrictedNote', 'Work-order cost and margin are restricted for your role.')}</p>
      </RecordSection>
    );
  }
  const f = rollup.workOrders.find((x) => x.workOrderId === workOrderId);
  const w = workOrders.find((x) => x.id === workOrderId);
  // Walk PC3: the plan is entered where a manager reads it, with the project tab's own dialog and gate.
  const planAction = canPlan && projectId && w && w.status !== 'Cancelled'
    ? <Button variant="outline" size="sm" onClick={() => setPlanning(true)} data-testid="wo-page-pva-plan">{t('editPlan', 'Plan')}</Button>
    : undefined;
  const planModal = planning && projectId && w && (
    <WorkOrderPlanModal projectId={projectId} workOrder={w}
      plans={query.data.plans.filter((p) => p.workOrderId === w.id && p.disciplineId === null && (p.sectionId ?? null) === null)}
      onClose={() => setPlanning(false)} />
  );
  if (!f || !w) {
    return <RecordSection title={title} actions={planAction} data-testid="wo-page-pva"><p className="text-control text-muted-foreground">{t('pageEmpty', 'No plan or actuals for this work order yet.')}</p>{planModal}</RecordSection>;
  }
  const cur = w.currency;
  const money = (value: string | null, currency = cur) =>
    value === null ? t('unknown', 'Unknown') : formatExactMoney(value, currency, getNumberLocale()) ?? t('unknown', 'Unknown');
  const planText = (value: string | null) => (value === null ? t('noPlan', 'No plan') : money(value));
  const marginText = (m: Margin) => {
    if (m.amount !== null) return money(m.amount);
    switch (m.reason) {
      case 'restricted-rows': return t('restricted', 'Restricted');
      case 'different-currencies': return t('notComparable', 'Not comparable (other currency)');
      case 'work-unavailable': return t('revenueUnknown', 'Revenue unknown');
      default: return t('costUnknown', 'Cost unknown');
    }
  };
  const variantText = (plan: string | null, actual: string | null) => {
    const v = planVariance(plan, actual);
    if (v.state === 'over') return t('overPlan', 'Over plan by {{amount}}', { amount: money(v.by) });
    if (v.state === 'within') return t('underPlan', '{{amount}} left', { amount: money(v.by) });
    if (v.state === 'unknown') return t('unknown', 'Unknown');
    return t('noPlan', 'No plan');
  };
  const nameOf = (id: string | null) => (id === null ? t('noDiscipline', 'No discipline') : disciplines.find((d) => d.id === id)?.name ?? t('unknownDiscipline', 'Archived discipline'));
  const revenue = w.revenue === null || !w.revenueComplete ? t('revenueUnknown', 'Revenue unknown') : money(w.revenue);

  const figure = (testId: string, label: string, value: React.ReactNode, note?: React.ReactNode) => (
    <div key={testId}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums" data-testid={testId}>{value}{note ? <div className="text-muted-foreground">{note}</div> : null}</dd>
    </div>
  );
  return (
    <RecordSection title={title} actions={planAction} data-testid="wo-page-pva">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-control sm:grid-cols-3">
        {figure('wo-page-pva-plan-direct', t('col.plan', 'Planned direct'), planText(f.plan.direct_budget))}
        {figure('wo-page-pva-direct', t('col.direct', 'Direct cost'), money(f.direct), variantText(f.plan.direct_budget, f.direct))}
        {figure('wo-page-pva-plan-indirect', t('col.planIndirect', 'Planned indirect'), planText(f.plan.indirect_budget))}
        {figure('wo-page-pva-allocated', t('col.shared', 'Shared cost'), money(f.allocated), variantText(f.plan.indirect_budget, f.allocated))}
        {figure('wo-page-pva-revenue', t('col.revenue', 'Billed revenue'), revenue)}
        {figure('wo-page-pva-direct-margin', t('col.directMargin', 'Direct margin'), marginText(f.directMargin))}
        {figure('wo-page-pva-result', t('col.result', 'After shared cost'), marginText(f.result))}
        {f.otherCurrency.map((o) => figure(`wo-page-pva-other-${o.currency}`, t('otherCurrency', 'Cost in {{currency}}, listed apart', { currency: o.currency }), money(o.amount, o.currency)))}
      </dl>
      {f.labour && f.labour.length > 0 && <LabourByClass labour={f.labour} currency={cur} testId="wo-page-pva-labour" />}
      <IdleCostBlock projectId={projectId} workOrderId={workOrderId} testId="wo-page-pva-idle" />
      {f.disciplines.length > 0 && (
        <div className="mt-4 overflow-x-auto" data-testid="wo-page-pva-disciplines">
          <table className="w-full text-control">
            <caption className="py-1 text-left font-medium">{t('byDiscipline', 'By discipline')}</caption>
            <thead><tr className="text-right text-muted-foreground">
              <th scope="col" className="py-1 pr-4 text-left font-normal">{t('col.discipline', 'Discipline')}</th>
              <th scope="col" className="py-1 pr-4 font-normal">{t('col.plan', 'Planned direct')}</th>
              <th scope="col" className="py-1 pr-4 font-normal">{t('col.direct', 'Direct cost')}</th>
              <th scope="col" className="py-1 pr-4 font-normal">{t('col.planIndirect', 'Planned indirect')}</th>
              <th scope="col" className="py-1 font-normal">{t('col.shared', 'Shared cost')}</th>
            </tr></thead>
            <tbody>{f.disciplines.map((d) => (
              <tr key={d.disciplineId ?? 'none'} className="border-t border-border" data-testid={`wo-page-pva-discipline-${d.disciplineId ?? 'none'}`}>
                <th scope="row" className="py-1 pr-4 text-left font-normal">{nameOf(d.disciplineId)}</th>
                <td className="py-1 pr-4 text-right tabular-nums">{planText(d.planDirect)}</td>
                <td className="py-1 pr-4 text-right tabular-nums">{money(d.direct)}{d.planDirect !== null && <div className="text-muted-foreground">{variantText(d.planDirect, d.direct)}</div>}</td>
                <td className="py-1 pr-4 text-right tabular-nums">{planText(d.planIndirect)}</td>
                <td className="py-1 text-right tabular-nums">{money(d.allocated)}{d.planIndirect !== null && <div className="text-muted-foreground">{variantText(d.planIndirect, d.allocated)}</div>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {planModal}
    </RecordSection>
  );
};
