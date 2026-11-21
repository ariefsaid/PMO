import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, ListState } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { formatExactMoney, formatNumberExact } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { useProjectPlanVsActual } from '@/src/hooks/useWorkOrderPlanVsActual';
import { useCostDisciplines } from '@/src/hooks/useWorkOrderCosts';
import {
  hoursVariance,
  planVariance,
  type CostAmountLine,
  type PvaWorkOrder,
  type WorkOrderFigures,
} from '@/src/lib/workOrderPlanVsActual';
import type { Margin } from '@/src/lib/projectFinances';
import WorkOrderPlanModal from './WorkOrderPlanModal';
import SharedCostSplitModal from './SharedCostSplitModal';
import { LabourByClass } from '../work-order-detail/LabourByClass';

/**
 * Plan versus actual and profit per work order (#2519, spec docs/specs/work-order-plan-vs-actual.spec.md).
 *
 * Renders ONLY what `rollupProject` derived (FR-WPVA-010: never re-summed here). An unknown figure reads as such in
 * words; overspend reads "over plan by X" in text, never colour alone (FR-WPVA-041). A role that cannot read
 * work-order money sees "restricted", never a zero (FR-WPVA-013).
 */
interface Props { projectId: string }


const WorkOrderPlanVsActual: React.FC<Props> = ({ projectId }) => {
  const { t } = useTranslation('workOrderPva');
  const may = usePermission();
  const canView = may('view', 'workOrderPlan');
  const canPlan = may('manage', 'workOrderPlan');
  const canSplit = may('manage', 'sharedCostSplit');
  const query = useProjectPlanVsActual(projectId, canView);
  const disciplines = useCostDisciplines(canView);
  const [planFor, setPlanFor] = useState<PvaWorkOrder | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [openBasis, setOpenBasis] = useState<string | null>(null);

  const disciplineName = useMemo(() => {
    const m = new Map((disciplines.data ?? []).map((d) => [d.id, d.name]));
    return (id: string | null) => (id === null ? t('noDiscipline', 'No discipline') : m.get(id) ?? t('unknownDiscipline', 'Archived discipline'));
  }, [disciplines.data, t]);

  if (!canView) return null;

  const money = (value: string | null, currency: string) =>
    value === null ? t('unknown', 'Unknown') : formatExactMoney(value, currency, getNumberLocale()) ?? t('unknown', 'Unknown');

  const marginText = (m: Margin, currency: string) => {
    if (m.amount !== null) return money(m.amount, currency);
    switch (m.reason) {
      case 'restricted-rows': return t('restricted', 'Restricted');
      case 'different-currencies': return t('notComparable', 'Not comparable (other currency)');
      case 'work-unavailable': return t('revenueUnknown', 'Revenue unknown');
      default: return t('costUnknown', 'Cost unknown');
    }
  };

  const data = query.data;
  const title = t('title', 'Plan vs actual');

  if (query.isPending || query.isError || !data) {
    return (
      <Card className="min-w-0" data-testid="wo-plan-vs-actual">
        <CardHead level={2} className="text-base">{title}</CardHead>
        <CardPad className="pt-0">
          {query.isError
            ? <ListState variant="error" title={t('loadError', "Couldn't load plan vs actual")} retryLabel={t('retry', 'Try again')} onRetry={() => void query.refetch()} />
            : <ListState variant="loading" rows={3} />}
        </CardPad>
      </Card>
    );
  }

  const { rollup, workOrders } = data;
  const figures = new Map(rollup.workOrders.map((f) => [f.workOrderId, f]));

  if (rollup.restricted) {
    return (
      <Card className="min-w-0" data-testid="wo-plan-vs-actual">
        <CardHead level={2} className="text-base">{title}</CardHead>
        <CardPad className="pt-0">
          <p role="status" className="text-sm text-muted-foreground">
            {t('restrictedNote', 'Work-order cost and margin are restricted for your role.')}
          </p>
        </CardPad>
      </Card>
    );
  }

  const basisNote = (() => {
    const { basis, stale, mixedCurrency, byCurrency } = rollup.allocation;
    const parts: string[] = [];
    const message = (item: typeof basis) => {
      if (item === 'custom') return t('basisCustom', 'Shared cost uses the saved split.');
      if (item === 'direct-share') return t('basisDirect', 'Shared cost is split by each work order\'s share of direct cost.');
      if (item === 'none') return t('basisNone', 'Shared cost remains unassigned until a custom split is saved.');
      return null;
    };
    if (stale) parts.push(t('splitStale', 'The saved split is stale: a work order was added or cancelled since. The default is used until someone saves it again.'));
    if (mixedCurrency) {
      parts.push(t('splitMixed', 'Work orders use more than one currency, so shared cost is split within each currency.'));
      byCurrency.forEach((item) => { const note = message(item.basis); if (note) parts.push(`${item.currency}: ${note}`); });
    } else {
      const note = message(basis);
      if (note) parts.push(note);
    }
    return parts;
  })();

  const variantText = (plan: string | null, actual: string | null, currency: string) => {
    const v = planVariance(plan, actual);
    if (v.state === 'over') return t('overPlan', 'Over plan by {{amount}}', { amount: money(v.by, currency) });
    if (v.state === 'within') return t('underPlan', '{{amount}} left', { amount: money(v.by, currency) });
    if (v.state === 'unknown') return t('unknown', 'Unknown');
    return t('noPlan', 'No plan');
  };

  const hoursText = (plan: number | null, actual: number) => {
    const v = hoursVariance(plan, actual);
    if (v.state === 'over') return t('overPlanHours', 'Over plan by {{hours}} h', { hours: formatNumberExact(v.by) });
    if (v.state === 'within') return t('underPlanHours', '{{hours}} h left', { hours: formatNumberExact(v.by) });
    return t('noPlan', 'No plan');
  };

  // FR-WPVA-012: crew hours are Approved weeks only; hours on a week not yet approved are named, never counted.
  const pendingText = (hours: number) => t('pendingCrewHours', '{{hours}} h on timesheets not yet approved are not counted.', { hours: formatNumberExact(hours) });

  const reasonText = (l: CostAmountLine) => ({
    counted: t('reason.counted', 'Counted'),
    commitment: t('reason.commitment', 'Commitment, not summed (its bill carries the cost)'),
    stocked: t('reason.stocked', 'Bought into stock, counted when issued'),
    transfer: t('reason.transfer', 'Moved to site, still on hand'),
    'no-rate': t('reason.noRate', 'Hours only, no rate set'),
    'not-posted': t('reason.notPosted', 'Not posted or approved yet'),
    unassigned: t('reason.unassigned', 'Not assigned to a work order'),
    'split-when-custom': t('reason.splitWhenCustom', 'Split only when a custom split is set'),
    'outside-basis': t('reason.outsideBasis', 'Not part of project actuals'),
    'unresolved-direct': t('reason.unresolvedDirect', 'Work-order cost cannot be determined'),
    'other-revenue': t('reason.otherRevenue', 'Other billed work'),
  })[l.reason];

  const sourceText = (l: CostAmountLine) => t(`source.${l.source}`, l.source);

  const basisTable = (lines: CostAmountLine[], id: string) => (
    <div id={id} className="overflow-x-auto py-2">
      {lines.length === 0
        ? <p className="text-sm text-muted-foreground">{t('noLines', 'No cost records yet.')}</p>
        : <table className="w-full text-sm">
          <caption className="sr-only">{t('basisCaption', 'Cost records behind these figures')}</caption>
          <thead><tr className="text-left text-muted-foreground">
            <th scope="col" className="py-1 pr-4 font-normal">{t('col.record', 'Record')}</th>
            <th scope="col" className="py-1 pr-4 font-normal">{t('col.discipline', 'Discipline')}</th>
            <th scope="col" className="py-1 pr-4 text-right font-normal">{t('col.amount', 'Amount')}</th>
            <th scope="col" className="py-1 font-normal">{t('col.counted', 'How it counts')}</th>
          </tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={`${l.source}:${l.recordId}`} className="border-t border-border">
              <td className="py-1 pr-4">{sourceText(l)}{l.reference ? ` ${l.reference}` : ''}</td>
              <td className="py-1 pr-4">{disciplineName(l.disciplineId)}</td>
              <td className="py-1 pr-4 text-right tabular-nums">
                {l.amount !== null && l.currency ? money(l.amount, l.currency)
                  : l.quantity !== null ? `${formatNumberExact(l.quantity)} ${l.quantityUnit === 'days' ? t('days', 'd') : t('hours', 'h')}` : ''}
              </td>
              <td className="py-1">{reasonText(l)}</td>
            </tr>
          ))}</tbody>
        </table>}
    </div>
  );

  const row = (w: PvaWorkOrder, f: WorkOrderFigures) => {
    const basisId = `wo-pva-basis-${w.id}`;
    const open = openBasis === w.id;
    return (
      <React.Fragment key={w.id}>
        <tr className="border-t border-border align-top" data-testid={`wo-pva-row-${w.id}`}>
          <th scope="row" className="py-2 pr-4 text-left font-medium">
            {w.woNumber ?? t('draftNumber', 'Draft')} <span className="font-normal text-muted-foreground">{w.title}</span>
          </th>
          <td className="py-2 pr-4 text-right tabular-nums">{f.plan.direct_budget === null ? t('noPlan', 'No plan') : money(f.plan.direct_budget, w.currency)}</td>
          <td className="py-2 pr-4 text-right tabular-nums" data-testid="wo-pva-direct">{money(f.direct, w.currency)}
            <div className="text-muted-foreground">{variantText(f.plan.direct_budget, f.direct, w.currency)}</div>
          </td>
          <td className="py-2 pr-4 text-right tabular-nums" data-testid="wo-pva-allocated">{money(f.allocated, w.currency)}</td>
          <td className="py-2 pr-4 text-right tabular-nums">{w.revenue === null || !w.revenueComplete ? t('revenueUnknown', 'Revenue unknown') : money(w.revenue, w.currency)}
            {w.orderValue != null && <div className="text-muted-foreground">{t('orderValue', 'Order value (ceiling)')}: {money(w.orderValue, w.currency)}</div>}
          </td>
          <td className="py-2 pr-4 text-right tabular-nums" data-testid="wo-pva-direct-margin">{marginText(f.directMargin, w.currency)}</td>
          <td className="py-2 pr-4 text-right tabular-nums" data-testid="wo-pva-result">{marginText(f.result, w.currency)}</td>
          <td className="py-2 text-right">
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={basisId} onClick={() => setOpenBasis(open ? null : w.id)}>
                {t('basis', 'Basis')}
              </Button>
              {canPlan && w.status !== 'Cancelled' && <Button variant="outline" size="sm" onClick={() => setPlanFor(w)}>{t('editPlan', 'Plan')}</Button>}
            </div>
          </td>
        </tr>
        {open && (
          <tr><td colSpan={8} className="pb-3">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 py-2 text-sm sm:grid-cols-4">
              <div><dt className="text-muted-foreground">{t('equipmentHours', 'Equipment hours')}</dt><dd className="tabular-nums">{formatNumberExact(f.equipmentHours)} · {hoursText(f.plan.equipment_hours, f.equipmentHours)}</dd></div>
              {f.equipmentDays > 0 && <div><dt className="text-muted-foreground">{t('equipmentDays', 'Equipment days (kept apart)')}</dt><dd className="tabular-nums">{formatNumberExact(f.equipmentDays)}</dd></div>}
              <div><dt className="text-muted-foreground">{t('crewHours', 'Crew hours')}</dt><dd className="tabular-nums">{formatNumberExact(f.crewHours)} · {hoursText(f.plan.crew_hours, f.crewHours)}</dd></div>
              <div><dt className="text-muted-foreground">{t('crewSize', 'People with hours')}</dt><dd className="tabular-nums">{formatNumberExact(f.crewSize)}</dd></div>
              <div><dt className="text-muted-foreground">{t('indirectPlan', 'Indirect budget')}</dt><dd className="tabular-nums">{f.plan.indirect_budget === null ? t('noPlan', 'No plan') : `${money(f.plan.indirect_budget, w.currency)} · ${variantText(f.plan.indirect_budget, f.allocated, w.currency)}`}</dd></div>
              {f.otherCurrency.map((o) => (
                <div key={o.currency}><dt className="text-muted-foreground">{t('otherCurrency', 'Cost in {{currency}}, listed apart', { currency: o.currency })}</dt><dd className="tabular-nums">{money(o.amount, o.currency)}</dd></div>
              ))}
            </dl>
            {f.disciplines.length > 0 && (
              <ul className="py-1 text-sm">{f.disciplines.map((d) => (
                <li key={d.disciplineId ?? 'none'}>{disciplineName(d.disciplineId)}: {t('col.plan', 'Planned direct')} {d.planDirect === null ? t('noPlan', 'No plan') : money(d.planDirect, w.currency)} · {money(d.direct, w.currency)} {t('directShort', 'direct')}{d.planDirect !== null && ` · ${variantText(d.planDirect, d.direct, w.currency)}`} · {t('col.planIndirect', 'Planned indirect')} {d.planIndirect === null ? t('noPlan', 'No plan') : money(d.planIndirect, w.currency)} · {money(d.allocated, w.currency)} {t('sharedShort', 'shared')}{d.planIndirect !== null && ` · ${variantText(d.planIndirect, d.allocated, w.currency)}`}</li>
              ))}</ul>
            )}
            {f.labour && f.labour.length > 0 && <LabourByClass labour={f.labour} currency={w.currency} testId={`wo-pva-labour-${w.id}`} />}
            {f.pendingCrewHours > 0 && <p className="text-sm text-muted-foreground">{pendingText(f.pendingCrewHours)}</p>}
            {f.uncostedHours > 0 && <p className="text-sm text-muted-foreground">{t('uncosted', '{{hours}} h carry no rate and are not in the cost.', { hours: formatNumberExact(f.uncostedHours) })}</p>}
            {basisTable(f.lines, basisId)}
          </td></tr>
        )}
      </React.Fragment>
    );
  };

  return (
    <Card className="min-w-0" data-testid="wo-plan-vs-actual">
      <CardHead level={2} className="text-base" actions={canSplit && workOrders.some((w) => w.status !== 'Cancelled')
        ? <Button variant="outline" size="sm" onClick={() => setSplitOpen(true)}>{t('editSplit', 'Shared-cost split')}</Button> : undefined}>
        {title}
      </CardHead>
      <CardPad className="pt-0">
        {basisNote.map((n) => <p key={n} className="text-sm text-muted-foreground" data-testid="wo-pva-basis-note">{n}</p>)}
        {workOrders.length === 0 && <p className="text-sm text-muted-foreground">{t('empty', 'No work orders on this project yet.')}</p>}
        {(workOrders.length > 0 || rollup.totals.length > 0) && <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{title}</caption>
              <thead><tr className="text-right text-muted-foreground">
                <th scope="col" className="py-2 pr-4 text-left font-normal">{t('col.workOrder', 'Work order')}</th>
                <th scope="col" className="py-2 pr-4 font-normal">{t('col.plan', 'Planned direct')}</th>
                <th scope="col" className="py-2 pr-4 font-normal">{t('col.direct', 'Direct cost')}</th>
                <th scope="col" className="py-2 pr-4 font-normal">{t('col.shared', 'Shared cost')}</th>
                <th scope="col" className="py-2 pr-4 font-normal">{t('col.revenue', 'Billed revenue')}</th>
                <th scope="col" className="py-2 pr-4 font-normal">{t('col.directMargin', 'Direct margin')}</th>
                <th scope="col" className="py-2 pr-4 font-normal">{t('col.result', 'After shared cost')}</th>
                <th scope="col" className="py-2 font-normal"><span className="sr-only">{t('col.actions', 'Actions')}</span></th>
              </tr></thead>
              <tbody>
                {workOrders.map((w) => { const f = figures.get(w.id); return f ? row(w, f) : null; })}
                {rollup.totals.map((tot) => (
                  <React.Fragment key={tot.currency}>
                    {tot.notAssigned !== '0.00' && (
                      <tr className="border-t border-border" data-testid={`wo-pva-not-assigned-${tot.currency}`}>
                        <th scope="row" className="py-2 pr-4 text-left font-normal">{t('notAssigned', 'Not assigned')}</th>
                        <td colSpan={2} />
                        <td className="py-2 pr-4 text-right tabular-nums">{money(tot.notAssigned, tot.currency)}</td>
                        <td colSpan={4} />
                      </tr>
                    )}
                    <tr className="border-t-2 border-border font-medium" data-testid={`wo-pva-total-${tot.currency}`}>
                      <th scope="row" className="py-2 pr-4 text-left">{t('projectTotal', 'Project and contract total')} ({tot.currency})</th>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {tot.planDirect === null ? t('noPlan', 'No plan') : money(tot.planDirect, tot.currency)}
                        {tot.planDirect !== null && <div className="font-normal text-muted-foreground">{variantText(tot.planDirect, tot.direct, tot.currency)}</div>}
                        <div className="font-normal text-muted-foreground">{t('col.planIndirect', 'Planned indirect')}: {tot.planIndirect === null ? t('noPlan', 'No plan') : money(tot.planIndirect, tot.currency)}</div>
                      </td>
                      <td colSpan={2} className="py-2 pr-4 text-right tabular-nums">{money(tot.total, tot.currency)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{money(tot.revenue, tot.currency)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{marginText(tot.directMargin, tot.currency)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{marginText(tot.result, tot.currency)}</td>
                      <td />
                    </tr>
                    {tot.hasOtherRevenue && <tr className="border-t border-border">
                      <th scope="row" className="py-2 pr-4 text-left font-normal">{t('source.other_revenue', 'Other revenue')}</th>
                      <td colSpan={3} />
                      <td className="py-2 pr-4 text-right tabular-nums">{money(tot.otherRevenue, tot.currency)}</td>
                      <td colSpan={3} />
                    </tr>}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>}
        {rollup.hours && (workOrders.length > 0 || rollup.hours.equipmentHours > 0 || rollup.hours.equipmentDays > 0 || rollup.hours.crewHours > 0) && (
          <section className="mt-4 text-sm" data-testid="wo-pva-project-hours">
            <h3 className="font-medium">{t('projectHours', 'Project and contract hours')}</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 py-2 sm:grid-cols-4">
              <div><dt className="text-muted-foreground">{t('equipmentHours', 'Equipment hours')}</dt><dd>{formatNumberExact(rollup.hours.equipmentHours)} · {t('planLabel', 'Plan')}: {rollup.hours.planEquipmentHours === null ? t('noPlan', 'No plan') : formatNumberExact(rollup.hours.planEquipmentHours)}</dd></div>
              {rollup.hours.equipmentDays > 0 && <div><dt className="text-muted-foreground">{t('equipmentDays', 'Equipment days (kept apart)')}</dt><dd>{formatNumberExact(rollup.hours.equipmentDays)}</dd></div>}
              <div><dt className="text-muted-foreground">{t('crewHours', 'Crew hours')}</dt><dd>{formatNumberExact(rollup.hours.crewHours)} · {t('planLabel', 'Plan')}: {rollup.hours.planCrewHours === null ? t('noPlan', 'No plan') : formatNumberExact(rollup.hours.planCrewHours)}</dd></div>
              <div><dt className="text-muted-foreground">{t('crewSize', 'People with hours')}</dt><dd>{formatNumberExact(rollup.hours.crewSize)}</dd></div>
            </dl>
            {rollup.hours.pendingCrewHours > 0 && <p className="text-muted-foreground">{pendingText(rollup.hours.pendingCrewHours)}</p>}
          </section>
        )}
        {rollup.disciplines.length > 0 && (
          <div className="mt-4 overflow-x-auto" data-testid="wo-pva-disciplines">
            <table className="w-full text-sm">
              <caption className="py-1 text-left font-medium">{t('byDiscipline', 'By discipline')}</caption>
              <thead><tr className="text-right text-muted-foreground">
                <th scope="col" className="py-1 pr-4 text-left font-normal">{t('col.discipline', 'Discipline')}</th>
                <th scope="col" className="py-1 pr-4 font-normal">{t('col.plan', 'Planned direct')}</th>
                <th scope="col" className="py-1 pr-4 font-normal">{t('col.direct', 'Direct cost')}</th>
                <th scope="col" className="py-1 pr-4 font-normal">{t('col.planIndirect', 'Planned indirect')}</th>
                <th scope="col" className="py-1 font-normal">{t('col.shared', 'Shared cost')}</th>
              </tr></thead>
              <tbody>{rollup.disciplines.map((d) => (
                <tr key={`${d.currency}:${d.disciplineId ?? ''}`} className="border-t border-border">
                  <th scope="row" className="py-1 pr-4 text-left font-normal">{disciplineName(d.disciplineId)}</th>
                  <td className="py-1 pr-4 text-right tabular-nums">{d.planDirect === null ? t('noPlan', 'No plan') : money(d.planDirect, d.currency)}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{money(d.direct, d.currency)}{d.planDirect !== null && <div className="text-muted-foreground">{variantText(d.planDirect, d.direct, d.currency)}</div>}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{d.planIndirect === null ? t('noPlan', 'No plan') : money(d.planIndirect, d.currency)}</td>
                  <td className="py-1 text-right tabular-nums">{money(d.allocated, d.currency)}{d.planIndirect !== null && <div className="text-muted-foreground">{variantText(d.planIndirect, d.allocated, d.currency)}</div>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {rollup.sharedLines.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer">{t('sharedBasis', 'Shared cost records')}</summary>
            {basisTable(rollup.sharedLines, 'wo-pva-shared-basis')}
          </details>
        )}
      </CardPad>
      {planFor && (
        <WorkOrderPlanModal
          projectId={projectId}
          workOrder={planFor}
          plans={data.plans.filter((p) => p.workOrderId === planFor.id && p.disciplineId === null)}
          onClose={() => setPlanFor(null)}
        />
      )}
      {splitOpen && (
        <SharedCostSplitModal
          projectId={projectId}
          workOrders={workOrders.filter((w) => w.status !== 'Cancelled')}
          split={data.split}
          onClose={() => setSplitOpen(false)}
        />
      )}
    </Card>
  );
};

export default WorkOrderPlanVsActual;
