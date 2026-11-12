import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, FormGrid, FormSection, NumberField, TextArea, type SubmitError } from '@/src/components/ui';
import { useVariationRoute } from '@/src/hooks/useSubcontract';
import { useUsers } from '@/src/hooks/useUsers';
import type { RequestPoVariationInput, SubcontractPoPositionRow } from '@/src/lib/db/subcontracts';
import { formatCurrency, formatNumberExact, parseMoneyInputAtScale } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

export interface PoVariationModalProps {
  row: SubcontractPoPositionRow;
  origin: 'pre_work' | 'post_work';
  currency: string;
  onClose: () => void;
  onSave: (input: Omit<RequestPoVariationInput, 'poId'>) => Promise<string>;
  onError: (error: unknown) => void;
}

const VariationRouteSummary: React.FC<{ variationId: string }> = ({ variationId }) => {
  const { t } = useTranslation('procurement');
  const route = useVariationRoute(variationId);
  const users = useUsers();
  if (route.isPending) return <p role="status" className="text-sm text-muted-foreground">{t('subcontract.variations.routeLoading', 'Loading the approval route…')}</p>;
  if (route.isError || !route.data) return <p role="alert" className="text-sm text-warning-foreground">{t('subcontract.variations.routeUnavailable', 'The approval route could not be loaded.')}</p>;
  const info = route.data;
  if (info.route === 'flat') return <p role="status" className="text-sm">{t('subcontract.variations.noRoute', 'No approval route is configured for this request.')}</p>;
  if (info.route !== 'project' || info.approver_ids.length === 0) {
    return <p role="status" className="text-sm">{t('subcontract.variations.seniorRoute', 'Needs a senior approver')}</p>;
  }
  const names = info.approver_ids.map((id) => users.data?.find((user) => user.id === id)?.full_name).filter(Boolean);
  return <p role="status" className="text-sm">{t('subcontract.variations.decidedBy', 'Decided by {{names}}', {
    names: names.length ? names.join(', ') : t('subcontract.variations.projectApprovers', 'project approvers'),
  })}</p>;
};

const PoVariationModal: React.FC<PoVariationModalProps> = ({ row, origin, currency, onClose, onSave, onError }) => {
  const { t } = useTranslation('procurement');
  const maxQuantity = origin === 'post_work' ? Number(row.verified_not_on_po) : null;
  const [quantity, setQuantity] = useState(origin === 'post_work' && maxQuantity ? formatNumberExact(maxQuantity) : '');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submittedId) { onClose(); return; }
    const nextErrors: Record<string, string> = {};
    const parsed = parseMoneyInputAtScale(quantity.trim(), 3);
    if (parsed === null || parsed <= 0) nextErrors.quantity = t('subcontract.variations.quantityError', 'Enter a quantity above 0 with at most 3 decimal places.');
    else if (maxQuantity !== null && parsed > maxQuantity) nextErrors.quantity = t('subcontract.variations.maxError', 'The quantity cannot exceed the {{max}} verified amount not yet on the PO.', { max: formatNumberExact(maxQuantity) });
    if (!reason.trim()) nextErrors.reason = t('subcontract.variations.reasonRequired', 'Give a reason for the variation.');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setBusy(true);
    setSaveError(null);
    void onSave({ origin, reason: reason.trim(), lines: [{ boqItemId: row.boq_item_id, additionalQuantity: parsed as number }] })
      .then(setSubmittedId)
      .catch((error: unknown) => {
        const classified = classifyMutationError(error, undefined, { suppressCapture: true });
        setSaveError({ headline: classified.headline, detail: classified.detail });
        onError(error);
      }).finally(() => setBusy(false));
  };

  const amount = (parseMoneyInputAtScale(quantity.trim(), 3) ?? 0) * Number(row.rate);
  return (
    <EntityFormModal open width="lg"
      title={t('subcontract.variations.newTitle', 'Request PO variation')}
      submitLabel={submittedId ? t('subcontract.variations.done', 'Done') : t('subcontract.variations.request', 'Request variation')}
      onSubmit={handleSubmit} submitError={saveError} onClose={onClose} loading={busy}
      dirty={!submittedId && (quantity !== '' || reason !== '')}>
      <p className="mb-3 text-sm text-foreground tabular">{t('subcontract.variations.newSubtitle', '{{item}} · {{unit}} · PO rate {{rate}}', {
        item: `${row.item_code} — ${row.description}`, unit: row.unit, rate: formatCurrency(Number(row.rate), currency),
      })}</p>
      {submittedId ? <FormSection legend={t('subcontract.variations.routeLegend', 'Approval route')}>
        <VariationRouteSummary variationId={submittedId} />
      </FormSection> : <>
        <FormSection legend={t('subcontract.variations.details', 'Variation details')}>
          <FormGrid>
            <NumberField id="po-variation-quantity" label={t('subcontract.variations.quantity', 'Additional quantity ({{unit}})', { unit: row.unit })}
              value={quantity} onChange={setQuantity} error={errors.quantity} localeAware
              helper={maxQuantity === null ? t('subcontract.variations.preWorkHelper', 'Before work is completed, request the additional quantity needed.')
                : t('subcontract.variations.postWorkHelper', 'Maximum verified amount not yet on PO: {{max}} {{unit}}', { max: formatNumberExact(maxQuantity), unit: row.unit })} />
            <p className="text-sm text-muted-foreground">{t('subcontract.variations.amount', 'Variation amount')}: <strong className="tabular-nums">{formatCurrency(amount, currency)}</strong></p>
          </FormGrid>
          <TextArea id="po-variation-reason" label={t('subcontract.variations.reason', 'Reason')} required value={reason}
            onChange={(value) => setReason(value)} error={errors.reason} maxLength={1000} rows={3} fullWidth />
        </FormSection>
      </>}
    </EntityFormModal>
  );
};

export default PoVariationModal;
