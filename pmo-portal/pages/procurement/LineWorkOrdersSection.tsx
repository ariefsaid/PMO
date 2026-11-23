import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, SelectField } from '@/src/components/ui';
import { lineDiffersFromRequest, lineWorkOrderChoices, NO_LINE_ATTRIBUTION, SAME_AS_REQUEST, type LineAttributionValue, type LineWorkOrderOption } from './lineWorkOrderValue';

export interface LineWorkOrdersSectionProps {
  lines: readonly { id: string; name: string }[];
  /** lineId → what the line names; '' = same as the request. */
  values: Record<string, LineAttributionValue>;
  onChange: (lineId: string, next: LineAttributionValue) => void;
  /** The purchase's project's work orders. `null` while there is no project to take them from. */
  workOrders: readonly LineWorkOrderOption[] | null;
  /** The organisation's live disciplines. */
  disciplines: readonly { id: string; label: string }[];
  /** The work order the request names, for the default's label and the "differs" note. */
  requestWorkOrder?: { id: string; label: string } | null;
  /** Shows the values as text (a caller who may not change them). */
  readOnly?: boolean;
  busy?: boolean;
}

/**
 * One row per purchase line: the work order and discipline the line is for. A line with none is for the request's. A line whose own
 * work order differs from the request's gets an information note; it never blocks. Trace only: nothing here changes a cost figure.
 */
export const LineWorkOrdersSection: React.FC<LineWorkOrdersSectionProps> = ({ lines, values, onChange, workOrders, disciplines, requestWorkOrder, readOnly, busy }) => {
  const { t } = useTranslation('procurement');
  if (lines.length === 0) return null;
  const sameLabel = requestWorkOrder
    ? t('lineWorkOrders.sameAsRequestNamed', 'Same as the request ({{workOrder}})', { workOrder: requestWorkOrder.label })
    : t('lineWorkOrders.sameAsRequest', 'Same as the request');
  const unknown = t('lineWorkOrders.unknownWorkOrder', 'A work order you cannot open');
  const workOrderLabel = (id: string) => workOrders?.find((w) => w.id === id)?.label ?? unknown;
  const disciplineLabel = (id: string) => disciplines.find((d) => d.id === id)?.label ?? t('lineWorkOrders.unknownDiscipline', 'A retired discipline');
  const valueOf = (id: string) => values[id] ?? NO_LINE_ATTRIBUTION;
  let body: React.ReactNode = null;
  let emptyMessage: string | null = null;
  if (workOrders === null) {
    emptyMessage = t('lineWorkOrders.noProject', 'Choose a project first: work orders belong to a project, and each line can then be given one.');
  } else if (workOrders.length === 0 && !lines.some((l) => valueOf(l.id).workOrderId)) {
    emptyMessage = t('lineWorkOrders.noWorkOrders', 'This project has no work orders yet, so lines cannot be given one. A project manager adds work orders on the project’s Work orders tab.');
  } else {
    body = <ul className="space-y-4">
      {lines.map((line) => {
        const value = valueOf(line.id);
        const differs = lineDiffersFromRequest(value.workOrderId || null, requestWorkOrder?.id ?? null);
        return (
          <li key={line.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_minmax(0,12rem)] sm:items-start" data-testid="line-work-order-row">
            <p className="min-w-0 break-words text-control font-medium">{line.name}</p>
            {readOnly ? (
              <>
                <p className="text-control" data-testid="line-work-order-value">{value.workOrderId ? workOrderLabel(value.workOrderId) : sameLabel}</p>
                <p className="text-control" data-testid="line-discipline-value">{value.disciplineId ? disciplineLabel(value.disciplineId) : t('lineWorkOrders.noDiscipline', 'No discipline')}</p>
              </>
            ) : (
              <>
                <SelectField
                  label={t('lineWorkOrders.field', 'Work order for {{line}}', { line: line.name })}
                  hideLabel
                  value={value.workOrderId}
                  onChange={(next) => onChange(line.id, { ...value, workOrderId: next })}
                  options={lineWorkOrderChoices(workOrders, value.workOrderId, sameLabel, t('lineWorkOrders.cancelled', 'cancelled'))}
                  disabled={busy}
                  fullWidth
                />
                <SelectField
                  label={t('lineWorkOrders.disciplineField', 'Discipline for {{line}}', { line: line.name })}
                  hideLabel
                  value={value.disciplineId}
                  onChange={(next) => onChange(line.id, { ...value, disciplineId: next })}
                  options={[{ value: SAME_AS_REQUEST, label: t('lineWorkOrders.noDiscipline', 'No discipline') }, ...disciplines.map((d) => ({ value: d.id, label: d.label }))]}
                  disabled={busy}
                  fullWidth
                />
              </>
            )}
            {differs && requestWorkOrder && (
              <p role="note" className="text-sm text-muted-foreground sm:col-span-3" data-testid="line-work-order-differs">
                {t('lineWorkOrders.differs', 'The request is on {{workOrder}}; this line is for a different work order.', { workOrder: requestWorkOrder.label })}
              </p>
            )}
          </li>
        );
      })}
    </ul>;
  }
  // The explanation sits in the heading row (its subline), so the heading is followed straight by the list, 16px below (DESIGN.md heading gap).
  return (
    <Card data-testid="line-work-orders-section">
      <CardHead subline={emptyMessage
        ? <span role="status" data-testid="line-work-orders-empty">{emptyMessage}</span>
        : t('lineWorkOrders.intro', 'Say which work order, and discipline, each line is for. When every line names the same work order, the request takes it.')}>
        {t('lineWorkOrders.section', 'Work order per line')}
      </CardHead>
      {body && <CardPad>{body}</CardPad>}
    </Card>
  );
};
