import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  EntityFormModal,
  type SubmitError,
  TextField,
  TextArea,
  NumberField,
  SelectField,
  FormSection,
  FormGrid,
  useEntityForm,
} from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { parseMoneyInput } from '@/src/lib/format';
import { parseTaxFacts } from '@/src/lib/taxTreatment';
import { useTaxTreatmentOptions } from '@/src/hooks/useTaxTreatmentOptions';
import type { WorkOrderRow, WorkOrderInput, WorkOrderPatch } from '@/src/lib/db/workOrders';

/**
 * Create / edit a work order's BODY (#566).
 *
 * ⚑ THE TWO MODES ARE NOT THE SAME FORM, and the difference is a server control rather than a
 * layout choice:
 *   • CREATE is a plain INSERT over `0193 §5`'s grant, which DOES include `order_value` and the
 *     tax pair — and both tax columns are NOT NULL with no default, so origination is the one
 *     moment the basis can be stated on the same write as the value.
 *   • EDIT is a plain UPDATE over `0197 §5(a)`'s SHORTER grant, which does NOT. The value and its
 *     basis left the client UPDATE grant when the basis became an input to the over-commit
 *     control; they move through `set_work_order_value` afterwards, which re-stamps the witness
 *     the issue SoD reads. So this form simply does not show them in edit mode — showing a
 *     disabled field would imply a permission that does not exist anywhere.
 *
 * ⚑ NO PRE-SELECTED TAX TREATMENT, ever (OD-TAX-1). A defaulted marker is a wrong answer
 * indistinguishable from a deliberate one, which is exactly the ambiguity #478 established cannot
 * be recovered later. Submit stays blocked until the user chooses.
 */

interface FormValues {
  title: string;
  clientPoNumber: string;
  description: string;
  orderValue: string;
  taxTreatment: string;
  taxAmount: string;
  orderDate: string;
  startDate: string;
  endDate: string;
}

const validate = (
  v: FormValues,
  t: TFunction,
  isEdit: boolean,
): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.title.trim()) {
    errors.title = t('projectDetail.workOrderForm.errors.titleRequired', 'A title is required');
  }
  if (isEdit) return errors;

  const value = parseMoneyInput(v.orderValue);
  if (value === null || value < 0) {
    errors.orderValue = t(
      'projectDetail.workOrderForm.errors.value',
      'Enter the order value as a non-negative number',
    );
  }
  const tax = parseTaxFacts(v.taxTreatment, v.taxAmount);
  if (!v.taxTreatment.trim()) {
    errors.taxTreatment = t(
      'projectDetail.workOrderForm.errors.treatmentRequired',
      'Choose whether the order value already includes tax',
    );
  }
  if (tax === null && v.taxTreatment.trim()) {
    errors.taxAmount = t(
      'projectDetail.workOrderForm.errors.taxAmount',
      'Enter the tax amount — 0 if there is no tax',
    );
  }
  // Mirrors `work_orders_inclusive_tax_within_value` (0197 §6): tax carved OUT of a figure cannot
  // exceed it, or the net value goes negative and the ceiling inverts. Caught here so the user
  // reads the rule rather than a constraint name.
  if (tax !== null && value !== null && tax.taxTreatment === 'inclusive' && tax.taxAmount > value) {
    errors.taxAmount = t(
      'projectDetail.workOrderForm.errors.inclusiveTaxTooLarge',
      'An inclusive order value already contains its tax, so the tax cannot be larger than the value itself',
    );
  }
  return errors;
};

export interface WorkOrderFormModalProps {
  /** null = create a Draft; a row = edit that Draft's body. */
  workOrder: WorkOrderRow | null;
  currencySymbolPrefix: string;
  onClose: () => void;
  onCreate: (input: WorkOrderInput) => Promise<void>;
  onUpdate: (id: string, patch: WorkOrderPatch) => Promise<void>;
  onError: (err: unknown) => void;
}

