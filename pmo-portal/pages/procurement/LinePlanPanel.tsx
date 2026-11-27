import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardHead, CardPad, DateField, FieldError, ListState } from '@/src/components/ui';
import { LinePlanTable } from './LinePlanTable';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDay } from '@/src/lib/format';
import { useRefusalLine } from '@/src/lib/refusals';
import { useLineCategories, useLinePlanningEnabled } from '@/src/hooks/usePurchaseLinePlanning';
import { usePoNeededByRequired, useProcurementNeededBy } from '@/src/hooks/usePoNeededBy';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useCostDisciplines } from '@/src/hooks/useWorkOrderCosts';
import { setProcurementLinePlanning } from '@/src/lib/db/procurementLinePlanning';
import { repositories } from '@/src/lib/repositories';
import { workOrderCostRepository } from '@/src/lib/repositories/workOrderCosts';
import {
  groupLinesByAttribution, lineValuesOf, NO_LINE_ATTRIBUTION, type LineAttributionValue, type LineWorkOrderOption,
} from './lineWorkOrderValue';

export type PlanLine = {
  id: string;
  name: string;
  category_id?: string | null;
  needed_by?: string | null;
  work_order_id?: string | null;
  discipline_id?: string | null;
};

export interface LinePlanPanelProps {
  procurementId: string;
  items: readonly PlanLine[];
  projectId: string | null | undefined;
  /** The purchase header's work order (the request's). */
  requestWorkOrderId: string | null | undefined;
  /** Category (and, without the order needed-by rule, the line date): a Draft the caller may edit. */
  planningEditable: boolean;
  /** The order needed-by date and each line's own date, while the organisation requires it: until the order is sent. */
  neededByEditable: boolean;
  /** Each line's work order and discipline. */
  workOrdersEditable: boolean;
}


/**
 * The case's line planning, one row per line: its category, the date it is needed and the work order (and discipline) it is
 * for. One question, "when and for what is each line needed", in one table with one Save. Each column appears only where the
 * organisation uses it (line planning, the order needed-by rule, a project's work orders). Each value keeps its own write:
 * set_procurement_line_planning, the order's needed-by call and set_cost_attribution; the database decides who may write.
 */
