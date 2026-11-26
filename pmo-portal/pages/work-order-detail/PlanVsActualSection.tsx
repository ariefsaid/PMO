import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ListState, RecordSection } from '@/src/components/ui';
import WorkOrderPlanModal from '../project-detail/WorkOrderPlanModal';
import { formatTableMoney } from '@/src/lib/format';
import { PvaTable, type PvaCell, type PvaRow } from '../project-detail/PvaTable';
import { planVariance } from '@/src/lib/workOrderPlanVsActual';
import type { Margin } from '@/src/lib/projectFinances';
import type { ProjectPlanVsActual } from '@/src/lib/repositories/workOrderFinance';
import type { CostDiscipline } from '@/src/lib/db/workOrderCosts';
import { OtherCurrencyNote } from './AreaHelp';
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
    value === null ? t('unknown', 'Unknown') : formatTableMoney(value, currency) ?? t('unknown', 'Unknown');
  const marginText = (m: Margin) => {
    if (m.amount !== null) return money(m.amount);
    switch (m.reason) {
      case 'restricted-rows': return t('restricted', 'Restricted');
      // Said once for the area (OtherCurrencyNote), not in each figure.
      case 'different-currencies': return '—';
      case 'work-unavailable': return t('revenueUnknown', 'Revenue unknown');
      default: return t('costUnknown', 'Cost unknown');
    }
  };
  const revenue = w.revenue === null || !w.revenueComplete ? t('revenueUnknown', 'Revenue unknown') : money(w.revenue);
  const nameOf = (id: string | null) => (id === null ? t('noDiscipline', 'No discipline') : disciplines.find((d) => d.id === id)?.name ?? t('unknownDiscipline', 'Archived discipline'));
  // The project tab's table family (PvaTable): Plan · Actual · Left or over, the overspend in danger text and words.
  const planCell = (plan: string | null, testId?: string): PvaCell => plan === null ? { text: t('noPlan', 'No plan'), tone: 'words', testId } : { text: money(plan), testId };
  const diffCell = (plan: string | null, actual: string | null): PvaCell => {
    const v = planVariance(plan, actual);
    if (v.state === 'no-plan') return { text: '—', tone: 'words' };
    if (v.state === 'unknown') return { text: t('unknown', 'Unknown'), tone: 'words' };
    return v.state === 'over'
      ? { text: t('overPlan', 'Over plan by {{amount}}', { amount: money(v.by) }), tone: 'over' }
      : { text: t('underPlan', '{{amount}} left', { amount: money(v.by) }), tone: 'words' };
  };
  const legRow = (key: string, head: React.ReactNode, plan: string | null, actual: string | null, planId?: string, actualId?: string): PvaRow =>
    ({ key, head, testId: key.startsWith('d:') ? `wo-page-pva-discipline-${key.slice(2)}` : undefined,
      cells: [planCell(plan, planId), { text: money(actual), testId: actualId }, diffCell(plan, actual)] });
  const columns = [{ key: 'plan', label: t('col.planShort', 'Plan') }, { key: 'actual', label: t('col.actualShort', 'Actual') }, { key: 'diff', label: t('col.difference', 'Left or over') }];
  const tone = (m: Margin) => m.amount === null ? 'font-normal text-muted-foreground' : m.amount.startsWith('-') && !/^-0(\.0+)?$/.test(m.amount) ? 'text-destructive' : '';
  const figure = (testId: string, label: string, value: React.ReactNode, className = '') => (
    <div key={testId} className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`mt-1 font-medium tabular-nums ${className}`} data-testid={testId}>{value}</dd>
    </div>
  );
  return (
    <RecordSection title={title} subline={t('actualBasis', 'Actual follows project financial actuals; the costs below include other records.')} actions={planAction} data-testid="wo-page-pva">
      {(f.directMargin.reason === 'different-currencies' || f.result.reason === 'different-currencies') && <OtherCurrencyNote />}
      <PvaTable dense testId="wo-page-pva-cost" caption={title} firstColumn={<span className="sr-only">{t('col.cost', 'Cost')}</span>} columns={columns} rows={[
        legRow('direct', t('col.direct', 'Direct cost'), f.plan.direct_budget, f.direct, 'wo-page-pva-plan-direct', 'wo-page-pva-direct'),
        legRow('shared', t('col.shared', 'Shared cost'), f.plan.indirect_budget, f.allocated, 'wo-page-pva-plan-indirect', 'wo-page-pva-allocated'),
      ]} />
      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 border-t border-border pt-4 text-control sm:grid-cols-3">
        {figure('wo-page-pva-revenue', t('col.revenue', 'Billed revenue'), revenue, w.revenue === null || !w.revenueComplete ? 'font-normal text-muted-foreground' : '')}
        {figure('wo-page-pva-direct-margin', t('col.directMargin', 'Direct margin'), marginText(f.directMargin), tone(f.directMargin))}
        {figure('wo-page-pva-result', t('col.result', 'After shared cost'), marginText(f.result), tone(f.result))}
        {f.otherCurrency.map((o) => figure(`wo-page-pva-other-${o.currency}`, t('otherCurrency', 'Cost in {{currency}}, listed apart', { currency: o.currency }), money(o.amount, o.currency)))}
      </dl>
      {f.labour && f.labour.length > 0 && <LabourByClass labour={f.labour} currency={cur} testId="wo-page-pva-labour" />}
      <IdleCostBlock projectId={projectId} workOrderId={workOrderId} testId="wo-page-pva-idle" />
      {f.disciplines.length > 0 && (
        <section className="mt-4 border-t border-border pt-4" data-testid="wo-page-pva-disciplines">
          <h3 className="mb-1 text-control font-semibold">{t('byDiscipline', 'By discipline')}</h3>
          <PvaTable dense caption={t('byDiscipline', 'By discipline')} firstColumn={t('col.discipline', 'Discipline')} columns={columns}
            rows={f.disciplines.flatMap((d) => [
              legRow(`d:${d.disciplineId ?? 'none'}`, <>{nameOf(d.disciplineId)} <span className="text-muted-foreground">· {t('directShort', 'direct')}</span></>, d.planDirect, d.direct),
              legRow(`s:${d.disciplineId ?? 'none'}`, <>{nameOf(d.disciplineId)} <span className="text-muted-foreground">· {t('sharedShort', 'shared')}</span></>, d.planIndirect, d.allocated),
            ])} />
        </section>
      )}
      {planModal}
    </RecordSection>
  );
};
