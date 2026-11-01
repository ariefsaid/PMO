import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, EntityFormModal, FieldError, FormSection, ListState, NumberField, type SubmitError } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue, formatNumberExact, parseMoneyInputAtScale } from '@/src/lib/format';
import type { BoqItemRow } from '@/src/lib/db/progressBilling';
import type { WorkOrderLineRow } from '@/src/lib/db/workOrderAcceptances';
import { milli, type ContractLineFacts } from '@/src/lib/progressBilling';

/**
 * Contract lines ordered on one work order (ADR-0091, OD-CQ-2). Each BoQ line is allocated, changed or removed
 * on its own — the table API offers no atomic multi-row save, so none is promised: every operation persists
 * alone and the caller refetches the authoritative list. Over-ordering is shown in words, never blocked.
 */
export interface WorkOrderLinesModalProps {
  workOrder: { id: string; wo_number: string | null; title: string; status: string };
  boqItems: BoqItemRow[];
  /** Server facts per BoQ line — the contract balance not yet ordered. */
  contractLines: ContractLineFacts[];
  /** This work order's allocation rows. */
  allocations: WorkOrderLineRow[];
  /** UX gate only; the database is the authority. */
  canEdit: boolean;
  sources?: Array<{ name: string; pending: boolean; error: boolean; retry: () => void }>;
  onClose: () => void;
  onCreate: (boqItemId: string, quantity: number) => Promise<void>;
  onUpdate: (id: string, quantity: number) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onError: (err: unknown) => void;
}


