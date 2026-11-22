import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, SelectField } from '@/src/components/ui';
import { lineDiffersFromRequest, lineWorkOrderChoices, SAME_AS_REQUEST, type LineWorkOrderOption } from './lineWorkOrderValue';

export interface LineWorkOrdersSectionProps {
  lines: readonly { id: string; name: string }[];
  /** lineId → work order id; '' (or absent) = same as the request. */
  values: Record<string, string>;
  onChange: (lineId: string, workOrderId: string) => void;
  /** The purchase's project's work orders. `null` while there is no project to take them from. */
  workOrders: readonly LineWorkOrderOption[] | null;
  /** The work order the request names, for the default's label and the "differs" note. */
  requestWorkOrder?: { id: string; label: string } | null;
  /** Shows the values as text (a caller who may not change them). */
  readOnly?: boolean;
  busy?: boolean;
}

/**
 * One row per purchase line: the work order the line is for. A line with none takes the request's work order, so naming
 * only the lines that differ is enough. A line whose own work order differs from the request's gets an information note;
 * it never blocks (the line's own work order is the one its cost lands on).
 */
export const LineWorkOrdersSection: React.FC<LineWorkOrdersSectionProps> = ({ lines, values, onChange, workOrders, requestWorkOrder, readOnly, busy }) => {
  const { t } = useTranslation('procurement');
  if (lines.length === 0) return null;
  const sameLabel = requestWorkOrder
    ? t('lineWorkOrders.sameAsRequestNamed', 'Same as the request ({{workOrder}})', { workOrder: requestWorkOrder.label })
    : t('lineWorkOrders.sameAsRequest', 'Same as the request');
  const labelOf = (id: string) => workOrders?.find((w) => w.id === id)?.label ?? t('lineWorkOrders.unknownWorkOrder', 'A work order you cannot open');
  let body: React.ReactNode;
  if (workOrders === null) {
    body = <p role="status" className="text-control text-muted-foreground" data-testid="line-work-orders-empty">
      {t('lineWorkOrders.noProject', 'Choose a project first: work orders belong to a project, and each line can then be given one.')}
    </p>;
  } else if (workOrders.length === 0 && !lines.some((l) => values[l.id])) {
    body = <p role="status" className="text-control text-muted-foreground" data-testid="line-work-orders-empty">
      {t('lineWorkOrders.noWorkOrders', 'This project has no work orders yet, so lines cannot be given one. A project manager adds work orders on the project’s Work orders tab.')}
    </p>;
  } else {
    body = <ul className="space-y-4">
      {lines.map((line) => {
        const value = values[line.id] ?? SAME_AS_REQUEST;
        const differs = lineDiffersFromRequest(value || null, requestWorkOrder?.id ?? null);
        return (
          <li key={line.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-end" data-testid="line-work-order-row">
            <p className="min-w-0 break-words text-control font-medium">{line.name}</p>
            <div className="min-w-0 space-y-1">
              {readOnly ? (
                <p className="text-control" data-testid="line-work-order-value">{value ? labelOf(value) : sameLabel}</p>
              ) : (
                <SelectField
                  label={t('lineWorkOrders.field', 'Work order for {{line}}', { line: line.name })}
                  hideLabel
                  value={value}
                  onChange={(next) => onChange(line.id, next)}
                  options={lineWorkOrderChoices(workOrders, value, sameLabel, t('lineWorkOrders.cancelled', 'cancelled'))}
                  disabled={busy}
                  fullWidth
                />
              )}
              {differs && requestWorkOrder && (
                <p role="note" className="text-sm text-muted-foreground" data-testid="line-work-order-differs">
                  {t('lineWorkOrders.differs', 'The request is on {{workOrder}}; this line’s cost goes to its own work order.', { workOrder: requestWorkOrder.label })}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>;
  }
  return (
    <Card data-testid="line-work-orders-section">
      <CardHead>{t('lineWorkOrders.section', 'Work order per line')}</CardHead>
      <CardPad>
        <p className="mb-3 text-control text-muted-foreground">{t('lineWorkOrders.intro', 'Say which work order each line is for. A line with none takes the request’s work order.')}</p>
        {body}
      </CardPad>
    </Card>
  );
};
