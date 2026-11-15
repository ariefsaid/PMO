/**
 * #2290: the date the ledger posted a document on, as one muted line under the document's own date (the invoice, bill or receipt date), never under a due date. Odoo posts a document
 * dated inside a locked period on the first open day instead of refusing it; the entered date stays, and this line says where
 * the ledger has it. Renders nothing when the ledger's date is unknown (a PMO-held row) or equal to the entered one.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatDay } from '@/src/lib/format';
import { movedLedgerDate } from '@/src/lib/revenue/ledgerDate';

export const LedgerDateLine: React.FC<{ entered: string | null | undefined; posted: string | null | undefined; className?: string; stacked?: boolean }> = ({ entered, posted, className, stacked }) => {
  const { t } = useTranslation();
  const moved = movedLedgerDate(entered, posted);
  if (!moved) return null;
  if (stacked) {
    // Narrow date cell: label above value; the date itself never breaks across lines.
    return (
      <span data-testid="ledger-date" className={className ?? 'block min-w-0 text-sm font-normal text-muted-foreground'}>
        <span data-testid="ledger-date-label" className="block whitespace-nowrap">{t('finance:odooOutcome.ledgerDateLabel', 'Ledger date')}</span>
        <span data-testid="ledger-date-value" className="block whitespace-nowrap">{formatDay(moved.slice(0, 10))}</span>
      </span>
    );
  }
  return (
    <span data-testid="ledger-date" className={className ?? 'block min-w-0 text-sm font-normal text-muted-foreground'}>
      {t('finance:odooOutcome.ledgerDate', 'Ledger date {{date}} (entered {{entered}})', { date: formatDay(moved.slice(0, 10)), entered: formatDay((entered ?? '').slice(0, 10)) })}
    </span>
  );
};
