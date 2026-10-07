import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox, EntityFormModal, FormGrid, NumberField, TextField, useEntityForm, type SubmitError } from '@/src/components/ui';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import { useRevenueMutations } from '@/src/hooks/useRevenue';
import { useCommandIntent } from '@/src/hooks/useCommandIntent';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { currencySymbol, formatCurrencyCents, formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import { invoiceAmountProblem } from '@/src/lib/workOrderBilling';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';

/**
 * "Invoice this work order" (OD-BILL-1, FR-BWO-008). One ERPNext Draft for the project's client, one line, linked to
 * the work order; the ERP PO reference falls back to the work order's client PO (no reference is sent).
 * ⚑ The amount check here is a courtesy. The database refuses past-the-value invoices before any ERP write (0262),
 *   counting commands still in flight that this dialog cannot see — its refusal is shown verbatim.
 * ⚑ ONE command identity per dialog session (ADR-0058): a retry after a lost response reuses it.
 */
export interface InvoiceWorkOrderModalProps {
  workOrder: WorkOrderRow;
  projectId: string;
  /** The project's client — the invoice customer. The tab renders this dialog only when there is one. */
  clientId: string;
  /** Still to invoice on this work order, excl. tax, from work_order_billing. */
  remaining: number;
  onClose: () => void;
  onCreated: (siNumber: string) => void;
}

interface Values {
  itemCode: string;
  description: string;
  amount: string;
}

/** The invoice line's description: the work order's own number and title (no filler copy — it lands on the client's
 *  invoice in ERPNext, whatever the user's language), within ERPNext's 140 characters. */
function workOrderInvoiceDescription(wo: Pick<WorkOrderRow, 'wo_number' | 'title'>): string {
  return (wo.wo_number ? `${wo.wo_number} — ${wo.title}` : wo.title).slice(0, 140);
}

const InvoiceWorkOrderModal: React.FC<InvoiceWorkOrderModalProps> = ({
  workOrder, projectId, clientId, remaining, onClose, onCreated,
}) => {
  const { t } = useTranslation();
  const erpItems = useErpItemOptions('sales');
  const { create } = useRevenueMutations();
  const intent = useCommandIntent();
  const remainingText = formatCurrencyCents(remaining, workOrder.currency);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const form = useEntityForm<Values>({
    initialValues: {
      itemCode: '',
      description: workOrderInvoiceDescription(workOrder),
      amount: formatMoneyInputValue(remaining),
    },
    validate: (v) => {
      const errors: Partial<Record<keyof Values, string>> = {};
      if (!v.itemCode.trim()) {
        errors.itemCode = t('projectDetail.workOrders.billing.modal.errors.itemRequired', 'Choose the ERP item.');
      }
      const problem = invoiceAmountProblem(parseMoneyInputAtScale(v.amount, 2), remaining);
      if (problem === 'invalid') {
        errors.amount = t('projectDetail.workOrders.billing.modal.errors.amountInvalid', 'Enter an amount with no more than 2 decimal places.');
      } else if (problem === 'not-positive') {
        errors.amount = t('projectDetail.workOrders.billing.modal.errors.amountPositive', 'The amount must be more than zero.');
      } else if (problem === 'over-remaining') {
        errors.amount = t('projectDetail.workOrders.billing.modal.errors.amountOver', {
          defaultValue: 'Only {{remaining}} is still to invoice on this work order.',
          remaining: remainingText,
          interpolation: { escapeValue: false },
        });
      }
      return errors;
    },
    idPrefix: 'invoice-work-order',
    module: 'work-orders',
    requiredFields: ['itemCode', 'amount'],
  });

  const itemField = form.fieldProps('itemCode');
  const descriptionField = form.fieldProps('description');
  const amountField = form.fieldProps('amount');

  const errorSummary = (() => {
    const items: { fieldId: string; message: string }[] = [];
    if (form.errors.itemCode) items.push({ fieldId: itemField.id, message: form.errors.itemCode });
    if (form.errors.amount) items.push({ fieldId: amountField.id, message: form.errors.amount });
    return items.length > 0 ? items : undefined;
  })();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (v) => {
      const rate = parseMoneyInputAtScale(v.amount, 2);
      if (rate === null) return; // unreachable after validate
      try {
        const description = v.description.trim();
        const res = await create.mutateAsync({
          customerId: clientId,
          projectId,
          workOrderId: workOrder.id,
          items: [{ item_code: v.itemCode.trim(), qty: 1, rate, ...(description ? { description } : {}) }],
          intent,
        });
        onCreated(res.si_number);
      } catch (err) {
        // The dialog is the one place the failure is shown (no second toast); classifying here records the single
        // save_failed event (ADR-0067).
        const { headline, detail } = classifyMutationError(
          err,
          { BW001: t('projectDetail.workOrders.billing.modal.errorHeadline', 'That would invoice past the work order') },
          { module: 'projects', operation: 'create' },
        );
        // BW001 is the database's refusal before any ERP write. Its message is diagnostics (English, unformatted
        // figures): say it in the user's language, with the amount this dialog was opened with.
        const isRefusal = (err as { code?: unknown } | null)?.code === 'BW001';
        setSaveError({
          headline,
          detail: isRefusal
            ? t('projectDetail.workOrders.billing.modal.errors.refused', {
                defaultValue:
                  'Nothing was written to ERPNext. This work order had {{remaining}} still to invoice when you opened this dialog; another invoice or a change to the work order may have used it since. Close and reopen it to see what is left.',
                remaining: remainingText,
                interpolation: { escapeValue: false },
              })
            : detail,
        });
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={t('projectDetail.workOrders.billing.modal.title', 'Invoice this work order')}
      subtitle={t(
        'projectDetail.workOrders.billing.modal.subtitle',
        "Creates a draft invoice in ERPNext for the project's client. A different Finance or Admin user submits it.",
      )}
      submitLabel={t('projectDetail.workOrders.billing.modal.submit', 'Create draft invoice')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      <FormGrid>
        {erpItems.connected ? (
          <Combobox
            label={t('projectDetail.workOrders.billing.modal.item', 'ERP item')}
            value={itemField.value || null}
            selectedOption={itemField.value ? { value: itemField.value, label: itemField.value } : null}
            onChange={(code) => itemField.onChange(code ?? '')}
            loadOptions={erpItems.loadOptions}
            required
            error={itemField.error}
            noun={t('projectDetail.workOrders.billing.modal.item', 'ERP item')}
          />
        ) : (
          <TextField
            id={itemField.id}
            label={t('projectDetail.workOrders.billing.modal.itemCode', 'Item code')}
            value={itemField.value}
            onChange={itemField.onChange}
            error={itemField.error}
            required
          />
        )}
        <TextField
          id={descriptionField.id}
          label={t('projectDetail.workOrders.billing.modal.description', 'Description')}
          value={descriptionField.value}
          onChange={descriptionField.onChange}
        />
        <NumberField
          id={amountField.id}
          label={t('projectDetail.workOrders.billing.modal.amount', 'Amount (excl. PPN)')}
          required
          prefix={currencySymbol(workOrder.currency)}
          value={amountField.value}
          onChange={amountField.onChange}
          onBlur={amountField.onBlur}
          error={amountField.error}
          localeAware
          data-testid="invoice-wo-amount"
          helper={t('projectDetail.workOrders.billing.modal.amountHelp', {
            defaultValue: 'Up to {{remaining}} is still to invoice on this work order.',
            remaining: remainingText,
            interpolation: { escapeValue: false },
          })}
        />
      </FormGrid>
    </EntityFormModal>
  );
};

export default InvoiceWorkOrderModal;
