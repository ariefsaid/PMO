import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardHead, CardPad, DataTable, DateField, FieldError, ListState, SelectField } from '@/src/components/ui';
import type { Column } from '@/src/components/ui';
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
  groupLinesByAttribution, lineDiffersFromRequest, lineValuesOf, lineWorkOrderChoices, NO_LINE_ATTRIBUTION, SAME_AS_REQUEST,
  type LineAttributionValue, type LineWorkOrderOption,
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

type Row = PlanLine;
const dateOf = (iso: string | null | undefined) => (iso ? formatDay(iso) : '—');

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
  const categoryName = (id: string) => (categories.data ?? []).find((c) => c.id === id)?.name;
  const sameLabel = requestWorkOrder
    ? t('lineWorkOrders.sameAsRequestNamed', 'Same as the request ({{workOrder}})', { workOrder: requestWorkOrder.label })
    : t('lineWorkOrders.sameAsRequest', 'Same as the request');
  const workOrderLabel = (id: string) => workOrderOptions.find((w) => w.id === id)?.label ?? t('lineWorkOrders.unknownWorkOrder', 'A work order you cannot open');
  const disciplineLabel = (id: string) => (disciplines.data ?? []).find((d) => d.id === id)?.name ?? t('lineWorkOrders.unknownDiscipline', 'A retired discipline');
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
    try {
      try {
        for (const i of planningChanged) {
          const date = orderRule ? (i.needed_by ?? '') : (neededBy[i.id] ?? '');
          await setProcurementLinePlanning(i.id, category[i.id] || null, date || null);
        }
        if (orderDateChanged || lineDatesChanged) {
          const lines = items.flatMap((i) => {
            const value = neededBy[i.id] ?? '';
            const current = i.needed_by ?? '';
            const headerChangedToLineDate = orderDateChanged && value !== '' && value === orderDate;
            if (value === current && !headerChangedToLineDate) return [];
            return [{ itemId: i.id, neededBy: value === '' || value === orderDate ? null : value }];
          });
          await repositories.procurement.setNeededBy(procurementId, orderDate || null, lines);
          void header.refetch();
        }
      } catch (e) {
        const error = classifyMutationError(e);
        throw new Error(error.detail || error.headline, { cause: e });
      }
      if (attributionChanged.length > 0) {
        try {
          const changed = Object.fromEntries(attributionChanged.map((i) => [i.id, attributionOf(i.id)]));
          for (const g of groupLinesByAttribution(changed)) {
            await workOrderCostRepository.setAttribution('procurement_item', g.ids, { workOrderId: g.workOrderId, disciplineId: g.disciplineId });
          }
          void qc.invalidateQueries({ queryKey: ['work-order-cost'] });
        } catch (e) {
          throw new Error(refusalLine(e), { cause: e });
        }
      }
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ['procurement'] });
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const touch = () => { setSaved(false); setFailure(null); };

  const columns: Column<Row>[] = [
    { key: 'line', header: t('linePlan.line', 'Line'), kind: 'primary', size: 280, minSize: 180, cell: (line) => <span className="font-medium">{line.name}</span> },
  ];
  if (showCategory) columns.push({
    key: 'category', header: t('linePlan.category', 'Category'), size: 200, keepWhenBlank: true,
    cell: (line) => {
      const value = category[line.id] ?? '';
      if (!categoryEditable) return <span data-testid="line-planning-category">{categoryName(value) ?? '—'}</span>;
      const current = (categories.data ?? []).find((c) => c.id === value);
      const options = current?.archived_at ? [...categoryOptions, { value: current.id, label: `${current.name} (${t('linePlanning.retired', 'Retired')})` }] : categoryOptions;
      return <SelectField label={t('linePlanning.category', 'Line category')} hideLabel compact value={value} options={options} disabled={saving} fullWidth
        onChange={(next) => { touch(); setCategory((c) => ({ ...c, [line.id]: next })); }} />;
    },
  });
  if (showNeededBy) columns.push({
    key: 'neededBy', header: t('linePlanning.neededBy', 'Needed by'), size: 176, keepWhenBlank: true,
    cell: (line) => {
      const value = neededBy[line.id] ?? '';
      if (!dateEditable) return <span data-testid="line-planning-needed-by">{value ? dateOf(value) : orderRule && header.data ? <span className="text-muted-foreground">{dateOf(header.data)}</span> : '—'}</span>;
      return <DateField label={t('linePlanning.neededBy', 'Needed by')} hideLabel compact fullWidth value={value} disabled={saving}
        placeholder={orderRule && orderDate ? dateOf(orderDate) : undefined}
        onChange={(next) => { touch(); setNeededBy((d) => ({ ...d, [line.id]: next })); }} />;
    },
  });
  if (showWorkOrders) {
    columns.push({
      key: 'workOrder', header: t('linePlan.workOrder', 'Work order'), size: 240, keepWhenBlank: true,
      cell: (line) => {
        const value = attributionOf(line.id);
        const differs = requestWorkOrder && lineDiffersFromRequest(value.workOrderId || null, requestWorkOrder.id);
        const note = differs ? <p role="note" className="mt-1 text-control text-muted-foreground" data-testid="line-work-order-differs">{t('linePlan.differs', 'Not the request’s {{workOrder}}', { workOrder: requestWorkOrder!.label })}</p> : null;
        if (!attributionEditable) return <div><span data-testid="line-work-order-value">{value.workOrderId ? workOrderLabel(value.workOrderId) : sameLabel}</span>{note}</div>;
        return <div><SelectField label={t('lineWorkOrders.field', 'Work order for {{line}}', { line: line.name })} hideLabel compact fullWidth value={value.workOrderId} disabled={saving}
          options={lineWorkOrderChoices(workOrderOptions, value.workOrderId, sameLabel, t('lineWorkOrders.cancelled', 'cancelled'))}
          onChange={(next) => { touch(); setAttribution((a) => ({ ...a, [line.id]: { ...attributionOf(line.id), workOrderId: next } })); }} />{note}</div>;
      },
    });
    columns.push({
      key: 'discipline', header: t('linePlan.discipline', 'Discipline'), size: 180, keepWhenBlank: true,
      cell: (line) => {
        const value = attributionOf(line.id);
        if (!attributionEditable) return <span data-testid="line-discipline-value">{value.disciplineId ? disciplineLabel(value.disciplineId) : t('lineWorkOrders.noDiscipline', 'No discipline')}</span>;
        return <SelectField label={t('lineWorkOrders.disciplineField', 'Discipline for {{line}}', { line: line.name })} hideLabel compact fullWidth value={value.disciplineId} disabled={saving}
          options={[{ value: SAME_AS_REQUEST, label: t('lineWorkOrders.noDiscipline', 'No discipline') }, ...(disciplines.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
          onChange={(next) => { touch(); setAttribution((a) => ({ ...a, [line.id]: { ...attributionOf(line.id), disciplineId: next } })); }} />;
      },
    });
  }

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

  const hasColumns = columns.length > 1;
  if (!settingState && !hasColumns && footLines.length === 0) return null;
  return (
    <Card data-testid="line-plan-panel">
      <CardHead actions={orderDateControl}>{t('linePlanning.heading', 'Line planning')}</CardHead>
      {settingState && <CardPad>{settingState}</CardPad>}
      {hasColumns && <DataTable embedded rows={[...items]} columns={columns} rowKey={(row) => row.id} tableId="procurement-line-plan" accessibleName={t('linePlanning.heading', 'Line planning')} />}
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
