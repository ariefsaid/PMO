import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import type { ProcurementPaymentCeiling } from '@/src/lib/db/procurementPaymentCeiling';

export interface PaymentCeilingNoticeProps {
  /** The server ceiling (read only while the request awaits payment). */
  ceiling: ProcurementPaymentCeiling | null | undefined;
  currency: string;
  /** UX gate only (`can()` + not the requester); the server decides eligibility. */
  canApprove: boolean;
  eligibilityReason?: string | null;
  busy?: boolean;
  /** Approve the billed amount. Owns its own error reporting. */
  onApprove: (amount: number) => Promise<void> | void;
}

/**
 * Shown where payment is blocked because the billed amount (net of tax) exceeds the approved amount:
 * one plain sentence, and for an eligible approver one action that approves the billed amount.
 */
export const PaymentCeilingNotice: React.FC<PaymentCeilingNoticeProps> = ({
  ceiling,
  currency,
  canApprove,
  eligibilityReason,
  busy = false,
  onApprove,
}) => {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  if (!ceiling || ceiling.ok || ceiling.billedNet == null || ceiling.approvedAmount == null) return null;
  const { billedNet, approvedAmount } = ceiling;
  if (billedNet <= approvedAmount) return null;

  const reason = eligibilityReason === 'checking'
    ? t('procurement:ceiling.checking', 'Checking approval eligibility…')
    : eligibilityReason === 'bill_recorder'
    ? t('procurement:ceiling.billRecorder', 'The person who recorded the bill cannot approve the higher amount.')
    : eligibilityReason === 'quote_selector'
      ? t('procurement:ceiling.quoteSelector', 'The person who selected the quote cannot approve the higher amount.')
      : eligibilityReason === 'requester'
        ? t('procurement:ceiling.requester', 'The requester cannot approve the higher amount.')
        : eligibilityReason === 'routing'
          ? t('procurement:ceiling.routing', 'A designated approver must approve the higher amount.')
          : eligibilityReason === 'unavailable'
            ? t('procurement:ceiling.unavailable', 'Approval eligibility is unavailable. Refresh this page and try again.')
            : null;

  const confirm = async () => {
    if (!canApprove) return;
    try {
      await onApprove(billedNet);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p data-testid="payment-ceiling-note" className="text-[13px] text-muted-foreground">
        {t(
          'procurement:ceiling.exceeds',
          'Billed amount exceeds the approved amount by {{amount}}. An approver must approve the higher amount.',
          { amount: formatCurrency(billedNet - approvedAmount, currency) },
        )}
      </p>
      {reason && <p className="text-[13px] text-muted-foreground">{reason}</p>}
      {canApprove && (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
          {t('procurement:ceiling.approveHigher', 'Approve higher amount')}
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        title={t('procurement:ceiling.approveHigher', 'Approve higher amount')}
        description={t(
          'procurement:ceiling.confirmBody',
          'The approved amount becomes {{billed}} (now {{approved}}). You will not be able to pay this procurement yourself.',
          { billed: formatCurrency(billedNet, currency), approved: formatCurrency(approvedAmount, currency) },
        )}
        confirmLabel={t('procurement:ceiling.confirm', 'Approve')}
        loading={busy}
        confirmDisabled={!canApprove}
        onConfirm={() => void confirm()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
};
