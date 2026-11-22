import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, FieldError } from '@/src/components/ui';
import { useRefusalLine } from '@/src/lib/refusals';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { workOrderCostRepository } from '@/src/lib/repositories/workOrderCosts';
import { LineWorkOrdersSection } from './LineWorkOrdersSection';
import { requestWorkOrderOf, SAME_AS_REQUEST, type LineWorkOrderOption } from './lineWorkOrderValue';

type Line = { id: string; name: string; work_order_id?: string | null };

const initial = (items: readonly Line[]): Record<string, string> => Object.fromEntries(items.map((i) => [i.id, i.work_order_id ?? SAME_AS_REQUEST]));

/**
 * The case's lines, each with the work order it is for. A line's own work order wins when cost is read; a line with none takes
 * the request's. Editable by the requester and by the roles that may correct a purchase's attribution (the database decides:
 * `set_cost_attribution`); everyone else reads it. Renders nothing for a purchase with no project or no lines.
 */
export const LineWorkOrdersPanel: React.FC<{
  items: readonly Line[];
  projectId: string | null | undefined;
  requestRecords: readonly { work_order_id?: string | null }[];
  editable: boolean;
}> = ({ items, projectId, requestRecords, editable }) => {
  const { t } = useTranslation('procurement');
  const refusalLine = useRefusalLine();
  const qc = useQueryClient();
  const orders = useProjectWorkOrders(projectId ?? '');
  const [values, setValues] = useState<Record<string, string>>(() => initial(items));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const signature = items.map((i) => `${i.id}:${i.work_order_id ?? ''}`).join('|');
  useEffect(() => { setValues(initial(items)); }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const options: LineWorkOrderOption[] | null = useMemo(
    () => projectId ? (orders.data ?? []).map((wo) => ({ id: wo.id, label: wo.wo_number ?? wo.title, cancelled: wo.status === 'Cancelled' })) : null,
    [orders.data, projectId],
  );
  const requestId = requestWorkOrderOf(requestRecords);
  const requestWorkOrder = requestId ? { id: requestId, label: options?.find((o) => o.id === requestId)?.label ?? t('lineWorkOrders.unknownWorkOrder', 'A work order you cannot open') } : null;

  if (items.length === 0 || !projectId) return null;
  if (orders.isLoading) return null;

  const save = async () => {
    setSaving(true); setSaved(false); setFailure(null);
    try {
      const changed = items.filter((i) => (values[i.id] ?? SAME_AS_REQUEST) !== (i.work_order_id ?? SAME_AS_REQUEST));
      const byTarget = new Map<string, string[]>();
      for (const i of changed) byTarget.set(values[i.id] ?? SAME_AS_REQUEST, [...(byTarget.get(values[i.id] ?? SAME_AS_REQUEST) ?? []), i.id]);
      for (const [target, ids] of byTarget) {
        await workOrderCostRepository.setAttribution('procurement_item', ids, { workOrderId: target || null, disciplineId: null });
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
  const dirty = items.some((i) => (values[i.id] ?? SAME_AS_REQUEST) !== (i.work_order_id ?? SAME_AS_REQUEST));
  return (
    <div className="space-y-2" data-testid="line-work-orders-panel">
      <LineWorkOrdersSection
        lines={items} values={values} workOrders={options} requestWorkOrder={requestWorkOrder}
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
