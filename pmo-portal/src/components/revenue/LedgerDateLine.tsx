/**
 * #2290: the date the ledger posted a document on, as one muted line under the date the person entered. Odoo posts a document
 * dated inside a locked period on the first open day instead of refusing it; the entered date stays, and this line says where
 * the ledger has it. Renders nothing when the ledger's date is unknown (a PMO-held row) or equal to the entered one.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateOnly } from '@/src/lib/format';
import { movedLedgerDate } from '@/src/lib/revenue/ledgerDate';

export const LedgerDateLine: React.FC<{ entered: string | null | undefined; posted: string | null | undefined; className?: string }> = ({ entered, posted, className }) => {
  const { t } = useTranslation();
  const moved = movedLedgerDate(entered, posted);
  if (!moved) return null;
  return (
    <span data-testid="ledger-date" className={className ?? 'block text-sm text-muted-foreground'}>
      {t('finance:odooOutcome.ledgerDate', 'Ledger: {{date}}', { date: formatDateOnly(moved) })}
    </span>
  );
};
