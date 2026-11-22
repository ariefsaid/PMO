import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, EntityFormModal, SelectField, TextField, useToast, type SubmitError } from '@/src/components/ui';
import { useTerms } from '@/src/lib/i18n/terms';
import { useStockItems, useStockUnits } from '@/src/hooks/useStock';
import { useLinePlans } from '@/src/hooks/useMaterialRequests';
import { useSectionAllocations, useSetAllocation } from '@/src/hooks/useWorkOrderSectionMaterials';
import { parseDecimal } from '@/src/lib/exactDecimal';
import { allocationHeadroom } from '@/src/lib/workOrderSections';
import { useSectionRefusal } from './useSectionRefusal';
import type { SectionRollupRow } from '@/src/lib/repositories/workOrderSections';

interface Props { workOrderId: string; section: SectionRollupRow; onClose: () => void }

const QTY = /^\d{1,11}(\.\d{1,3})?$/;

/**
 * A section's planned material quantities (FR-WOS-013): an allocation of the work order's planned quantity for each
 * item. The database refuses a figure that takes the allocations above the work order's plan, naming the plan; a blank
 * quantity removes the allocation. Requests on the section are checked against it when submitted (FR-WOS-015).
 */
export const SectionMaterialModal: React.FC<Props> = ({ workOrderId, section, onClose }) => {
  const { t } = useTranslation('workOrderSections');
  const terms = useTerms();
  const sectionRefusal = useSectionRefusal();
  const { toast } = useToast();
  const set = useSetAllocation(workOrderId);
  const allocations = useSectionAllocations(workOrderId);
  const items = useStockItems();
  const units = useStockUnits();
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('');
  const [tried, setTried] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const plans = useLinePlans(workOrderId, itemId ? [itemId] : [], null);
  const sectionId = section.sectionId as string;
  const mine = (allocations.data ?? []).filter((a) => a.sectionId === sectionId);
  const itemOf = (id: string) => items.data?.find((i) => i.id === id);
  const unit = (id: string) => units.data?.find((u) => u.id === itemOf(id)?.unit_id)?.code ?? '';
  const free = (items.data ?? []).filter((i) => !i.archived_at && !mine.some((a) => a.itemId === i.id));

  const plan = plans.data?.find((p) => p.itemId === itemId)?.planQty;
  const elsewhere = (allocations.data ?? []).filter((a) => a.itemId === itemId && a.sectionId !== sectionId).map((a) => a.quantity);
  const headroom = plan === undefined ? null : allocationHeadroom(plan.toFixed(3), elsewhere);
  const invalid = qty.trim() !== '' && (!QTY.test(qty.trim()) || parseDecimal(qty.trim(), 3) === 0n);

  const write = async (id: string, quantity: string | null) => {
    setSubmitError(null);
    try {
      await set.mutateAsync({ sectionId, itemId: id, quantity });
      toast(t('saved', 'Saved'), undefined, 'success');
    } catch (err) {
      setSubmitError(sectionRefusal(err));
    }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!itemId || qty.trim() === '' || invalid) return;
    await write(itemId, qty.trim());
    setItemId(''); setQty(''); setTried(false);
  };

  return (
    <EntityFormModal open title={t('materials.title', 'Material check') + ' · ' + section.code} submitLabel={t('materials.add', 'Add')} onSubmit={(e) => void add(e)}
      onClose={onClose} loading={set.isPending} dirty={false} submitError={submitError} cancelLabel={t('materials.close', 'Close')}>
      {mine.length === 0 ? (
        <p className="text-control text-muted-foreground" data-testid="wos-allocations-empty">{t('materials.empty', 'No planned material yet.')}</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="wos-allocations">
          {mine.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-[1_1_8rem]">{itemOf(a.itemId)?.name ?? '—'}</span>
              <span className="tabular-nums">{a.quantity} {unit(a.itemId)}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => void write(a.itemId, null)}>{t('materials.remove', 'Remove')}</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 space-y-3">
        <SelectField label={t('materials.item', 'Item')} value={itemId} onChange={setItemId} fullWidth
          options={[{ value: '', label: t('materials.chooseItem', 'Choose an item') }, ...free.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }))]} />
        <TextField label={t('materials.quantity', 'Planned quantity')} inputMode="decimal" value={qty} onChange={setQty}
          helper={headroom ? t('materials.headroom', 'Work-order plan {{plan}}; planned on other {{sections}} {{other}}; room {{room}}', {
            plan: plan?.toFixed(3), other: headroom.allocated, room: headroom.remaining, sections: terms.sections.toLowerCase() }) : undefined}
          error={tried && (qty.trim() === '' || invalid) ? t('materials.format', 'Enter a quantity above zero, with up to 3 decimals.') : undefined} />
      </div>
    </EntityFormModal>
  );
};