const WorkOrderLinesModal: React.FC<WorkOrderLinesModalProps> = ({
  workOrder, boqItems, contractLines, allocations, canEdit, sources = [], onClose, onCreate, onUpdate, onDelete, onError,
}) => {
  const { t } = useTranslation('project');
  const own = new Map(allocations.map((row) => [row.boq_item_id, row]));
  const facts = new Map(contractLines.map((row) => [row.boqItemId, row]));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    allocations.map((row) => [row.boq_item_id, formatMoneyInputValue(Number(row.quantity))]),
  ));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // A rejected save/remove is shown in the dialog's own persistent error region (focus returns there).
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const [removeFor, setRemoveFor] = useState<{ item: BoqItemRow; row: WorkOrderLineRow } | null>(null);

  const sourcesReady = sources.every((source) => !source.pending && !source.error);
  const editable = canEdit && (workOrder.status === 'Draft' || workOrder.status === 'Issued');
  const woLabel = workOrder.wo_number ? `${workOrder.wo_number} — ${workOrder.title}` : workOrder.title;
  const setError = (id: string, message: string | null) =>
    setErrors((current) => {
      const next = { ...current };
      if (message === null) delete next[id]; else next[id] = message;
      return next;
    });
  const fail = (item: BoqItemRow, err: unknown) => {
    const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
    setSaveError({ headline: `${item.item_code}: ${headline}`, detail });
    onError(err);
  };

  /** Quantity open to this order: the balance, plus this order's own Issued allocation (it is already netted). */
  const availableTo = (item: BoqItemRow): number => {
    const balance = facts.get(item.id)?.contractBalance;
    if (balance === undefined) return Number.POSITIVE_INFINITY;
    const mine = workOrder.status === 'Issued' ? Number(own.get(item.id)?.quantity ?? 0) : 0;
    return (milli(balance) + milli(mine)) / 1000;
  };

  const save = async (item: BoqItemRow) => {
    if (!sourcesReady) return;
    const quantity = parseMoneyInputAtScale((values[item.id] ?? '').trim(), 3);
    if (quantity === null || quantity <= 0) {
      setError(item.id, t('projectTabs:contractQuantities.workOrders.contractLines.errors.quantity', 'Enter a quantity above 0 with at most 3 decimal places'));
      return;
    }
    setError(item.id, null);
    setSaveError(null);
    setBusy(item.id);
    try {
      const row = own.get(item.id);
      if (row) await onUpdate(row.id, quantity); else await onCreate(item.id, quantity);
    } catch (err) {
      fail(item, err);
    } finally {
      setBusy(null);
    }
  };

  const runRemove = async () => {
    if (!removeFor || !sourcesReady) return;
    const { item, row } = removeFor;
    setSaveError(null);
    setBusy(item.id);
    try {
      await onDelete(row.id);
      setValues((current) => { const next = { ...current }; delete next[item.id]; return next; });
      setError(item.id, null);
    } catch (err) {
      fail(item, err);
    } finally {
      setBusy(null);
      setRemoveFor(null);
    }
  };

  return (
    <EntityFormModal
      open
      width="lg"
      title={t('projectTabs:contractQuantities.workOrders.contractLines.title', 'Contract lines: {{wo}}', { wo: woLabel })}
      subtitle={t('projectTabs:contractQuantities.workOrders.contractLines.subtitle', 'Quantities this order takes from the contract. Each line saves on its own; ordering more than the balance is allowed and flagged.')}
      submitLabel={t('projectTabs:contractQuantities.workOrders.contractLines.done', 'Done')}
      onSubmit={(e) => { e.preventDefault(); onClose(); }}
      submitError={saveError}
      onClose={onClose}
    >
      {sources.filter((source) => source.pending || source.error).map((source) => source.error
        ? <ListState key={source.name} variant="error" title={t('projectDetail.billing.sources.error', "Couldn't load {{source}}", { source: source.name })} onRetry={source.retry} />
        : <p key={source.name} role="status" className="text-sm text-muted-foreground">{t('projectDetail.billing.sources.loading', 'Loading {{source}}…', { source: source.name })}</p>)}
      <FormSection legend={t('projectTabs:contractQuantities.workOrders.contractLines.legend', 'Bill of quantities lines')}>
        {!editable && (
          <p className="mb-3 text-[13px] text-muted-foreground">
            {workOrder.status === 'Draft' || workOrder.status === 'Issued'
              ? t('projectTabs:contractQuantities.workOrders.contractLines.readOnly', 'You can view these allocations but not change them.')
              : t('projectTabs:contractQuantities.workOrders.contractLines.frozen', 'This work order is {{status}}: its allocations are frozen.', { status: workOrder.status })}
          </p>
        )}
        {boqItems.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t('projectTabs:contractQuantities.workOrders.contractLines.noBoq', 'This project has no bill of quantities lines yet.')}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {boqItems.map((item) => {
              const row = own.get(item.id);
              const label = `${item.item_code} — ${item.description} (${item.unit})`;
              const balance = facts.get(item.id)?.contractBalance;
              const typed = parseMoneyInputAtScale((values[item.id] ?? '').trim(), 3);
              const over = typed !== null && typed > 0 && milli(typed) > milli(availableTo(item))
                ? (milli(typed) - milli(availableTo(item))) / 1000 : null;
              return (
                <li key={item.id} className="flex flex-col gap-1.5 border-b border-border pb-3 last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12px] text-muted-foreground">
                    <span>{t('projectTabs:contractQuantities.workOrders.contractLines.contractQty', 'Contract {{qty}} {{unit}}', { qty: formatNumberExact(Number(item.quantity)), unit: item.unit })}</span>
                    <span data-testid={`lines-balance-${item.id}`}>
                      {balance === undefined
                        ? t('projectTabs:contractQuantities.workOrders.contractLines.balanceUnknown', 'Balance unavailable')
                        : t('projectTabs:contractQuantities.workOrders.contractLines.balance', 'Not yet ordered {{qty}} {{unit}}', { qty: formatNumberExact(balance), unit: item.unit })}
                    </span>
                  </div>
                  {editable ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[10rem] flex-1">
                        <NumberField id={`wo-line-${item.id}`} label={label} value={values[item.id] ?? ''}
                          onChange={(value) => { setValues((current) => ({ ...current, [item.id]: value })); setError(item.id, null); }}
                          localeAware />
                      </div>
                      <Button type="button" variant="outline" size="sm" loading={busy === item.id} disabled={busy !== null || !sourcesReady}
                        aria-label={t('projectTabs:contractQuantities.workOrders.contractLines.saveRow', 'Save {{item}}', { item: item.item_code })}
                        onClick={() => void save(item)}>
                        {t('projectTabs:contractQuantities.workOrders.contractLines.save', 'Save')}
                      </Button>
                      {row && (
                        <Button type="button" variant="ghost" size="sm" disabled={busy !== null || !sourcesReady}
                          className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                          aria-label={t('projectTabs:contractQuantities.workOrders.contractLines.removeRow', 'Remove {{item}}', { item: item.item_code })}
                          onClick={() => setRemoveFor({ item, row })}>
                          {t('projectTabs:contractQuantities.workOrders.contractLines.remove', 'Remove')}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="text-[13px]">
                      <span>{label}</span>{' '}
                      <span className="tabular font-semibold" data-testid={`lines-readonly-${item.id}`}>
                        {row ? formatNumberExact(Number(row.quantity)) : '—'}
                      </span>
                    </div>
                  )}
                  {over !== null && (
                    <p className="text-[12px] font-medium text-warning-foreground" data-testid={`lines-over-${item.id}`}>
                      {t('projectTabs:contractQuantities.workOrders.contractLines.overOrdered', 'Over-ordered by {{qty}} {{unit}}, more than the contract balance.', { qty: formatNumberExact(over), unit: item.unit })}
                    </p>
                  )}
                  {errors[item.id] && <FieldError>{errors[item.id]}</FieldError>}
                </li>
              );
            })}
          </ul>
        )}
      </FormSection>
      {removeFor && (
        <ConfirmDialog
          open
          tone="destructive"
          title={t('projectTabs:contractQuantities.workOrders.contractLines.confirmRemove.title', 'Remove this allocation?')}
          description={t('projectTabs:contractQuantities.workOrders.contractLines.confirmRemove.body', '{{item}} returns to the contract balance. A line already accepted by a confirmed BAST cannot be removed.', { item: removeFor.item.item_code })}
          confirmLabel={t('projectTabs:contractQuantities.workOrders.contractLines.confirmRemove.confirm', 'Remove allocation')}
          loading={busy === removeFor.item.id}
          confirmDisabled={!sourcesReady}
          onConfirm={() => void runRemove()}
          onCancel={() => setRemoveFor(null)}
        />
      )}
    </EntityFormModal>
  );
};

export default WorkOrderLinesModal;