const WorkOrderFormModal: React.FC<WorkOrderFormModalProps> = ({
  workOrder,
  currencySymbolPrefix,
  onClose,
  onCreate,
  onUpdate,
  onError,
}) => {
  const { t } = useTranslation();
  const isEdit = !!workOrder;

  const validateWithT = useCallback((v: FormValues) => validate(v, t, isEdit), [t, isEdit]);

  const form = useEntityForm<FormValues>({
    initialValues: {
      title: workOrder?.title ?? '',
      clientPoNumber: workOrder?.client_po_number ?? '',
      description: workOrder?.description ?? '',
      // Blank on create — never seeded with a treatment (OD-TAX-1). In edit mode these three are
      // not rendered at all; they stay in the shape so one validator covers both modes.
      orderValue: '',
      taxTreatment: '',
      taxAmount: '',
      orderDate: workOrder?.order_date ?? '',
      startDate: workOrder?.start_date ?? '',
      endDate: workOrder?.end_date ?? '',
    },
    validate: validateWithT,
    idPrefix: 'work-order-form',
    module: 'work-orders',
    requiredFields: isEdit ? ['title'] : ['title', 'orderValue', 'taxTreatment', 'taxAmount'],
  });

  const titleField = form.fieldProps('title');
  const poField = form.fieldProps('clientPoNumber');
  const descField = form.fieldProps('description');
  const valueField = form.fieldProps('orderValue');
  const treatmentField = form.fieldProps('taxTreatment');
  const taxField = form.fieldProps('taxAmount');
  const orderDateField = form.fieldProps('orderDate');
  const startField = form.fieldProps('startDate');
  const endField = form.fieldProps('endDate');

  // Domain + prose from the one shared source, so this form, the value modal and the
  // contract-value editor cannot drift apart on what the two treatments are or say.
  const { options: taxOptions, placeholder: taxPlaceholder } = useTaxTreatmentOptions();

  const errorSummary = (() => {
    const items: { fieldId: string; message: string }[] = [];
    if (form.errors.title) items.push({ fieldId: titleField.id, message: form.errors.title });
    if (form.errors.orderValue) items.push({ fieldId: valueField.id, message: form.errors.orderValue });
    if (form.errors.taxTreatment)
      items.push({ fieldId: treatmentField.id, message: form.errors.taxTreatment });
    if (form.errors.taxAmount) items.push({ fieldId: taxField.id, message: form.errors.taxAmount });
    return items.length > 0 ? items : undefined;
  })();

  const blankToNull = (s: string) => (s.trim() === '' ? null : s.trim());

  // #559 / AC-ERR-001: a rejected save must leave PERSISTENT evidence in the dialog. The toast
  // auto-dismisses after 4s, ~700px from where the user is looking, after which the modal is
  // indistinguishable from a pristine form with data in it — so the save looks like it worked.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      try {
        if (isEdit && workOrder) {
          await onUpdate(workOrder.id, {
            title: values.title.trim(),
            clientPoNumber: blankToNull(values.clientPoNumber),
            description: blankToNull(values.description),
            orderDate: blankToNull(values.orderDate),
            startDate: blankToNull(values.startDate),
            endDate: blankToNull(values.endDate),
          });
          return;
        }
        // Re-parsed rather than trusted: `validate` already proved both are well-formed, and this
        // is the same single parse (`parseMoneyInput`) validation used, so the two cannot diverge.
        const value = parseMoneyInput(values.orderValue);
        const tax = parseTaxFacts(values.taxTreatment, values.taxAmount);
        if (value === null || tax === null) return;
        await onCreate({
          title: values.title.trim(),
          clientPoNumber: blankToNull(values.clientPoNumber),
          description: blankToNull(values.description),
          orderValue: value,
          taxTreatment: tax.taxTreatment,
          taxAmount: tax.taxAmount,
          orderDate: blankToNull(values.orderDate),
          startDate: blankToNull(values.startDate),
          endDate: blankToNull(values.endDate),
        });
      } catch (err) {
        // `suppressCapture` only: the page's own `onError` classifies this same rejection for the
        // toast and owns the single `save_failed` event (ADR-0067).
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
      title={
        isEdit
          ? t('projectDetail.workOrderForm.editTitle', 'Edit work order')
          : t('projectDetail.workOrderForm.newTitle', 'New work order')
      }
      subtitle={
        isEdit
          ? t(
              'projectDetail.workOrderForm.editSubtitle',
              'Only a draft can be edited. The value and its tax basis are set separately, so the person who set them is recorded.',
            )
          : t(
              'projectDetail.workOrderForm.newSubtitle',
              'Record the client’s purchase order against this project’s contract. It starts as a draft and draws down the contract only once it is issued.',
            )
      }
      submitLabel={
        isEdit
          ? t('projectDetail.workOrderForm.save', 'Save work order')
          : t('projectDetail.workOrderForm.create', 'Create draft')
      }
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      <FormSection legend={t('projectDetail.workOrderForm.detailsLegend', 'The client’s order')}>
        <FormGrid>
          <TextField
            id={titleField.id}
            label={t('projectDetail.workOrderForm.title', 'Title')}
            required
            value={titleField.value}
            onChange={titleField.onChange}
            onBlur={titleField.onBlur}
            error={titleField.error}
            placeholder={t(
              'projectDetail.workOrderForm.titlePlaceholder',
              'e.g. Phase 1 fabrication',
            )}
            fullWidth
          />
          <TextField
            id={poField.id}
            label={t('projectDetail.workOrderForm.clientPoNumber', 'Client PO number')}
            value={poField.value}
            onChange={poField.onChange}
            onBlur={poField.onBlur}
            helper={t(
              'projectDetail.workOrderForm.clientPoHelper',
              'The client’s own reference. Our WO number is issued by the system.',
            )}
          />
          <TextField
            id={orderDateField.id}
            label={t('projectDetail.workOrderForm.orderDate', 'Order date')}
            type="date"
            value={orderDateField.value}
            onChange={orderDateField.onChange}
            onBlur={orderDateField.onBlur}
          />
          <TextField
            id={startField.id}
            label={t('projectDetail.workOrderForm.startDate', 'Start date')}
            type="date"
            value={startField.value}
            onChange={startField.onChange}
            onBlur={startField.onBlur}
          />
          <TextField
            id={endField.id}
            label={t('projectDetail.workOrderForm.endDate', 'End date')}
            type="date"
            value={endField.value}
            onChange={endField.onChange}
            onBlur={endField.onBlur}
          />
          <TextArea
            id={descField.id}
            label={t('projectDetail.workOrderForm.description', 'Scope')}
            value={descField.value}
            onChange={descField.onChange}
            onBlur={descField.onBlur}
            fullWidth
            rows={3}
          />
        </FormGrid>
      </FormSection>

      {!isEdit && (
        <FormSection legend={t('projectDetail.workOrderForm.valueLegend', 'Value and tax basis')}>
          <FormGrid>
            <NumberField
              id={valueField.id}
              label={t('projectDetail.workOrderForm.orderValue', 'Order value')}
              required
              prefix={currencySymbolPrefix}
              value={valueField.value}
              onChange={valueField.onChange}
              onBlur={valueField.onBlur}
              error={valueField.error}
              data-testid="wo-order-value"
            />
            <SelectField
              id={treatmentField.id}
              label={t('projectDetail.workOrderForm.taxTreatment', 'Tax treatment')}
              required
              value={treatmentField.value}
              onChange={treatmentField.onChange}
              onBlur={treatmentField.onBlur}
              error={treatmentField.error}
              placeholder={taxPlaceholder}
              options={taxOptions}
              data-testid="wo-tax-treatment"
            />
            <NumberField
              id={taxField.id}
              label={t('projectDetail.workOrderForm.taxAmount', 'Tax amount')}
              required
              prefix={currencySymbolPrefix}
              value={taxField.value}
              onChange={taxField.onChange}
              onBlur={taxField.onBlur}
              error={taxField.error}
              helper={t('projectDetail.workOrderForm.taxAmountHelper', 'Enter 0 if there is no tax.')}
              data-testid="wo-tax-amount"
            />
          </FormGrid>
        </FormSection>
      )}
    </EntityFormModal>
  );
};

export default WorkOrderFormModal;
