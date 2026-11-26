import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Card, CardHead, CardPad, Drawer, Icon, ListState } from '@/src/components/ui';
import { buttonClasses } from '@/src/components/ui/buttonClasses';
import { RowOpenControl } from '@/src/components/ui/RowOpenControl';
import { usePermission } from '@/src/auth/usePermission';
import { formatNumberExact, formatTableMoney } from '@/src/lib/format';
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
import { PvaTable, type PvaCell, type PvaRow } from './PvaTable';
import { LabourByClass } from '../work-order-detail/LabourByClass';
import { IdleCostBlock } from '../work-order-detail/IdleCostBlock';

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
    value === null ? t('unknown', 'Unknown') : formatTableMoney(value, currency) ?? t('unknown', 'Unknown');

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

  // The row's drawer (triage): what is behind this work order's figures; the full page stays the depth.
  const drawerBody = (w: PvaWorkOrder, f: WorkOrderFigures) => (
    <div className="space-y-6 text-control" data-testid={`wo-pva-drawer-${w.id}`}>
      {f.disciplines.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">{t('byDiscipline', 'By discipline')}</h3>
          <PvaTable caption={t('byDiscipline', 'By discipline')} firstColumn={t('col.discipline', 'Discipline')} groups={legGroups}
            columns={[...legColumns('direct'), ...legColumns('shared')]}
            rows={f.disciplines.map((d) => ({ key: d.disciplineId ?? 'none', head: disciplineName(d.disciplineId),
              cells: [planCell(d.planDirect, w.currency), cell(money(d.direct, w.currency)), diffCell(d.planDirect, d.direct, w.currency),
                planCell(d.planIndirect, w.currency), cell(money(d.allocated, w.currency)), diffCell(d.planIndirect, d.allocated, w.currency)] }))} />
        </section>
      )}
      {f.otherCurrency.length > 0 && (
        <dl className="space-y-1">{f.otherCurrency.map((o) => (
          <div key={o.currency} className="flex justify-between gap-6"><dt className="text-muted-foreground">{t('otherCurrency', 'Cost in {{currency}}, listed apart', { currency: o.currency })}</dt><dd className="tabular-nums">{money(o.amount, o.currency)}</dd></div>
        ))}</dl>
      )}
      {f.labour && f.labour.length > 0 && <LabourByClass labour={f.labour} currency={w.currency} testId={`wo-pva-labour-${w.id}`} />}
      <IdleCostBlock projectId={projectId} workOrderId={w.id} testId={`wo-pva-idle-${w.id}`} />
      <section>
        <h3 className="mb-1 font-semibold">{t('basisCaption', 'Cost records behind these figures')}</h3>
        {f.pendingCrewHours > 0 && <p className="text-muted-foreground">{pendingText(f.pendingCrewHours)}</p>}
        {f.uncostedHours > 0 && <p className="text-muted-foreground">{t('uncosted', '{{hours}} h carry no rate and are not in the cost.', { hours: formatNumberExact(f.uncostedHours) })}</p>}
        {basisTable(f.lines, `wo-pva-basis-${w.id}`)}
      </section>
    </div>
  );

  // Same family as the work order page's own section: Plan · Actual per leg, and what is left or over in its own column.
  const cell = (text: string, words = false, testId?: string): PvaCell => ({ text, tone: words ? 'words' : undefined, testId });
  const planCell = (plan: string | null, currency: string, testId?: string) => plan === null ? cell(t('noPlan', 'No plan'), true, testId) : cell(money(plan, currency), false, testId);
  const diffCell = (plan: string | null, actual: string | null, currency: string, testId?: string): PvaCell => {
    const v = planVariance(plan, actual);
    if (v.state === 'over') return { text: variantText(plan, actual, currency), tone: 'over', testId };
    if (v.state === 'no-plan') return { text: '—', tone: 'words', testId };
    return cell(variantText(plan, actual, currency), true, testId);
  };
  const hoursDiff = (plan: number | null, actual: number): PvaCell => {
    const v = hoursVariance(plan, actual);
    if (v.state === 'no-plan') return { text: '—', tone: 'words' };
    return { text: hoursText(plan, actual), tone: v.state === 'over' ? 'over' : 'words' };
  };
  const hoursPlan = (plan: number | null): PvaCell => plan === null ? cell(t('noPlan', 'No plan'), true) : cell(formatNumberExact(plan));
  const marginCell = (m: Margin, currency: string, testId: string): PvaCell =>
    ({ text: marginText(m, currency), testId, tone: m.amount === null ? 'words' : m.amount.startsWith('-') && !/^-0(\.0+)?$/.test(m.amount) ? 'over' : undefined });
  const planShort = t('col.planShort', 'Plan');
  const actualShort = t('col.actualShort', 'Actual');
  const diffShort = t('col.difference', 'Left or over');
  const legColumns = (leg: string) => [
    { key: `${leg}-plan`, label: planShort }, { key: `${leg}-actual`, label: actualShort }, { key: `${leg}-diff`, label: diffShort },
  ];
  const multiCurrency = rollup.totals.length > 1;
  const totalLabel = (currency: string) => multiCurrency ? `${t('projectTotal', 'Project and contract total')} (${currency})` : t('projectTotal', 'Project and contract total');
  const live = workOrders.filter((w) => figures.has(w.id));
  const zero = (v: string | null) => v === null || /^-?0(\.0+)?$/.test(v);
  // Nothing planned and nothing spent: one line and the Plan action, never a wall of zeros.
  const nothingYet = live.length > 0 && rollup.totals.every((tot) => tot.planDirect === null && tot.planIndirect === null && zero(tot.total) && zero(tot.notAssigned) && zero(tot.revenue) && !tot.hasOtherRevenue)
    && live.every((w) => { const f = figures.get(w.id)!; return f.plan.equipment_hours === null && f.plan.crew_hours === null && f.equipmentHours === 0 && f.equipmentDays === 0 && f.crewHours === 0 && f.otherCurrency.length === 0; });

  const woHead = (w: PvaWorkOrder) => (
    <RowOpenControl href={`/work-orders/${w.id}`} label={t('openDetails', '{{number}} {{title}}, details', { number: w.woNumber ?? t('draftNumber', 'Draft'), title: w.title })} onActivate={() => setOpenBasis(w.id)}>
      <span className="font-medium text-foreground underline-offset-2 hover:underline">{w.woNumber ?? t('draftNumber', 'Draft')}</span>
      <span className="block text-muted-foreground">{w.title}</span>
    </RowOpenControl>
  );
  const planAction = (w: PvaWorkOrder) => canPlan && w.status !== 'Cancelled'
    ? <Button variant="outline" size="sm" onClick={() => setPlanFor(w)}>{t('editPlan', 'Plan')}</Button> : undefined;

  const costRows: PvaRow[] = [
    ...live.map((w): PvaRow => {
      const f = figures.get(w.id)!;
      return {
        key: w.id, testId: `wo-pva-row-${w.id}`, head: woHead(w), action: planAction(w),
        cells: [
          planCell(f.plan.direct_budget, w.currency, 'wo-pva-plan-direct'), cell(money(f.direct, w.currency), false, 'wo-pva-direct'), diffCell(f.plan.direct_budget, f.direct, w.currency, 'wo-pva-difference'),
          planCell(f.plan.indirect_budget, w.currency, 'wo-pva-plan-indirect'), cell(money(f.allocated, w.currency), false, 'wo-pva-allocated'), diffCell(f.plan.indirect_budget, f.allocated, w.currency, 'wo-pva-shared-difference'),
        ],
      };
    }),
    ...rollup.totals.flatMap((tot): PvaRow[] => [
      ...(zero(tot.notAssigned) ? [] : [{ key: `na-${tot.currency}`, testId: `wo-pva-not-assigned-${tot.currency}`, head: t('notAssigned', 'Not assigned'),
        cells: [null, null, null, null, cell(money(tot.notAssigned, tot.currency)), null] }]),
      { key: `tot-${tot.currency}`, testId: `wo-pva-total-${tot.currency}`, head: totalLabel(tot.currency), total: true,
        cells: [planCell(tot.planDirect, tot.currency), cell(money(tot.direct, tot.currency)), diffCell(tot.planDirect, tot.direct, tot.currency),
          planCell(tot.planIndirect, tot.currency), null, null] },
    ]),
  ];

  const billedRows: PvaRow[] = [
    ...live.map((w): PvaRow => {
      const f = figures.get(w.id)!;
      return {
        key: w.id, testId: `wo-pva-margin-row-${w.id}`, head: woHead(w),
        cells: [
          w.orderValue == null ? cell('—', true) : cell(money(w.orderValue, w.currency), false, 'wo-pva-order-value'),
          w.revenue === null || !w.revenueComplete ? cell(t('revenueUnknown', 'Revenue unknown'), true, 'wo-pva-revenue') : cell(money(w.revenue, w.currency), false, 'wo-pva-revenue'),
          marginCell(f.directMargin, w.currency, 'wo-pva-direct-margin'), marginCell(f.result, w.currency, 'wo-pva-result'),
        ],
      };
    }),
    ...rollup.totals.flatMap((tot): PvaRow[] => [
      ...(tot.hasOtherRevenue ? [{ key: `or-${tot.currency}`, head: t('source.other_revenue', 'Other revenue'), cells: [null, cell(money(tot.otherRevenue, tot.currency)), null, null] }] : []),
      { key: `tot-${tot.currency}`, testId: `wo-pva-margin-total-${tot.currency}`, head: totalLabel(tot.currency), total: true,
        cells: [null, cell(money(tot.revenue, tot.currency)), marginCell(tot.directMargin, tot.currency, 'wo-pva-total-direct-margin'), marginCell(tot.result, tot.currency, 'wo-pva-total-result')] },
    ]),
  ];

  const hours = rollup.hours;
  const showDays = (hours?.equipmentDays ?? 0) > 0 || live.some((w) => (figures.get(w.id)?.equipmentDays ?? 0) > 0);
  const hoursColumns = [...legColumns('eq'), ...legColumns('crew'), { key: 'people', label: t('crewSize', 'People with hours') },
    ...(showDays ? [{ key: 'days', label: t('equipmentDays', 'Equipment days (kept apart)') }] : [])];
  const hoursRows: PvaRow[] = [
    ...live.map((w): PvaRow => {
      const f = figures.get(w.id)!;
      return {
        key: w.id, testId: `wo-pva-hours-row-${w.id}`, head: woHead(w),
        cells: [hoursPlan(f.plan.equipment_hours), cell(formatNumberExact(f.equipmentHours)), hoursDiff(f.plan.equipment_hours, f.equipmentHours),
          hoursPlan(f.plan.crew_hours), cell(formatNumberExact(f.crewHours)), hoursDiff(f.plan.crew_hours, f.crewHours), cell(formatNumberExact(f.crewSize)),
          ...(showDays ? [cell(formatNumberExact(f.equipmentDays))] : [])],
      };
    }),
    ...(hours ? [{ key: 'tot', testId: 'wo-pva-hours-total', head: t('projectTotal', 'Project and contract total'), total: true,
      cells: [{ ...hoursPlan(hours.planEquipmentHours), testId: 'wo-pva-hours-plan-equipment' }, cell(formatNumberExact(hours.equipmentHours), false, 'wo-pva-hours-equipment'), hoursDiff(hours.planEquipmentHours, hours.equipmentHours),
        { ...hoursPlan(hours.planCrewHours), testId: 'wo-pva-hours-plan-crew' }, cell(formatNumberExact(hours.crewHours), false, 'wo-pva-hours-crew'), hoursDiff(hours.planCrewHours, hours.crewHours), cell(formatNumberExact(hours.crewSize)),
        ...(showDays ? [cell(formatNumberExact(hours.equipmentDays))] : [])] }] : []),
  ];
  const showHours = hours !== null && (live.length > 0 || hours.equipmentHours > 0 || hours.equipmentDays > 0 || hours.crewHours > 0);
  const pendingNote = hours && hours.pendingCrewHours > 0 ? <p className="mt-3 text-control text-muted-foreground">{pendingText(hours.pendingCrewHours)}</p> : null;

  const disciplineRows: PvaRow[] = rollup.disciplines.map((d) => ({
    key: `${d.currency}:${d.disciplineId ?? ''}`, head: disciplineName(d.disciplineId),
    cells: [planCell(d.planDirect, d.currency), cell(money(d.direct, d.currency)), diffCell(d.planDirect, d.direct, d.currency),
      planCell(d.planIndirect, d.currency), cell(money(d.allocated, d.currency)), diffCell(d.planIndirect, d.allocated, d.currency)],
  }));
  const legGroups: Array<[React.ReactNode, number]> = [[t('col.direct', 'Direct cost'), 3], [t('col.shared', 'Shared cost'), 3]];
  const opened = live.find((w) => w.id === openBasis) ?? null;
  const openedFigures = opened ? figures.get(opened.id) ?? null : null;

  return (
    <>
    <Card className="min-w-0" data-testid="wo-plan-vs-actual">
      <CardHead level={2} actions={canSplit && workOrders.some((w) => w.status !== 'Cancelled')
        ? <Button variant="outline" size="sm" onClick={() => setSplitOpen(true)}>{t('editSplit', 'Shared-cost split')}</Button> : undefined}>
        {title}
      </CardHead>
      <CardPad className="pt-0">
        {workOrders.length === 0 && rollup.totals.length === 0 && <p className="text-control text-muted-foreground">{t('empty', 'No work orders on this project yet.')}</p>}
        {nothingYet
          ? <>
              <p className="text-control text-muted-foreground" data-testid="wo-pva-nothing-yet">{t('nothingYet', 'Nothing planned or spent yet. Plan a work order to compare its cost with the plan.')}</p>
              <div className="mt-3">
                <PvaTable caption={title} firstColumn={t('col.workOrder', 'Work order')} actionsLabel={t('col.actions', 'Actions')}
                  columns={[{ key: 'ov', label: t('orderValue', 'Order value (ceiling)') }]}
                  rows={live.map((w) => ({ key: w.id, testId: `wo-pva-row-${w.id}`, head: woHead(w), action: planAction(w),
                    cells: [w.orderValue == null ? cell('—', true) : cell(money(w.orderValue, w.currency), false, 'wo-pva-order-value')] }))} />
              </div>
              {pendingNote}
            </>
          : (workOrders.length > 0 || rollup.totals.length > 0) && <>
              <PvaTable caption={title} firstColumn={t('col.workOrder', 'Work order')} groups={legGroups} columns={[...legColumns('direct'), ...legColumns('shared')]}
                actionsLabel={t('col.actions', 'Actions')} rows={costRows} />
              {rollup.totals.filter((tot) => tot.total !== null).map((tot) => (
                <p key={tot.currency} className="mt-3 flex flex-wrap justify-between gap-x-6 border-t border-border pt-3 text-control font-semibold" data-testid={`wo-pva-total-cost-${tot.currency}`}>
                  <span>{multiCurrency ? `${t('totalCost', 'Total cost, direct and shared')} (${tot.currency})` : t('totalCost', 'Total cost, direct and shared')}</span>
                  <span className="tabular-nums">{money(tot.total, tot.currency)}</span>
                </p>
              ))}
              {basisNote.map((n) => <p key={n} className="mt-3 text-control text-muted-foreground" data-testid="wo-pva-basis-note">{n}</p>)}
              {rollup.sharedLines.length > 0 && (
                <details className="mt-3 text-control">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t('sharedBasis', 'Shared cost records')}</summary>
                  {basisTable(rollup.sharedLines, 'wo-pva-shared-basis')}
                </details>
              )}
            </>}
      </CardPad>
    </Card>
    {!nothingYet && live.length > 0 && (
      <Card className="min-w-0" data-testid="wo-pva-billed">
        <CardHead level={2}>{t('billedTitle', 'Billed and margin')}</CardHead>
        <CardPad className="pt-0">
          <PvaTable caption={t('billedTitle', 'Billed and margin')} firstColumn={t('col.workOrder', 'Work order')}
            columns={[{ key: 'ov', label: t('orderValue', 'Order value (ceiling)') }, { key: 'rev', label: t('col.revenue', 'Billed revenue') },
              { key: 'dm', label: t('col.directMargin', 'Direct margin') }, { key: 'res', label: t('col.result', 'After shared cost') }]}
            rows={billedRows} />
        </CardPad>
      </Card>
    )}
    {!nothingYet && showHours && (
      <Card className="min-w-0" data-testid="wo-pva-project-hours">
        <CardHead level={2}>{t('projectHours', 'Project and contract hours')}</CardHead>
        <CardPad className="pt-0">
          <PvaTable caption={t('projectHours', 'Project and contract hours')} firstColumn={t('col.workOrder', 'Work order')}
            groups={[[t('equipmentHours', 'Equipment hours'), 3], [t('crewHours', 'Crew hours'), 3]]} columns={hoursColumns} rows={hoursRows} />
          {pendingNote}
        </CardPad>
      </Card>
    )}
    {!nothingYet && rollup.disciplines.length > 0 && (
      <Card className="min-w-0" data-testid="wo-pva-disciplines">
        <CardHead level={2}>{t('byDisciplineTitle', 'Cost by discipline')}</CardHead>
        <CardPad className="pt-0">
          <PvaTable caption={t('byDiscipline', 'By discipline')} firstColumn={t('col.discipline', 'Discipline')} groups={legGroups}
            columns={[...legColumns('direct'), ...legColumns('shared')]} rows={disciplineRows} />
        </CardPad>
      </Card>
    )}
    <Drawer open={opened !== null} onClose={() => setOpenBasis(null)} width="lg" icon={<Icon name="chev" />}
      title={opened ? opened.woNumber ?? t('draftNumber', 'Draft') : ''}
      subtitle={opened?.title}
      nestedOpen={planFor !== null}
      headerActions={opened ? <>
        {planAction(opened)}
        <Link to={`/work-orders/${opened.id}`} className={buttonClasses('outline', 'sm')} data-testid="wo-pva-open-page">{t('openPage', 'Open full page')}</Link>
      </> : undefined}>
      {opened && openedFigures && drawerBody(opened, openedFigures)}
    </Drawer>
      {planFor && (
        <WorkOrderPlanModal
          projectId={projectId}
          workOrder={planFor}
          plans={data.plans.filter((p) => p.workOrderId === planFor.id && p.disciplineId === null && (p.sectionId ?? null) === null)}
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
    </>
  );
};

export default WorkOrderPlanVsActual;
