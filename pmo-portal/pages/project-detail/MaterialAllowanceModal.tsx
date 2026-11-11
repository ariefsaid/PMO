import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, EntityFormModal, FormGrid, ListState, TextField, type SubmitError } from '@/src/components/ui';
import { ItemPicker } from '@/src/components/stock/ItemPicker';
import { useAllowanceMutations, useAllowances, useStockItems } from '@/src/hooks/useStock';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatQuantity, isPositiveDecimal, normalizeDecimal } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';

export interface MaterialAllowanceModalProps {
  projectId: string;
  workItem: { id: string; item_code: string; description: string };
  onClose: () => void;
}

/**
 * Planned material per stock item for one BoQ line (#1512 S5, FR-STK-050). Pick an item and its planned quantity; an item
 * that already has an allowance is prefilled and changed in place. Issues beyond it are allowed and flagged (OQ-STK-7).
 * Who may write is RLS's call (PQ-7); the caller only offers the action to those `can('edit','materialAllowance')` allows.
 */
const MaterialAllowanceModal: React.FC<MaterialAllowanceModalProps> = ({ projectId, workItem, onClose }) => {
  const { t } = useTranslation('stock');
  const loc = getNumberLocale();
  const list = useAllowances(projectId);
  const items = useStockItems(true);                                                                       // archived too: an allowance on one must still be named and clearable (#1626)
  const m = useAllowanceMutations();
  const [itemId, setItemId] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [qtyError, setQtyError] = useState<string | null>(null);
  const [clearFor, setClearFor] = useState<{ id: string; item: string } | null>(null);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const mine = (list.data ?? []).filter((a) => a.boqItemId === workItem.id);
  const label = (id: string) => { const i = (items.data ?? []).find((x) => x.id === id); return i ? `${i.code} - ${i.name}` : id; };
  const existing = itemId ? mine.find((a) => a.itemId === itemId) : undefined;

  const pickItem = (id: string) => {
    setItemId(id);
    const found = mine.find((a) => a.itemId === id);
    if (found) setQty(found.plannedQuantity);
  };
  const fail = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
    setSaveError({ headline, detail });
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = normalizeDecimal(qty);
    if (!isPositiveDecimal(v)) { setQtyError(t('allowance.quantityInvalid')); return; }
    if (!itemId) return;
    setQtyError(null);
    try {
      await m.set.mutateAsync({ ...(existing ? { id: existing.id } : {}), boqItemId: workItem.id, itemId, plannedQuantity: v });
      setItemId(null); setQty('');
    } catch (err) { fail(err); }
  };

  return (
    <>
    <EntityFormModal
      open
      title={t('allowance.title')}
      subtitle={t('allowance.description', { workItem: `${workItem.item_code} ${workItem.description}` })}
      submitLabel={t('allowance.save')}
      onSubmit={(e) => void submit(e)}
      submitError={saveError}
      onClose={onClose}
      loading={m.set.isPending}
      dirty={Boolean(itemId || qty)}
      submitDisabled={!itemId || !qty.trim()}
    >
      {list.isPending && <ListState variant="loading" rows={2} />}
      {list.isError && <ListState variant="error" title={t('allowance.loadError')} retryLabel={t('actions.retry')} onRetry={() => void list.refetch()} />}
      {list.data && (mine.length === 0
        ? <p className="text-sm text-muted-foreground">{t('allowance.none')}</p>
        : (
          <ul aria-label={t('allowance.title')} className="divide-y divide-border rounded-md border border-border">
            {mine.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{label(a.itemId)}</span>
                <span className="ml-auto tabular-nums">{formatQuantity(a.plannedQuantity, loc)}</span>
                <Button type="button" variant="ghost" size="sm" disabled={m.clear.isPending}
                  aria-label={`${t('allowance.clear')} ${label(a.itemId)}`}
                  onClick={() => setClearFor({ id: a.id, item: label(a.itemId) })}>{t('allowance.clear')}</Button>
              </li>
            ))}
          </ul>
        ))}
      <FormGrid>
        <ItemPicker label={t('allowance.item')} value={itemId} onChange={pickItem} required />
        <TextField label={t('allowance.quantity')} value={qty} onChange={(v) => { setQty(v); setQtyError(null); }} inputMode="decimal" required error={qtyError ?? undefined} />
      </FormGrid>
    </EntityFormModal>
    <ConfirmDialog
      open={clearFor !== null}
      tone="destructive"
      title={t('allowance.clearConfirmTitle')}
      description={t('allowance.clearConfirmDescription', { item: clearFor?.item ?? '', workItem: `${workItem.item_code} ${workItem.description}` })}
      confirmLabel={t('allowance.clearConfirm')}
      loading={m.clear.isPending}
      onConfirm={() => { if (clearFor) m.clear.mutate(clearFor.id, { onError: fail, onSettled: () => setClearFor(null) }); }}
      onCancel={() => setClearFor(null)}
    />
    </>
  );
};

export default MaterialAllowanceModal;
