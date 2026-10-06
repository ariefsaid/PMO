import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EntityFormModal, FormGrid, FormSection, NumberField, TextArea, TextField, type SubmitError,
} from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import type { BoqItemRow, ProgressAssessmentInput } from '@/src/lib/db/progressBilling';

/**
 * Record a progress ASSESSMENT (#766, DD-PBL-2/3): the quantity done to date on every BoQ line for one month.
 * Operational only — it sets #765's percent complete for that month and never creates an invoice. Every line is
 * sent (blank = 0) because the server treats a missing line as nothing done.
 */
export interface ProgressAssessmentModalProps {
  boqItems: BoqItemRow[];
  /** The latest assessment's quantities, used as the starting values. */
  assessedByBoqItem: Record<string, number>;
  /** `YYYY-MM`. */
  defaultMonth: string;
  onClose: () => void;
  onSave: (input: Omit<ProgressAssessmentInput, 'projectId'>) => Promise<void>;
  onError: (err: unknown) => void;
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const ProgressAssessmentModal: React.FC<ProgressAssessmentModalProps> = ({
  boqItems, assessedByBoqItem, defaultMonth, onClose, onSave, onError,
}) => {
  const { t } = useTranslation();
  const [month, setMonth] = useState(defaultMonth);
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(
    boqItems.map((line) => [line.id, assessedByBoqItem[line.id] === undefined ? '' : formatMoneyInputValue(assessedByBoqItem[line.id])]),
  ));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!MONTH_PATTERN.test(month.trim())) errs.month = t('projectDetail.billing.assessment.errors.month', 'Enter the month as YYYY-MM');
    const lines: ProgressAssessmentInput['quantities'] = [];
    for (const line of boqItems) {
      const raw = (quantities[line.id] ?? '').trim();
      if (raw === '') { lines.push({ boqItemId: line.id, quantityToDate: 0 }); continue; }
      const quantity = parseMoneyInputAtScale(raw, 3);
      if (quantity === null || quantity < 0) {
        errs[line.id] = t('projectDetail.billing.assessment.errors.quantity', 'Each quantity done to date must be 0 or more with at most 3 decimal places');
      } else {
        lines.push({ boqItemId: line.id, quantityToDate: quantity });
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    setSaveError(null);
    void onSave({ month: `${month.trim()}-01`, quantities: lines, note: note.trim() || null })
      .catch((err: unknown) => {
        const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
        setSaveError({ headline, detail });
        onError(err);
      })
      .finally(() => setSaving(false));
  };

  return (
    <EntityFormModal
      open
      width="lg"
      title={t('projectDetail.billing.assessment.title', 'Record progress')}
      subtitle={t('projectDetail.billing.assessment.subtitle', 'Quantities done to date for the month. This is the operational assessment — it never creates an invoice.')}
      submitLabel={t('projectDetail.billing.assessment.save', 'Save progress')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={saving}
      dirty
    >
      <FormSection legend={t('projectDetail.billing.assessment.title', 'Record progress')}>
        <FormGrid>
          <TextField id="assessment-month" label={t('projectDetail.billing.assessment.month', 'Month (YYYY-MM)')} required
            value={month} onChange={setMonth} error={errors.month} />
          {boqItems.map((line) => (
            <NumberField key={line.id} id={`assessment-qty-${line.id}`}
              label={t('projectDetail.billing.assessment.quantityToDate', '{{item}} — done to date ({{unit}})',
                { item: `${line.item_code} — ${line.description}`, unit: line.unit })}
              value={quantities[line.id] ?? ''}
              onChange={(value) => setQuantities((current) => ({ ...current, [line.id]: value }))}
              error={errors[line.id]} localeAware />
          ))}
          <TextArea id="assessment-note" label={t('projectDetail.billing.assessment.note', 'Note (optional)')}
            value={note} onChange={setNote} maxLength={500} rows={2} fullWidth />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default ProgressAssessmentModal;