export const LinePlanPanel: React.FC<LinePlanPanelProps> = ({ procurementId, items, projectId, requestWorkOrderId, planningEditable, neededByEditable, workOrdersEditable }) => {
  const { t } = useTranslation('procurement');
  const refusalLine = useRefusalLine();
  const qc = useQueryClient();

  const planningOn = useLinePlanningEnabled();
  const categories = useLineCategories(planningOn);
  const required = usePoNeededByRequired();
  const orderRule = required.data === true;
  const header = useProcurementNeededBy(procurementId, orderRule);
  const orders = useProjectWorkOrders(projectId ?? '');
  const disciplines = useCostDisciplines();

  const signature = items.map((i) => `${i.id}:${i.category_id ?? ''}:${i.needed_by ?? ''}:${i.work_order_id ?? ''}:${i.discipline_id ?? ''}`).join('|');
  const [category, setCategory] = useState<Record<string, string>>({});
  const [neededBy, setNeededBy] = useState<Record<string, string>>({});
  const [attribution, setAttribution] = useState<Record<string, LineAttributionValue>>({});
  const [orderDate, setOrderDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    setCategory(Object.fromEntries(items.map((i) => [i.id, i.category_id ?? ''])));
    setNeededBy(Object.fromEntries(items.map((i) => [i.id, i.needed_by ?? ''])));
    setAttribution(lineValuesOf(items));
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (header.data !== undefined) setOrderDate(header.data ?? ''); }, [header.data]);

  const workOrderOptions: LineWorkOrderOption[] = useMemo(
    () => (orders.data ?? []).map((wo) => ({ id: wo.id, label: wo.wo_number ?? wo.title, cancelled: wo.status === 'Cancelled' })),
    [orders.data],
  );
  const requestWorkOrder = requestWorkOrderId
    ? { id: requestWorkOrderId, label: workOrderOptions.find((o) => o.id === requestWorkOrderId)?.label ?? t('lineWorkOrders.unknownWorkOrder', 'A work order you cannot open') }
    : null;

  if (items.length === 0) return null;

  const hasProject = Boolean(projectId);
  const workOrdersReady = hasProject && !orders.isLoading && !orders.isError;
  const lineCarriesWorkOrder = items.some((i) => i.work_order_id || i.discipline_id);
  const showWorkOrders = workOrdersReady && (workOrderOptions.length > 0 || lineCarriesWorkOrder);
  const showCategory = planningOn;
  const showNeededBy = planningOn || orderRule;
  const settingPending = required.data === undefined && required.isPending;
  const settingFailed = required.data === undefined && required.isError;
  const headerPending = orderRule && header.data === undefined && header.isPending;
  const headerFailed = orderRule && header.data === undefined && header.isError;

  const categoryEditable = planningEditable;
  const dateEditable = orderRule ? neededByEditable : planningEditable;
  const attributionEditable = workOrdersEditable && workOrderOptions.length > 0;

  const categoryOptions = [{ value: '', label: t('linePlanning.none', 'None') }, ...(categories.data ?? []).filter((c) => !c.archived_at).map((c) => ({ value: c.id, label: c.name }))];
  const attributionOf = (id: string) => attribution[id] ?? NO_LINE_ATTRIBUTION;

  const planningChanged = items.filter((i) => (category[i.id] ?? '') !== (i.category_id ?? '') || (!orderRule && (neededBy[i.id] ?? '') !== (i.needed_by ?? '')));
  const orderDateChanged = orderRule && orderDate !== (header.data ?? '');
  const lineDatesChanged = orderRule && items.some((i) => (neededBy[i.id] ?? '') !== (i.needed_by ?? ''));
  const attributionChanged = items.filter((i) => {
    const v = attributionOf(i.id);
    return v.workOrderId !== (i.work_order_id ?? '') || v.disciplineId !== (i.discipline_id ?? '');
  });
  const anyEditable = (showCategory && categoryEditable) || (showNeededBy && dateEditable) || (showWorkOrders && attributionEditable);

  const save = async () => {
    setSaving(true); setSaved(false); setFailure(null);
    const writes: { label: string; run: () => Promise<unknown> }[] = planningChanged.map((i) => ({
      label: `${i.name} (${t('linePlan.planningChange', 'category and line date')})`,
      run: () => setProcurementLinePlanning(i.id, category[i.id] || null, (orderRule ? i.needed_by : neededBy[i.id]) || null),
    }));
    if (orderDateChanged || lineDatesChanged) {
      const lines = items.flatMap((i) => {
        const value = neededBy[i.id] ?? '';
        if (value === (i.needed_by ?? '') && !(orderDateChanged && value !== '' && value === orderDate)) return [];
        return [{ itemId: i.id, neededBy: value === '' || value === orderDate ? null : value }];
      });
      writes.push({
        label: t('linePlan.dateChange', 'Order and line dates: {{lines}}', { lines: items.filter((i) => orderDateChanged || lines.some((l) => l.itemId === i.id)).map((i) => i.name).join(', ') }),
        run: () => repositories.procurement.setNeededBy(procurementId, orderDate || null, lines),
      });
    }
    const changed = Object.fromEntries(attributionChanged.map((i) => [i.id, attributionOf(i.id)]));
    for (const g of groupLinesByAttribution(changed)) {
      writes.push({
        label: `${items.filter((i) => g.ids.includes(i.id)).map((i) => i.name).join(', ')} (${t('linePlan.attributionChange', 'work order and discipline')})`,
        run: async () => {
          try { return await workOrderCostRepository.setAttribution('procurement_item', g.ids, { workOrderId: g.workOrderId, disciplineId: g.disciplineId }); }
          catch (e) { throw new Error(refusalLine(e), { cause: e }); }
        },
      });
    }
    let completed = 0;
    try {
      for (const write of writes) {
        await write.run();
        completed += 1;
      }
      setSaved(true);
    } catch (e) {
      const error = classifyMutationError(e);
      setFailure(t('linePlan.partialSave', 'Saved: {{saved}}. Save not confirmed: {{unconfirmed}}. Not attempted: {{unattempted}}. {{reason}}', {
        saved: writes.slice(0, completed).map((w) => w.label).join('; ') || t('linePlanning.none', 'None'),
        unconfirmed: writes[completed]?.label ?? t('linePlanning.none', 'None'),
        unattempted: writes.slice(completed + 1).map((w) => w.label).join('; ') || t('linePlanning.none', 'None'),
        reason: error.detail || error.headline,
      }));
    } finally {
      if (completed > 0) {
        void qc.invalidateQueries({ queryKey: ['procurement'] });
        void qc.invalidateQueries({ queryKey: ['work-order-cost'] });
        if (orderDateChanged || lineDatesChanged) void header.refetch();
      }
      setSaving(false);
    }
  };
  const touch = () => { setSaved(false); setFailure(null); };

  // The order date sits in the heading row: one date that fills every line, a line's own date overriding it.
  const orderDateControl = orderRule && header.data !== undefined ? (
    neededByEditable
      ? <DateField label={t('orderNeededBy.orderDate', 'Order needed by')} compact value={orderDate} disabled={saving} className="w-44"
          helper={t('linePlan.orderDateHelp', 'Required to send the order. Fills every line.')}
          onChange={(next) => { touch(); setOrderDate(next); }} />
      : <p className="text-control"><span className="text-muted-foreground">{t('orderNeededBy.orderDate', 'Order needed by')}</span> <span data-testid="order-needed-by-value" className="font-medium">{header.data ? formatDay(header.data) : '—'}</span></p>
  ) : null;

  const footLines: React.ReactNode[] = [];
  if (hasProject && orders.isError) footLines.push(<p key="wo-error" role="alert" className="flex flex-wrap items-center gap-3 text-control text-destructive-text">{t('lineWorkOrders.loadError', 'Could not load this project’s work orders.')}<Button variant="outline" size="sm" onClick={() => void orders.refetch()}>{t('common.retry', 'Retry')}</Button></p>);
  if (workOrdersReady && !showWorkOrders) footLines.push(<p key="wo-none" data-testid="line-work-orders-empty" className="text-control text-muted-foreground">{t('linePlan.noWorkOrders', 'No work orders on this project yet, so lines take none. A project manager adds them on the project’s Work orders tab.')}</p>);
  if (showCategory && categoryEditable && categoryOptions.length === 1) footLines.push(<p key="no-cats" data-testid="line-planning-no-categories" className="text-control text-muted-foreground">{t('linePlanning.noCategoriesHere', 'No categories yet. An Admin adds them under Line planning in Accounting setup.')}</p>);

  const settingState = settingPending || headerPending
    ? <ListState variant="loading" rows={1} />
    : settingFailed
      ? <ListState variant="error" quiet title={t('orderNeededBy.loadError', "Couldn't load this setting")} onRetry={() => void required.refetch()} />
      : headerFailed
        ? <ListState variant="error" quiet title={t('orderNeededBy.valueLoadError', "Couldn't load this order's needed-by date")} onRetry={() => void header.refetch()} />
        : null;

  const hasColumns = showCategory || showNeededBy || showWorkOrders;
  if (!settingState && !hasColumns && footLines.length === 0) return null;
  return (
    <Card data-testid="line-plan-panel">
      <CardHead actions={orderDateControl}>{t('linePlanning.heading', 'Line planning')}</CardHead>
      {settingState && <CardPad>{settingState}</CardPad>}
      <LinePlanTable
        lines={items}
        busy={saving}
        category={showCategory ? { values: category, categories: categories.data ?? [], editable: categoryEditable, onChange: (id, next) => { touch(); setCategory((c) => ({ ...c, [id]: next })); } } : undefined}
        neededBy={showNeededBy ? { values: neededBy, editable: dateEditable, orderDate: orderRule ? (dateEditable ? orderDate : header.data) : null, onChange: (id, next) => { touch(); setNeededBy((d) => ({ ...d, [id]: next })); } } : undefined}
        workOrders={showWorkOrders ? {
          values: attribution, options: workOrderOptions, requestWorkOrder, editable: attributionEditable,
          disciplines: (disciplines.data ?? []).map((d) => ({ id: d.id, label: d.name })),
          onChange: (id, next) => { touch(); setAttribution((a) => ({ ...a, [id]: next })); },
        } : undefined}
      />
      {(footLines.length > 0 || (anyEditable && hasColumns) || failure) && (
        <CardPad className="flex flex-col gap-3">
          {footLines}
          {anyEditable && hasColumns && (
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" loading={saving} onClick={() => void save()}>{t('linePlanning.save', 'Save')}</Button>
              <p role="status" className="text-control text-muted-foreground">{saved ? t('linePlanning.saved', 'Saved') : ''}</p>
            </div>
          )}
          {failure && <FieldError>{failure}</FieldError>}
        </CardPad>
      )}
    </Card>
  );
};
