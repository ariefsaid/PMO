import React from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError, SelectField } from '@/src/components/ui';
import type { ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';
import { formatMoneyInputValue } from '@/src/lib/format';
import { vendorInvoiceIdentityAccessibleLabel, type VendorInvoiceContext } from '@/src/components/procurement/vendorInvoiceIdentityLabels';
import { VendorInvoiceIdentity } from '@/src/components/procurement/VendorInvoiceIdentity';

export interface PaymentCaptureFieldsProps {
  formId: string;
  invoices: ProcurementInvoiceRow[];
  invoiceIdentityContext?: VendorInvoiceContext;
  /** DD-VPAY-3: on a flipped org the payment must name its bill. */
  paymentBillRequired: boolean;
  odooProcurement: boolean;
  invoiceId: string;
  billError: string | undefined;
  onSelect: (invoiceId: string) => void;
  /** DD-VPAY-10: the picked bill's ERP outstanding, formatted, as the default amount. */
  onOutstandingAmount: (formatted: string) => void;
}

/** The payment form's bill selection: which supplier invoice the payment closes, and its outstanding amount. */
export const PaymentCaptureFields: React.FC<PaymentCaptureFieldsProps> = ({
  formId, invoices, invoiceIdentityContext, paymentBillRequired, odooProcurement, invoiceId, billError, onSelect, onOutstandingAmount,
}) => {
  const { t } = useTranslation();
  return (
      <div className="flex flex-col gap-1">
        <SelectField
          id={`${formId}-invoice`}
          label={<>{t('procurementDetail.paymentLinksToInvoice', 'Links to invoice')} {!paymentBillRequired && <span className="font-normal">({t('procurementDetail.vendorInvoice.optional', 'optional')})</span>}</>}
          value={invoiceId}
          onChange={(next) => {
            onSelect(next);
            // DD-VPAY-10: the bill's mirrored ERP outstanding is the default amount — what we
            // actually owe, net of withholding (AC-VWH-005's figures: gross 1,110,000 → 1,090,000).
            // The user may pay less (partial); the server gate (DD-VPAY-7) remains the authority.
            if (paymentBillRequired) {
              const selected = invoices.find((inv) => inv.id === next);
              const raw = selected?.erp_outstanding_amount;
              const outstanding = typeof raw === 'string' ? Number(raw) : raw;
              if (typeof outstanding === 'number' && Number.isFinite(outstanding)) {
                onOutstandingAmount(formatMoneyInputValue(outstanding));
              }
            }
          }}
          data-testid="payment-invoice-select"
          placeholder={t('procurementDetail.noInvoiceSelected', '— none —')}
          options={invoices.map((inv) => {
            const label = vendorInvoiceIdentityAccessibleLabel({
              t,
              referenceNumber: inv.reference_number,
              viNumber: inv.vi_number,
              invoiceDate: inv.invoice_date,
              context: invoiceIdentityContext ?? { state: 'unavailable' },
            });
            // FR-OPP-044: a bill whose total Odoo computed differently is not payable until a person has checked it in Odoo.
            const needsAttention = odooProcurement && Boolean((inv as { erp_attention?: string | null }).erp_attention);
            return needsAttention
              ? { value: inv.id, label: `${label} — ${t('procurement:odoo.billCheckFirst', 'check in Odoo first')}`, disabled: true }
              : { value: inv.id, label };
          })}
        />
        {invoiceId && (() => {
          const selected = invoices.find((inv) => inv.id === invoiceId);
          return selected ? (
            <div data-testid="payment-selected-invoice-identity" className="mt-1 min-w-0 rounded-md border border-border/60 bg-muted/30 p-2">
              <VendorInvoiceIdentity
                referenceNumber={selected.reference_number}
                viNumber={selected.vi_number}
                invoiceDate={selected.invoice_date}
                context={invoiceIdentityContext ?? { state: 'unavailable' }}
              />
            </div>
          ) : null;
        })()}
        <FieldError id={`${formId}-invoice-error`}>{billError}</FieldError>
      </div>
  );
};
