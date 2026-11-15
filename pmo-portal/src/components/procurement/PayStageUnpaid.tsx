import React from 'react';
import { useTranslation } from 'react-i18next';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { formatCurrency, formatMoneyLines } from '@/src/lib/format';
import { calendarAgeDays, supplierInvoiceDate } from '@/src/lib/finance/financePosition';
import { shownAmount, totalsByCurrency, type ProcurementListRole } from '@/src/lib/procurement/listModel';

interface PayStageUnpaidProps {
  /** The Pay-stage rows in view, with their linked accounting documents attached. */
  rows: readonly ProcurementWithRefs[];
  role: ProcurementListRole;
}

/**
 * What is still owed to suppliers, said inside the Pay stage chip (#2134: the one summary strip). Supplier
 * invoices use their unpaid balance; an Engineer never sees supplier-invoice money, so it renders nothing.
 * A balance with nothing recorded says so in words; a partly recorded one shows the known part and the count.
 *
 * Memoised on (rows, role): the list re-renders on every keystroke and query settle.
 */
export const PayStageUnpaid = React.memo(function PayStageUnpaid({ rows, role }: PayStageUnpaidProps) {
  const { t } = useTranslation('procurementList');
  const engineer = role === 'Engineer';
  const home = useOrgCurrency();
  const organizationDay = useFxOrgDay(!engineer);
  if (engineer) return null;
  const unpaidRows = rows.filter((row) => row.status === 'Vendor Invoiced');
  if (unpaidRows.length === 0) return null;

  const totals = totalsByCurrency(unpaidRows, role, 'pay');
  const known = totals.flatMap((total) => {
    const amount = shownAmount(total);
    return amount === null ? [] : [{ currency: total.currency, amount }];
  });
  const unrecorded = totals.reduce((sum, total) => sum + (total.unknown ? (total.unknownCount ?? 0) : 0), 0);
  const oldest = unpaidRows.map((row) => supplierInvoiceDate(row)).filter((value): value is string => Boolean(value)).sort()[0];
  const age = calendarAgeDays(oldest, organizationDay.day);
  const basis = t('money.pay', 'Supplier invoices use the unpaid balance; paid procurements contribute zero. Kept in each procurement currency.');
  const exact = known.map((total) => formatCurrency(total.amount, total.currency)).join(' + ');
  const ageText = age === null ? null : t('kpi.invoiceAge', { count: age, defaultValue_one: 'Invoice age {{count}} day', defaultValue_other: 'Invoice age {{count}} days' });
  const shortAge = age === null ? null : t('kpi.oldestShort', { count: age, defaultValue_one: 'oldest {{count}} day', defaultValue_other: 'oldest {{count}} days' });
  // The tab labels' format, so this figure reads the same as the Needs-you tab that holds these invoices.
  const short = known.length === 0 ? '' : formatMoneyLines(known, home, 'tile').lines.join(' ');

  return (
    <span
      data-testid="summary-total-unpaid"
      title={[exact && `${t('kpi.unpaid', 'Supplier invoices unpaid')}: ${exact}`, ageText, basis].filter(Boolean).join('. ')}
      className="tabular"
    >
      {known.length === 0
        ? t('kpi.unpaidNotRecorded', 'unpaid not recorded')
        : t('kpi.stageUnpaid', { amount: short, defaultValue: '{{amount}} unpaid' })}
      {unrecorded > 0 && known.length > 0 && (
        <span className="text-muted-foreground"> · {t('kpi.partial', { count: unrecorded, defaultValue: '{{count}} not recorded' })}</span>
      )}
      {shortAge && (
        // Seen short in the chip; assistive tech hears the full phrase once, below.
        <span aria-hidden="true" className="text-muted-foreground"> · <span>{shortAge}</span></span>
      )}
      {ageText && <span className="sr-only"> · {ageText}</span>}
    </span>
  );
});
