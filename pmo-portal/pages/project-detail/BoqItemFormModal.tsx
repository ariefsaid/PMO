import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Combobox, EntityFormModal, FormGrid, FormSection, NumberField, SelectField, TextField, useEntityForm, type SubmitError,
} from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import type { BoqItemInput, BoqItemRow } from '@/src/lib/db/progressBilling';
import type { EarningBasis } from '@/src/lib/progressBilling';

/**
 * Add or edit one bill-of-quantities line (#766). Rates exclude tax (DD-PBL-6). A lump-sum line is one lot earned by percent; its quantity is fixed at 1 (ADR-0090). When ERPNext owns the revenue
 * domain the item is picked from the ERP catalogue (the line becomes an invoice line); otherwise it is typed.
 */
interface FormValues {
  itemCode: string; description: string; unit: string; quantity: string; rate: string;
  /** '' = derive from the unit (lot / ls / lump sum ⇒ lump sum); a value is an explicit choice. */
  basis: '' | EarningBasis;
  lineNo: string;
}

const LUMP_SUM_UNITS = ['lot', 'ls', 'lump sum'];
/** Mirrors the CLI's defaultContractLineBasis (ADR-0090): the unit suggests the basis, never forces it. */
const defaultBasis = (unit: string): EarningBasis => (LUMP_SUM_UNITS.includes(unit.trim().toLowerCase()) ? 'lump_sum' : 'unit_rate');
const effectiveBasis = (v: Pick<FormValues, 'basis' | 'unit'>): EarningBasis => v.basis || defaultBasis(v.unit);

export interface BoqItemFormModalProps {
  /** null = add a line; a row = edit it. */
  item: BoqItemRow | null;
  currencySymbolPrefix: string;
  onClose: () => void;
  onSave: (input: BoqItemInput) => Promise<void>;
  onError: (err: unknown) => void;
}

