import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, FieldError } from '@/src/components/ui';
import { useRefusalLine } from '@/src/lib/refusals';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { workOrderCostRepository } from '@/src/lib/repositories/workOrderCosts';
import { LineWorkOrdersSection } from './LineWorkOrdersSection';
import { useCostDisciplines } from '@/src/hooks/useWorkOrderCosts';
import { groupLinesByAttribution, lineValuesOf, NO_LINE_ATTRIBUTION, type LineAttributionValue, type LineWorkOrderOption } from './lineWorkOrderValue';

type Line = { id: string; name: string; work_order_id?: string | null; discipline_id?: string | null };

/**
 * The case's lines, each with the work order it is for. A line's own work order wins when cost is read; a line with none takes
 * the request's. Editable by the requester and by the roles that may correct a purchase's attribution (the database decides:
 * `set_cost_attribution`); everyone else reads it. Renders nothing for a purchase with no project or no lines.
 */
export const LineWorkOrdersPanel: React.FC<{
  items: readonly Line[];
  projectId: string | null | undefined;
  /** The purchase header's work order (the request's). */
  requestWorkOrderId: string | null | undefined;
  editable: boolean;
}> = ({ items, projectId, requestWorkOrderId, editable }) => {
  const { t } = useTranslation('procurement');
  const refusalLine = useRefusalLine();
  const qc = useQueryClient();
  const orders = useProjectWorkOrders(projectId ?? '');
  const [values, setValues] = useState<Record<string, LineAttributionValue>>(() => lineValuesOf(items));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const disciplines = useCostDisciplines();
  const signature = items.map((i) => `${i.id}:${i.work_order_id ?? ''}:${i.discipline_id ?? ''}`).join('|');
  useEffect(() => { setValues(lineValuesOf(items)); }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const options: LineWorkOrderOption[] | null = useMemo(
    () => projectId ? (orders.data ?? []).map((wo) => ({ id: wo.id, label: wo.wo_number ?? wo.title, cancelled: wo.status === 'Cancelled' })) : null,
    [orders.data, projectId],
  );
  const requestId = requestWorkOrderId ?? null;
  const requestWorkOrder = requestId ? { id: requestId, label: options?.find((o) => o.id === requestId)?.label ?? t('lineWorkOrders.unknownWorkOrder', 'A work order you cannot open') } : null;

  if (items.length === 0 || !projectId) return null;
  if (orders.isLoading) return null;
  if (orders.isError) {
    return (
      <div className="flex items-center gap-3" data-testid="line-work-orders-panel">
        <p role="alert" className="text-control text-destructive-text">{t('lineWorkOrders.loadError', 'Could not load this project’s work orders.')}</p>
        <Button variant="outline" size="sm" onClick={() => void orders.refetch()}>{t('common.retry', 'Retry')}</Button>
      </div>
    );
  }

  const differs = (i: Line) => {
    const v = values[i.id] ?? NO_LINE_ATTRIBUTION;
    return v.workOrderId !== (i.work_order_id ?? '') || v.disciplineId !== (i.discipline_id ?? '');
  };
  const save = async () => {
    setSaving(true); setSaved(false); setFailure(null);
    try {
      const changed = Object.fromEntries(items.filter((i) => differs(i)).map((i) => [i.id, values[i.id] ?? NO_LINE_ATTRIBUTION]));
      for (const g of groupLinesByAttribution(changed)) {
        await workOrderCostRepository.setAttribution('procurement_item', g.ids, { workOrderId: g.workOrderId, disciplineId: g.disciplineId });
      }
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ['procurement'] });
      void qc.invalidateQueries({ queryKey: ['work-order-cost'] });
    } catch (e) {
      setFailure(refusalLine(e));
    } finally {
      setSaving(false);
    }
  };
  const dirty = items.some(differs);
  return (
    <div className="space-y-2" data-testid="line-work-orders-panel">
      <LineWorkOrdersSection
        lines={items} values={values} workOrders={options} requestWorkOrder={requestWorkOrder}
        disciplines={(disciplines.data ?? []).map((d) => ({ id: d.id, label: d.name }))}
        onChange={(id, next) => { setSaved(false); setFailure(null); setValues((current) => ({ ...current, [id]: next })); }}
        readOnly={!editable} busy={saving}
      />
      {editable && options && options.length > 0 && (
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" loading={saving} disabled={!dirty} onClick={() => void save()}>{t('lineWorkOrders.save', 'Save')}</Button>
          {!dirty && !saved && <p className="text-control text-muted-foreground">{t('lineWorkOrders.nothingToSave', 'Change a line’s work order to save.')}</p>}
          <p role="status" className="text-control text-muted-foreground">{saved ? t('lineWorkOrders.saved', 'Saved') : ''}</p>
        </div>
      )}
      {failure && <FieldError>{failure}</FieldError>}
    </div>
  );
};
