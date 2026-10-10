import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Combobox, EntityFormModal, FormGrid, NumberField, TextField, useEntityForm, type SubmitError } from '@/src/components/ui';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
import { useRevenueRouteReady } from '@/src/hooks/useOwnershipCacheSync';
import { useRevenueMutations } from '@/src/hooks/useRevenue';
import { useCommandIntent } from '@/src/hooks/useCommandIntent';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { nativeRevenueHeadlines } from '@/src/lib/revenue/nativeRevenueErrors';
import { currencySymbol, formatCurrencyCents, formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import { invoiceAmountProblem } from '@/src/lib/workOrderBilling';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';

/**
 * "Invoice this work order" (OD-BILL-1, FR-BWO-008; #913 also where PMO owns revenue). One Draft for the project's
 * client, one line, linked to the work order; the PO reference falls back to the work order's client PO. ONE dialog:
 * the revenue mode branches only the copy and the refusal wording — the create call is the same, and the repository
 * routes it (dispatch → ERPNext, or migration 0275's `create_native_sales_invoice` RPC).
 * ⚑ The amount check here is a courtesy. The database refuses past-the-value invoices before any write (0262 — it
 *   fences the native RPC too), counting commands still in flight that this dialog cannot see; its refusal is shown
 *   verbatim, worded for where the write would have landed.
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
  onCreated: (invoice: { id: string; si_number: string | null }) => void;
}

interface Values {
  itemCode: string;
  description: string;
  amount: string;
}

/** The invoice line's description: the work order's own number and title (no filler copy — it lands on the client's
 *  invoice, whatever the user's language), within the 140-character line limit (ERPNext and the native RPC alike). */
function workOrderInvoiceDescription(wo: Pick<WorkOrderRow, 'wo_number' | 'title'>): string {
  return (wo.wo_number ? `${wo.wo_number} — ${wo.title}` : wo.title).slice(0, 140);
}

const InvoiceWorkOrderModal: React.FC<InvoiceWorkOrderModalProps> = ({
  workOrder, projectId, clientId, remaining, onClose, onCreated,
}) => {
  const { t } = useTranslation();
  // #913: the query-derived mode must agree with the synced repository route. Stay fail-closed if the cache
  // is not ready or changes while this dialog is open.
  const revenueMode = useRevenueMode();
  const modeReady = useRevenueRouteReady(revenueMode);
  const native = revenueMode === 'native';
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
      if (!native && !v.itemCode.trim()) {
        errors.itemCode = t('projectDetail.workOrders.billing.modal.errors.itemRequired', 'Choose the ERP item.');
      }
      // FR-NAR-002: a PMO line needs an item code OR a description — the description leads with the work order number,
      // so a user who clears it and types no item is refused before the round trip.
      if (native && !v.itemCode.trim() && !v.description.trim()) {
        errors.description = t('projectDetail.workOrders.billing.modal.errors.lineRequired', 'Enter an item code or a description.');
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
    // A PMO line needs no item (FR-NAR-002): the work-order description completes the form.
    requiredFields: native ? ['amount'] : ['itemCode', 'amount'],
  });

  const itemField = form.fieldProps('itemCode');
  const descriptionField = form.fieldProps('description');
  const amountField = form.fieldProps('amount');

  const errorSummary = (() => {
    const items: { fieldId: string; message: string }[] = [];
    if (form.errors.itemCode) items.push({ fieldId: itemField.id, message: form.errors.itemCode });
    if (form.errors.amount) items.push({ fieldId: amountField.id, message: form.errors.amount });
    if (form.errors.description) items.push({ fieldId: descriptionField.id, message: form.errors.description });
    return items.length > 0 ? items : undefined;
  })();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // The parent normally withholds this dialog until the cache-backed mode is known. Keep the
    // modal fail-closed too: a cache clear during an open dialog must not let an ERP-shaped form
    // submit through the repository's native fail-closed route.
    if (!modeReady) return;
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
        // The ERP names the invoice; a PMO Draft has no number yet (DD-NAR-9 mints it on approval).
        onCreated(res);
      } catch (err) {
        // The dialog is the one place the failure is shown (no second toast); classifying here records the single
        // save_failed event (ADR-0067). On the native path the RPC's refusals carry their own detail codes (0275),
        // worded by nativeRevenueHeadlines; the ERP path keeps BW001's work-order ceiling headline.
        const { headline, detail, classification } = classifyMutationError(
          err,
          {
            ...(native ? nativeRevenueHeadlines(t) : {}),
            BW001: t('projectDetail.workOrders.billing.modal.errorHeadline', 'That would invoice past the work order'),
          },
          native ? { module: 'sales', operation: 'create' } : { module: 'projects', operation: 'create' },
        );
        // BW001 is the database's refusal before any write (0262 fences the native RPC too). Its message is
        // diagnostics (English, unformatted figures): say it in the user's language, worded for where this dialog
        // was pointed, with the amount it was opened with.
        const errCode = (err as { code?: unknown } | null)?.code;
        const isRefusal = errCode === 'BW001';
        setSaveError({
          // This dialog creates; the shared fallback headline ("Update failed") says the wrong thing here.
          headline: classification === 'unclassified'
            ? t('projectDetail.workOrders.billing.modal.createFailed', "Couldn't create the draft invoice")
            : headline,
          detail: isRefusal
            ? native
              ? t('projectDetail.workOrders.billing.modal.errors.refusedNative', {
                  defaultValue:
                    'Nothing was saved. This work order had {{remaining}} still to invoice when you opened this dialog; another invoice or a change to the work order may have used it since. Close and reopen it to see what is left.',
                  remaining: remainingText,
                  interpolation: { escapeValue: false },
                })
              : t('projectDetail.workOrders.billing.modal.errors.refused', {
                  defaultValue:
                    'Nothing was written to ERPNext. This work order had {{remaining}} still to invoice when you opened this dialog; another invoice or a change to the work order may have used it since. Close and reopen it to see what is left.',
                  remaining: remainingText,
                  interpolation: { escapeValue: false },
                })
            : detail,
          // I-2 (DD-TAX-4a): a VAT project with no recorded rate is fixed on the project's page.
          ...(native && errCode === 'vat-rate-missing' ? {
            action: (
              <Link to={`/projects/${projectId}`} className="font-medium text-primary-text underline underline-offset-2">
                {t('financeCopy.recordVatRateOnProject', 'Record the VAT rate on the project')}
              </Link>
            ),
          } : {}),
        });
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={t('projectDetail.workOrders.billing.modal.title', 'Invoice this work order')}
      subtitle={native
        ? t(
            'projectDetail.workOrders.billing.modal.subtitleNative',
            'Creates a draft invoice in PMO for a second Finance/Admin person to approve.',
          )
        : t(
            'projectDetail.workOrders.billing.modal.subtitle',
            "Creates a draft invoice in ERPNext for the project's client. A different Finance or Admin user submits it.",
          )}
      submitLabel={t('projectDetail.workOrders.billing.modal.submit', 'Create draft invoice')}
      cancelLabel={t('projectDetail.workOrders.billing.modal.cancel', 'Cancel')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!modeReady || !form.isComplete}
      errorSummary={errorSummary}
    >
      {/* DD-BWO-8: the work order's client PO goes on the ERP invoice. Shown, read-only, so the user knows what the client
          will see — never an input (it is the work order's, not this invoice's). */}
      <p data-testid="invoice-wo-client-po" className="mb-3 text-[12.5px] text-muted-foreground">
        {t('projectDetail.workOrders.billing.modal.clientPo', 'Client PO on the invoice')}
        <span className="ml-2 font-semibold tabular text-foreground">
          {workOrder.client_po_number || t('projectDetail.workOrders.billing.modal.clientPoNone', 'None on this work order')}
        </span>
      </p>
      <FormGrid>
        {/* #913: a PMO line needs no ERP item (FR-NAR-002) — the work-order description completes it. The ERP picker
            only ever offers itself when ERPNext owns revenue, so it cannot appear in a native org. */}
        {!native && erpItems.connected ? (
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
            required={!native}
          />
        )}
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
        {/* Full width: the line description leads with the work order number, which must stay readable. */}
        <TextField
          id={descriptionField.id}
          fullWidth
          label={t('projectDetail.workOrders.billing.modal.description', 'Description')}
          value={descriptionField.value}
          onChange={descriptionField.onChange}
        />
      </FormGrid>
    </EntityFormModal>
  );
};

export default InvoiceWorkOrderModal;
