import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, SelectField, TextField, useToast } from '@/src/components/ui';
import { useDeleteLineSplit, useImprestPlanSplits, useSaveLineSplit } from '@/src/hooks/useImprest';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import type { ImprestPlanLineRow } from '@/src/lib/db/imprest';
import { useRefusalText } from '@/src/lib/refusals';
import { formatCurrency, parseMoneyInputAtScale } from '@/src/lib/format';

/**
 * One plan line's split over work orders (cash-advance-estimate, FR-CAE-001/009). A breakdown of the line: the line, the plan
 * total and the approval route do not change. The database refuses an over-split or a work order of another project; this hides.
 */
export const LineSplits: React.FC<{ planId: string; line: ImprestPlanLineRow; projectId: string; currency: string; editable: boolean }> =
({ planId, line, projectId, currency, editable }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const refusal = useRefusalText();
  const splits = useImprestPlanSplits(planId);
  const workOrders = useProjectWorkOrders(projectId);
  const save = useSaveLineSplit();
  const remove = useDeleteLineSplit();
  const [open, setOpen] = useState(false);
  const [workOrderId, setWorkOrderId] = useState('');
  const [amount, setAmount] = useState('');
  const mine = (splits.data ?? []).filter((s) => s.line_id === line.id);
  const woLabel = (id: string): string => {
    const wo = (workOrders.data ?? []).find((w) => w.id === id);
    return wo ? `${wo.wo_number} ${wo.title}` : t('imprest:estimate.workOrder', 'Work order');
  };
  const openOrders = (workOrders.data ?? []).filter((w) => w.status !== 'Cancelled');
  const assigned = mine.reduce((sum, s) => sum + Number(s.amount), 0);
  const parsed = parseMoneyInputAtScale(amount, 2);
  const run = async (work: () => Promise<unknown>) => {
    try { await work(); } catch (err) { const { headline, detail } = refusal(err); toast(headline, detail || undefined, 'warning'); }
  };
  if (!editable && mine.length === 0) return null;
  return (
    <div className="basis-full pl-4 text-control" data-testid={`line-splits-${line.id}`}>
      {mine.length > 0 && (
        <ul className="divide-y divide-border">
          {mine.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-1">
              <span className="flex-1 text-muted-foreground">{woLabel(s.work_order_id)}</span>
              <span className="tabular-nums">{formatCurrency(Number(s.amount), currency)}</span>
              {editable && <Button variant="ghost" size="sm" disabled={remove.isPending}
                aria-label={t('imprest:plan.splitRemove', 'Remove split for {{workOrder}}', { workOrder: woLabel(s.work_order_id) })}
                onClick={() => void run(() => remove.mutateAsync(s.id))}>{t('imprest:plan.remove', 'Remove')}</Button>}
            </li>
          ))}
          <li className="flex items-center gap-3 py-1 text-muted-foreground">
            <span className="flex-1">{t('imprest:estimate.unassigned', 'Not assigned to a work order')}</span>
            <span className="tabular-nums">{formatCurrency(Number(line.planned_amount) - assigned, currency)}</span>
          </li>
        </ul>
      )}
      {editable && (
        <div className="pt-1">
          <Button variant="ghost" size="sm" aria-expanded={open} disabled={openOrders.length === 0} onClick={() => setOpen((o) => !o)}>
            {t('imprest:plan.splitLine', 'Split by work order')}
          </Button>
          {openOrders.length === 0 && !workOrders.isPending && (
            <p className="text-muted-foreground" data-testid="split-disabled-reason">
              {t('imprest:plan.splitNoWorkOrders', 'This project has no open work order to split to. A project manager adds one on the project first.')}
            </p>
          )}
          {open && openOrders.length > 0 && (
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <SelectField label={t('imprest:estimate.workOrder', 'Work order')} value={workOrderId} onChange={setWorkOrderId}
                options={[{ value: '', label: t('imprest:plan.splitChoose', 'Choose a work order') },
                  ...openOrders.map((w) => ({ value: w.id, label: `${w.wo_number} ${w.title}` }))]} />
              <TextField label={t('imprest:plan.splitAmount', 'Amount for this work order')} inputMode="decimal" value={amount} onChange={setAmount} />
              <Button variant="primary" disabled={!workOrderId || parsed === null || !(parsed > 0) || save.isPending}
                onClick={() => void run(async () => { await save.mutateAsync({ lineId: line.id, workOrderId, amount: parsed as number }); setWorkOrderId(''); setAmount(''); })}>
                {t('imprest:plan.splitSave', 'Save split')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