const BoqItemFormModal: React.FC<BoqItemFormModalProps> = ({ item, currencySymbolPrefix, onClose, onSave, onError }) => {
  const { t } = useTranslation();
  const erpItems = useErpItemOptions('sales');
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const validate = useCallback((v: FormValues) => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    const required = t('projectDetail.billing.boqForm.errors.required', 'Required');
    if (!v.itemCode.trim()) errors.itemCode = required;
    if (!v.description.trim()) errors.description = required;
    if (!v.unit.trim()) errors.unit = required;
    const quantity = parseMoneyInputAtScale(v.quantity, 3);
    if (effectiveBasis(v) !== 'lump_sum' && (quantity === null || quantity <= 0)) errors.quantity = t('projectDetail.billing.boqForm.errors.quantity', 'Enter a quantity above 0 with at most 3 decimal places');
    const rate = parseMoneyInputAtScale(v.rate, 2);
    if (rate === null || rate < 0) errors.rate = t('projectDetail.billing.boqForm.errors.rate', 'Enter a rate of 0 or more with at most 2 decimal places');
    if (v.lineNo.trim() !== '' && !/^\d{1,9}$/.test(v.lineNo.trim())) {
      errors.lineNo = t('projectTabs:contractQuantities.billing.boqForm.errors.lineNo', 'Enter a whole line number, or leave it blank');
    }
    return errors;
  }, [t]);

  const form = useEntityForm<FormValues>({
    initialValues: item
      ? { itemCode: item.item_code, description: item.description, unit: item.unit,
          quantity: formatMoneyInputValue(Number(item.quantity)), rate: formatMoneyInputValue(Number(item.rate)),
          basis: item.earning_basis as EarningBasis, lineNo: item.line_no === null ? '' : String(item.line_no) }
      : { itemCode: '', description: '', unit: '', quantity: '', rate: '', basis: '', lineNo: '' },
    validate,
    idPrefix: 'boq-item',
    module: 'billing',
    // quantity is required by validate() instead: a lump-sum line has none to type.
    requiredFields: ['itemCode', 'description', 'unit', 'rate'],
  });
  const itemField = form.fieldProps('itemCode');
  const descriptionField = form.fieldProps('description');
  const unitField = form.fieldProps('unit');
  const quantityField = form.fieldProps('quantity');
  const rateField = form.fieldProps('rate');
  const basisField = form.fieldProps('basis');
  const lineNoField = form.fieldProps('lineNo');
  const lumpSum = effectiveBasis(form.values) === 'lump_sum';

  const checked = { itemCode: itemField, description: descriptionField, unit: unitField, quantity: quantityField, rate: rateField, lineNo: lineNoField };
  const errorSummary = (() => {
    const items = (Object.keys(checked) as Array<keyof typeof checked>)
      .filter((key) => form.errors[key])
      .map((key) => ({ fieldId: checked[key].id, message: form.errors[key] as string }));
    return items.length > 0 ? items : undefined;
  })();

  const basisOptions = [
    { value: 'unit_rate', label: t('projectTabs:contractQuantities.billing.boqForm.basisUnitRate', 'Unit rate — quantity × rate') },
    { value: 'lump_sum', label: t('projectTabs:contractQuantities.billing.boqForm.basisLumpSum', 'Lump sum — 1 lot, earned by percent') },
  ];
  const itemLabel = t('projectDetail.billing.boqForm.item', 'ERP item');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const basis = effectiveBasis(values);
      const quantity = basis === 'lump_sum' ? 1 : parseMoneyInputAtScale(values.quantity, 3);
      const rate = parseMoneyInputAtScale(values.rate, 2);
      if (quantity === null || rate === null) return;
      try {
        await onSave({
          itemCode: values.itemCode.trim(), description: values.description.trim(), unit: values.unit.trim(),
          quantity, rate, earningBasis: basis,
          lineNo: values.lineNo.trim() === '' ? null : Number(values.lineNo.trim()),
        });
      } catch (err) {
        const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
        setSaveError({ headline, detail });
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      width="lg"
      title={item
        ? t('projectDetail.billing.boqForm.titleEdit', 'Edit bill of quantities line')
        : t('projectDetail.billing.boqForm.titleNew', 'Add a bill of quantities line')}
      subtitle={t('projectDetail.billing.boqForm.subtitle', 'Rates exclude tax. Work orders take quantities from a line when you allocate it.')}
      submitLabel={t('projectDetail.billing.boqForm.save', 'Save line')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      <FormSection legend={t('projectDetail.billing.boqForm.legend', 'Line')}>
        <FormGrid>
          {erpItems.connected ? (
            <Combobox label={itemLabel} required value={itemField.value || null}
              onChange={(value) => itemField.onChange(value)} loadOptions={erpItems.loadOptions} error={itemField.error} />
          ) : (
            <TextField id={itemField.id} label={itemLabel} required value={itemField.value}
              onChange={itemField.onChange} onBlur={itemField.onBlur} error={itemField.error} />
          )}
          <TextField id={descriptionField.id} label={t('projectDetail.billing.boqForm.description', 'Description')} required
            value={descriptionField.value} onChange={descriptionField.onChange} onBlur={descriptionField.onBlur}
            error={descriptionField.error} fullWidth />
          <TextField id={unitField.id} label={t('projectDetail.billing.boqForm.unit', 'Unit')} required
            value={unitField.value} onChange={unitField.onChange} onBlur={unitField.onBlur} error={unitField.error} />
          <SelectField id={basisField.id} label={t('projectTabs:contractQuantities.billing.boqForm.basis', 'Earned by')}
            value={basisField.value || defaultBasis(unitField.value)}
            onChange={(value) => basisField.onChange(value as EarningBasis)} onBlur={basisField.onBlur} options={basisOptions} />
          {!lumpSum && (
            <NumberField id={quantityField.id} label={t('projectDetail.billing.boqForm.quantity', 'Quantity')} required
              value={quantityField.value} onChange={quantityField.onChange} onBlur={quantityField.onBlur}
              error={quantityField.error} localeAware />
          )}
          <NumberField id={rateField.id} label={t('projectDetail.billing.boqForm.rate', 'Rate (excl. PPN)')} required
            prefix={currencySymbolPrefix} value={rateField.value} onChange={rateField.onChange} onBlur={rateField.onBlur}
            error={rateField.error} localeAware />
          <TextField id={lineNoField.id} label={t('projectTabs:contractQuantities.billing.boqForm.lineNo', 'Line no. (optional)')}
            value={lineNoField.value} onChange={lineNoField.onChange} onBlur={lineNoField.onBlur} error={lineNoField.error} />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default BoqItemFormModal;
