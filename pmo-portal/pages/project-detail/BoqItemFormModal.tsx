import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Combobox, EntityFormModal, FormGrid, FormSection, NumberField, SelectField, TextField, useEntityForm, type SubmitError,
} from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import type { BoqItemInput, BoqItemRow } from '@/src/lib/db/progressBilling';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';

/**
 * Add or edit one bill-of-quantities line (#766). Rates exclude tax (DD-PBL-6). When ERPNext owns the revenue
 * domain the item is picked from the ERP catalogue (the line becomes an invoice line); otherwise it is typed.
 */
interface FormValues { itemCode: string; description: string; unit: string; quantity: string; rate: string; workOrderId: string }

export interface BoqItemFormModalProps {
  /** null = add a line; a row = edit it. */
  item: BoqItemRow | null;
  /** This project's work orders. */
  workOrders: WorkOrderRow[];
  currencySymbolPrefix: string;
  onClose: () => void;
  onSave: (input: BoqItemInput) => Promise<void>;
  onError: (err: unknown) => void;
}

const BoqItemFormModal: React.FC<BoqItemFormModalProps> = ({ item, workOrders, currencySymbolPrefix, onClose, onSave, onError }) => {
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
    if (quantity === null || quantity <= 0) errors.quantity = t('projectDetail.billing.boqForm.errors.quantity', 'Enter a quantity above 0 with at most 3 decimal places');
    const rate = parseMoneyInputAtScale(v.rate, 2);
    if (rate === null || rate < 0) errors.rate = t('projectDetail.billing.boqForm.errors.rate', 'Enter a rate of 0 or more with at most 2 decimal places');
    return errors;
  }, [t]);

  const form = useEntityForm<FormValues>({
    initialValues: item
      ? { itemCode: item.item_code, description: item.description, unit: item.unit,
          quantity: formatMoneyInputValue(Number(item.quantity)), rate: formatMoneyInputValue(Number(item.rate)),
          workOrderId: item.work_order_id ?? '' }
      : { itemCode: '', description: '', unit: '', quantity: '', rate: '', workOrderId: '' },
    validate,
    idPrefix: 'boq-item',
    module: 'billing',
    requiredFields: ['itemCode', 'description', 'unit', 'quantity', 'rate'],
  });
  const itemField = form.fieldProps('itemCode');
  const descriptionField = form.fieldProps('description');
  const unitField = form.fieldProps('unit');
  const quantityField = form.fieldProps('quantity');
  const rateField = form.fieldProps('rate');
  const woField = form.fieldProps('workOrderId');

  const checked = { itemCode: itemField, description: descriptionField, unit: unitField, quantity: quantityField, rate: rateField };
  const errorSummary = (() => {
    const items = (Object.keys(checked) as Array<keyof typeof checked>)
      .filter((key) => form.errors[key])
      .map((key) => ({ fieldId: checked[key].id, message: form.errors[key] as string }));
    return items.length > 0 ? items : undefined;
  })();

  const woOptions = [
    { value: '', label: t('projectDetail.billing.boqForm.noWorkOrder', 'None — the whole contract') },
    ...workOrders.map((wo) => ({ value: wo.id, label: wo.wo_number ? `${wo.wo_number} — ${wo.title}` : wo.title })),
  ];
  const itemLabel = t('projectDetail.billing.boqForm.item', 'ERP item');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const quantity = parseMoneyInputAtScale(values.quantity, 3);
      const rate = parseMoneyInputAtScale(values.rate, 2);
      if (quantity === null || rate === null) return;
      try {
        await onSave({
          itemCode: values.itemCode.trim(), description: values.description.trim(), unit: values.unit.trim(),
          quantity, rate, workOrderId: values.workOrderId || null,
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
      subtitle={t('projectDetail.billing.boqForm.subtitle', 'Rates exclude tax. A line may belong to one work order on this project.')}
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
          <NumberField id={quantityField.id} label={t('projectDetail.billing.boqForm.quantity', 'Quantity')} required
            value={quantityField.value} onChange={quantityField.onChange} onBlur={quantityField.onBlur}
            error={quantityField.error} localeAware />
          <NumberField id={rateField.id} label={t('projectDetail.billing.boqForm.rate', 'Rate (excl. PPN)')} required
            prefix={currencySymbolPrefix} value={rateField.value} onChange={rateField.onChange} onBlur={rateField.onBlur}
            error={rateField.error} localeAware />
          <SelectField id={woField.id} label={t('projectDetail.billing.boqForm.workOrder', 'Work order')}
            value={woField.value} onChange={woField.onChange} onBlur={woField.onBlur} options={woOptions} />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default BoqItemFormModal;
