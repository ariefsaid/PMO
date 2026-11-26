import React from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, DateField, SelectField } from '@/src/components/ui';
import type { Column } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';
import type { PurchaseLineCategory } from '@/src/lib/db/procurementLinePlanning';
import {
  lineDiffersFromRequest, lineWorkOrderChoices, NO_LINE_ATTRIBUTION, SAME_AS_REQUEST, type LineAttributionValue, type LineWorkOrderOption,
} from './lineWorkOrderValue';

type Line = { id: string; name: string };
const dateOf = (iso: string | null | undefined) => (iso ? formatDay(iso) : '—');

export interface LinePlanTableProps {
  lines: readonly Line[];
  busy?: boolean;
  /** The line category column (the organisation's line planning is on). */
  category?: { values: Readonly<Record<string, string>>; onChange: (lineId: string, categoryId: string) => void; categories: readonly PurchaseLineCategory[]; editable: boolean };
  /** The needed-by column. `orderDate` is the order's own date, which a line without its own date takes. */
  neededBy?: { values: Readonly<Record<string, string>>; onChange: (lineId: string, iso: string) => void; editable: boolean; orderDate?: string | null };
  /** The work order and discipline columns (the purchase has a project with work orders). */
  workOrders?: {
    values: Readonly<Record<string, LineAttributionValue>>;
    onChange: (lineId: string, next: LineAttributionValue) => void;
    options: readonly LineWorkOrderOption[];
    disciplines: readonly { id: string; label: string }[];
    requestWorkOrder: { id: string; label: string } | null;
    editable: boolean;
  };
}

/**
 * One row per purchase line, one column per planned fact: its category, the date it is needed, and the work order and
 * discipline it is for. The same table on the request form and on the purchase record, so a line is planned in one place
 * with one look. Presentational: the caller owns the values and how they are saved.
 */
export const LinePlanTable: React.FC<LinePlanTableProps> = ({ lines, busy, category, neededBy, workOrders }) => {
  const { t } = useTranslation('procurement');
  const columns: Column<Line>[] = [
    { key: 'line', header: t('linePlan.line', 'Line'), kind: 'primary', size: 280, minSize: 180, cell: (line) => <span className="font-medium">{line.name}</span> },
  ];
  if (category) {
    const options = [{ value: '', label: t('linePlanning.none', 'None') }, ...category.categories.filter((c) => !c.archived_at).map((c) => ({ value: c.id, label: c.name }))];
    columns.push({
      key: 'category', header: t('linePlan.category', 'Category'), size: 200, keepWhenBlank: true,
      cell: (line) => {
        const value = category.values[line.id] ?? '';
        const current = category.categories.find((c) => c.id === value);
        if (!category.editable) return <span data-testid="line-planning-category">{current?.name ?? '—'}</span>;
        const rowOptions = current?.archived_at ? [...options, { value: current.id, label: `${current.name} (${t('linePlanning.retired', 'Retired')})` }] : options;
        return <SelectField label={t('linePlanning.category', 'Line category')} hideLabel compact fullWidth value={value} options={rowOptions} disabled={busy}
          onChange={(next) => category.onChange(line.id, next)} />;
      },
    });
  }
  if (neededBy) {
    columns.push({
      key: 'neededBy', header: t('linePlanning.neededBy', 'Needed by'), size: 176, keepWhenBlank: true,
      cell: (line) => {
        const value = neededBy.values[line.id] ?? '';
        if (!neededBy.editable) {
          return <span data-testid="line-planning-needed-by">{value ? dateOf(value) : neededBy.orderDate ? <span className="text-muted-foreground">{dateOf(neededBy.orderDate)}</span> : '—'}</span>;
        }
        return <DateField label={t('linePlanning.neededBy', 'Needed by')} hideLabel compact fullWidth value={value} disabled={busy}
          placeholder={neededBy.orderDate ? dateOf(neededBy.orderDate) : undefined}
          onChange={(next) => neededBy.onChange(line.id, next)} />;
      },
    });
  }
  if (workOrders) {
    const { requestWorkOrder } = workOrders;
    const sameLabel = requestWorkOrder
      ? t('lineWorkOrders.sameAsRequestNamed', 'Same as the request ({{workOrder}})', { workOrder: requestWorkOrder.label })
      : t('lineWorkOrders.sameAsRequest', 'Same as the request');
    const workOrderLabel = (id: string) => workOrders.options.find((w) => w.id === id)?.label ?? t('lineWorkOrders.unknownWorkOrder', 'A work order you cannot open');
    const disciplineLabel = (id: string) => workOrders.disciplines.find((d) => d.id === id)?.label ?? t('lineWorkOrders.unknownDiscipline', 'A retired discipline');
    const valueOf = (id: string) => workOrders.values[id] ?? NO_LINE_ATTRIBUTION;
    columns.push({
      key: 'workOrder', header: t('linePlan.workOrder', 'Work order'), size: 240, keepWhenBlank: true,
      cell: (line) => {
        const value = valueOf(line.id);
        const differs = requestWorkOrder && lineDiffersFromRequest(value.workOrderId || null, requestWorkOrder.id);
        const note = differs ? <p role="note" className="mt-1 text-control text-muted-foreground" data-testid="line-work-order-differs">{t('linePlan.differs', 'Not the request’s {{workOrder}}', { workOrder: requestWorkOrder!.label })}</p> : null;
        if (!workOrders.editable) return <div><span data-testid="line-work-order-value">{value.workOrderId ? workOrderLabel(value.workOrderId) : sameLabel}</span>{note}</div>;
        return <div><SelectField label={t('lineWorkOrders.field', 'Work order for {{line}}', { line: line.name })} hideLabel compact fullWidth value={value.workOrderId} disabled={busy}
          options={lineWorkOrderChoices(workOrders.options, value.workOrderId, sameLabel, t('lineWorkOrders.cancelled', 'cancelled'))}
          onChange={(next) => workOrders.onChange(line.id, { ...valueOf(line.id), workOrderId: next })} />{note}</div>;
      },
    });
    columns.push({
      key: 'discipline', header: t('linePlan.discipline', 'Discipline'), size: 180, keepWhenBlank: true,
      cell: (line) => {
        const value = valueOf(line.id);
        if (!workOrders.editable) return <span data-testid="line-discipline-value">{value.disciplineId ? disciplineLabel(value.disciplineId) : t('lineWorkOrders.noDiscipline', 'No discipline')}</span>;
        return <SelectField label={t('lineWorkOrders.disciplineField', 'Discipline for {{line}}', { line: line.name })} hideLabel compact fullWidth value={value.disciplineId} disabled={busy}
          options={[{ value: SAME_AS_REQUEST, label: t('lineWorkOrders.noDiscipline', 'No discipline') }, ...workOrders.disciplines.map((d) => ({ value: d.id, label: d.label }))]}
          onChange={(next) => workOrders.onChange(line.id, { ...valueOf(line.id), disciplineId: next })} />;
      },
    });
  }
  if (columns.length === 1 || lines.length === 0) return null;
  return <DataTable embedded rows={[...lines]} columns={columns} rowKey={(row) => row.id} tableId="procurement-line-plan" accessibleName={t('linePlanning.heading', 'Line planning')} />;
};
