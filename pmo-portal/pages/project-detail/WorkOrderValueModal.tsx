import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  EntityFormModal,
  NumberField,
  SelectField,
  FormSection,
  FormGrid,
  useEntityForm,
} from '@/src/components/ui';
import { parseMoneyInput } from '@/src/lib/format';
import { parseTaxFacts } from '@/src/lib/taxTreatment';
import { useTaxTreatmentOptions } from '@/src/hooks/useTaxTreatmentOptions';
import type { WorkOrderRow, SetWorkOrderValueInput } from '@/src/lib/db/workOrders';

/**
 * Set a draft work order's VALUE and the tax basis that describes it (#566).
 *
 * ⚑ WHY THIS IS ITS OWN DIALOG AND NOT A FIELD ON THE EDIT FORM. `set_work_order_value` is the
 * sole witnessed writer of `order_value`, `tax_treatment` and `tax_amount`: it stamps WHO set the
 * figure, and the issue gate then refuses to let that same person issue it (`0193 §8`). Folding it
 * into the body form would make an ordinary rename re-stamp the witness and silently re-arm the
 * SoD, which is the opposite of what a rename means.
 *
 * ⚑ THE BASIS TRAVELS WITH THE VALUE, always. `0197 §5` made both tax params REQUIRED on this RPC
 * for a reason worth restating: while the basis could be re-keyed on its own, a PM could set
 * `tax_treatment='inclusive', tax_amount=order_value` behind the ratifier's back and net the whole
 * commitment to zero — the commitment then vanished from the very screen meant to reveal it. So
 * this form asks both questions or neither, and it does NOT pre-select a treatment (OD-TAX-1).
 *
 * ⚑ THE CURRENT VALUE IS NOT SEEDED INTO THE FORM. Restating the figure is an act of authorship —
 * the witness trigger re-stamps on `update of order_value` with no value comparison, precisely
 * because a ratifier confirming the number an originator proposed is the act the rule asks for.
 * Pre-filling would make "just press Save" the path of least resistance for exactly that decision.
 * The current figure is shown as read-only context above the fields instead.
 */

interface FormValues {
  value: string;
  taxTreatment: string;
  taxAmount: string;
}

const validate = (v: FormValues, t: TFunction): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  const value = parseMoneyInput(v.value);
  if (value === null || value < 0) {
    errors.value = t(
      'projectDetail.workOrderValue.errors.value',
      'Enter the order value as a non-negative number',
    );
  }
  if (!v.taxTreatment.trim()) {
    errors.taxTreatment = t(
      'projectDetail.workOrderValue.errors.treatmentRequired',
      'Choose whether this value already includes tax',
    );
  }
  const tax = parseTaxFacts(v.taxTreatment, v.taxAmount);
  if (tax === null && v.taxTreatment.trim()) {
    errors.taxAmount = t(
      'projectDetail.workOrderValue.errors.taxAmount',
      'Enter the tax amount — 0 if there is no tax',
    );
  }
  if (tax !== null && value !== null && tax.taxTreatment === 'inclusive' && tax.taxAmount > value) {
    errors.taxAmount = t(
      'projectDetail.workOrderValue.errors.inclusiveTaxTooLarge',
      'An inclusive value already contains its tax, so the tax cannot be larger than the value itself',
    );
  }
  return errors;
};

export interface WorkOrderValueModalProps {
  workOrder: WorkOrderRow;
  /** Rendered read-only context: the figure on the row today, already formatted with its basis. */
  currentValueText: string;
  currencySymbolPrefix: string;
  onClose: () => void;
  onSave: (input: SetWorkOrderValueInput) => Promise<void>;
  onError: (err: unknown) => void;
}

const WorkOrderValueModal: React.FC<WorkOrderValueModalProps> = ({
  workOrder,
  currentValueText,
  currencySymbolPrefix,
  onClose,
  onSave,
  onError,
}) => {
  const { t } = useTranslation();
  const validateWithT = useCallback((v: FormValues) => validate(v, t), [t]);
  const { options: taxOptions, placeholder: taxPlaceholder } = useTaxTreatmentOptions();

  const form = useEntityForm<FormValues>({
    initialValues: { value: '', taxTreatment: '', taxAmount: '' },
    validate: validateWithT,
    idPrefix: 'work-order-value',
    module: 'work-orders',
    requiredFields: ['value', 'taxTreatment', 'taxAmount'],
  });

  const valueField = form.fieldProps('value');
  const treatmentField = form.fieldProps('taxTreatment');
  const taxField = form.fieldProps('taxAmount');

  const errorSummary = (() => {
    const items: { fieldId: string; message: string }[] = [];
    if (form.errors.value) items.push({ fieldId: valueField.id, message: form.errors.value });
    if (form.errors.taxTreatment)
      items.push({ fieldId: treatmentField.id, message: form.errors.taxTreatment });
    if (form.errors.taxAmount) items.push({ fieldId: taxField.id, message: form.errors.taxAmount });
    return items.length > 0 ? items : undefined;
  })();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const value = parseMoneyInput(values.value);
      const tax = parseTaxFacts(values.taxTreatment, values.taxAmount);
      if (value === null || tax === null) return;
      try {
        await onSave({
          id: workOrder.id,
          value,
          taxTreatment: tax.taxTreatment,
          taxAmount: tax.taxAmount,
        });
      } catch (err) {
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={t('projectDetail.workOrderValue.title', 'Set the work order value')}
      subtitle={t(
        'projectDetail.workOrderValue.subtitle',
        'Your name is recorded against this figure. Whoever sets it cannot also issue the work order — that is the second pair of eyes on the money.',
      )}
      submitLabel={t('projectDetail.workOrderValue.save', 'Set value')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      <FormSection legend={t('projectDetail.workOrderValue.legend', 'Value and tax basis')}>
        {/* Read-only context, as a labelled figure rather than a value spliced into prose. */}
        <p data-testid="wo-value-current" className="mb-3 text-[12px] text-muted-foreground">
          <span className="font-semibold uppercase tracking-[0.06em]">
            {t('projectDetail.workOrderValue.current', 'Current value')}
          </span>
          <span className="ml-2 font-bold tabular text-foreground">{currentValueText}</span>
        </p>
        <FormGrid>
          <NumberField
            id={valueField.id}
            label={t('projectDetail.workOrderValue.value', 'Order value')}
            required
            prefix={currencySymbolPrefix}
            value={valueField.value}
            onChange={valueField.onChange}
            onBlur={valueField.onBlur}
            error={valueField.error}
            data-testid="wo-value-input"
          />
          <SelectField
            id={treatmentField.id}
            label={t('projectDetail.workOrderValue.taxTreatment', 'Tax treatment')}
            required
            value={treatmentField.value}
            onChange={treatmentField.onChange}
            onBlur={treatmentField.onBlur}
            error={treatmentField.error}
            placeholder={taxPlaceholder}
            options={taxOptions}
            data-testid="wo-value-tax-treatment"
          />
          <NumberField
            id={taxField.id}
            label={t('projectDetail.workOrderValue.taxAmount', 'Tax amount')}
            required
            prefix={currencySymbolPrefix}
            value={taxField.value}
            onChange={taxField.onChange}
            onBlur={taxField.onBlur}
            error={taxField.error}
            helper={t('projectDetail.workOrderValue.taxAmountHelper', 'Enter 0 if there is no tax.')}
            data-testid="wo-value-tax-amount"
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default WorkOrderValueModal;
