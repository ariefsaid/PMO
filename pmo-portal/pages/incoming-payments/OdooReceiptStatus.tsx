import React from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/src/components/ui';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
import { incomingPaymentStatusVariant } from '@/src/lib/status/statusVariants';

const WAITING_STATES = new Set(['pending', 'committing', 'committed', 'quarantined', 'held', 'confirmed']);

type OdooReceiptDisplayStatus = 'paid' | 'awaiting' | 'attention';

function odooReceiptDisplayStatus(
  receipt: Pick<IncomingPaymentRow, 'status' | 'cancelled_at' | 'erp_cancelled_at' | 'push_command_state'>,
): OdooReceiptDisplayStatus | null {
  if (receipt.cancelled_at || receipt.erp_cancelled_at || receipt.push_command_state === 'failed') return 'attention';
  if (receipt.status === 'Paid') return 'paid';
  if (WAITING_STATES.has(receipt.push_command_state ?? '')) return 'awaiting';
  return null;
}

export const OdooReceiptStatus: React.FC<{
  receipt: IncomingPaymentRow;
  fallback?: React.ReactNode;
}> = ({ receipt, fallback = null }) => {
  const { t } = useTranslation();
  const status = odooReceiptDisplayStatus(receipt);
  if (!status) return <>{fallback}</>;
  if (status === 'paid') {
    return <StatusPill variant={incomingPaymentStatusVariant('Paid')}>{t('finance:receipts.statusPaidOdoo', 'Paid')}</StatusPill>;
  }
  if (status === 'awaiting') {
    return <StatusPill variant="progress">{t('finance:receipts.statusAwaitingOdoo', 'Receipt sent, awaiting Odoo')}</StatusPill>;
  }
  return <StatusPill variant="warn">{t('finance:odooOutcome.needs-attention', 'Needs attention')}</StatusPill>;
};
