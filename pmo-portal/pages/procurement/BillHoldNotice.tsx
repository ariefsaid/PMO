import React from 'react';
import { useTranslation } from 'react-i18next';
import { useThreeWayMatchOn } from '@/src/hooks/useThreeWayMatch';
import { useProcurementGates } from '@/src/hooks/useProcurementGates';

/**
 * What can hold a supplier bill, said on the bill form before it is saved: the organisation's receipt-before-bill rule, and
 * the three-way match that holds payment until the bill matches its order and receipts. Each names who can release it.
 * Nothing here decides anything: the database refuses or holds, this only tells the person first (UX).
 */
export const BillHoldNotice: React.FC<{ hasReceipt: boolean }> = ({ hasReceipt }) => {
  const { t } = useTranslation('procurement');
  const gates = useProcurementGates().data;
  const matchOn = useThreeWayMatchOn().on;
  const ruleHolds = Boolean(gates?.receipt_before_invoice) && !hasReceipt;
  if (!ruleHolds && !matchOn) return null;
  return (
    <div className="space-y-2" data-testid="bill-hold-notice">
      {ruleHolds && (
        <p role="status" className="rounded-md border border-border bg-secondary p-2 text-control" data-testid="bill-hold-rule">
          <b>{t('billHold.rule.title', 'This bill is held by a purchase rule.')}</b>{' '}
          {t('billHold.rule.body', 'Your organisation requires a receipt before a supplier bill. Record the receipt first. An Admin can change the rule in Administration, Accounting, Purchase rules.')}
        </p>
      )}
      {matchOn && (
        <p role="status" className="rounded-md border border-border bg-secondary p-2 text-control" data-testid="bill-hold-match">
          <b>{t('billHold.match.title', 'Payment is held until this bill matches.')}</b>{' '}
          {t('billHold.match.body', 'The bill is compared with its order and receipts. If it does not match, payment stays held until the receipt is recorded or an Admin or Finance user, other than the person who recorded the bill, approves an exception.')}
        </p>
      )}
    </div>
  );
};
