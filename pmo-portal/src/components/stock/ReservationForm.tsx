import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateField, EntityFormModal, FormGrid, SelectField, TextField, useToast, type SubmitError } from '@/src/components/ui';
import { useIssuableProjects } from '@/src/hooks/useStock';
import { useProjectWorkOrdersForStock } from '@/src/hooks/useStockWorkOrderTransfer';
import { useReservationRefresh } from '@/src/hooks/useStockReservations';
import { stockReservationsRepository as repo } from '@/src/lib/repositories/stockReservations';
import { isPositiveDecimal, normalizeDecimal } from '@/src/lib/stockFormat';
import { useReservationErrorText } from './useReservationErrorText';

interface Props { itemId: string; itemLabel: string; warehouseId: string; warehouseLabel: string; onClose: () => void }

const woLabel = (w: { wo_number?: string | null; title?: string | null; id: string }): string => [w.wo_number, w.title].filter(Boolean).join(' - ') || w.id;

/** Reserve a quantity of one item at one location for a work order (#2693). The database decides free quantity and who may reserve. */
export const ReservationForm: React.FC<Props> = ({ itemId, itemLabel, warehouseId, warehouseLabel, onClose }) => {
  const { t } = useTranslation('stock');
  const { toast } = useToast();
  const errorText = useReservationErrorText();
  const refresh = useReservationRefresh();
  const requestId = useRef(crypto.randomUUID());
  const projects = useIssuableProjects();
  const [projectId, setProjectId] = useState('');
  const [workOrderId, setWorkOrderId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [saving, setSaving] = useState(false);
  const workOrders = useProjectWorkOrdersForStock(projectId || undefined);
  const wos = (workOrders.data ?? []).filter((w) => w.status === 'Draft' || w.status === 'Issued');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const q = normalizeDecimal(quantity);
    const next: Record<string, string> = {};
    if (!workOrderId) next.workOrder = t('reservations.form.errWorkOrder');
    if (!isPositiveDecimal(q)) next.quantity = t('reservations.form.errQuantity');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    repo.reserve({ workOrderId, itemId, warehouseId, quantity: q, expiresOn: expiresOn || null, note }, requestId.current)
      .then(async () => { await refresh(); toast(t('reservations.form.saved'), undefined, 'success'); onClose(); })
      .catch((err: unknown) => setSubmitError({ headline: errorText(err) }))
      .finally(() => setSaving(false));
  };

  return (
    <EntityFormModal open title={t('reservations.form.title')} submitLabel={t('reservations.form.submit')} onSubmit={submit} onClose={onClose} loading={saving} dirty submitError={submitError}>
      <FormGrid>
        <p className="text-sm text-muted-foreground">{`${itemLabel} · ${warehouseLabel}`}</p>
        <SelectField id="reservation-project" label={t('reservations.form.project')} value={projectId} placeholder={t('reservations.form.projectPlaceholder')}
          onChange={(v) => { setProjectId(v); setWorkOrderId(''); }} options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        <SelectField id="reservation-work-order" label={t('reservations.form.workOrder')} required value={workOrderId} placeholder={t('reservations.form.workOrderPlaceholder')}
          error={errors.workOrder} onChange={(v) => { setWorkOrderId(v); setErrors((e) => ({ ...e, workOrder: '' })); }} options={wos.map((w) => ({ value: w.id, label: woLabel(w) }))} />
        <TextField id="reservation-quantity" label={t('reservations.form.quantity')} required inputMode="decimal" value={quantity} error={errors.quantity}
          onChange={(v) => { setQuantity(v); setErrors((e) => ({ ...e, quantity: '' })); }} />
        <DateField label={t('reservations.form.expires')} value={expiresOn} onChange={setExpiresOn} helper={t('reservations.form.expiresHelp')} />
        <TextField id="reservation-note" label={t('reservations.form.note')} value={note} onChange={setNote} />
      </FormGrid>
    </EntityFormModal>
  );
};
