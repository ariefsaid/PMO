import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ListState } from '@/src/components/ui';
import { useFinanceHubFigures } from '@/src/hooks/useFinanceHubFigures';
import { usePermission } from '@/src/auth/usePermission';
import { formatCurrency } from '@/src/lib/format';

/** Earned revenue less invoiced revenue from the existing Finance figures read. */
export const DoneNotYetBilledCard: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const figures = useFinanceHubFigures(may('view', 'salesInvoice'));
  if (!may('view', 'salesInvoice')) return null;

  return (
    <Card data-testid="dashboard-done-not-yet-billed">
      <CardHead>{t('dashboard.finance.doneNotYetBilled', 'Done, not yet billed')}</CardHead>
      <CardPad>
        {figures.isPending ? <ListState variant="loading" rows={1} /> : figures.isError || !figures.data ? (
          <ListState variant="error" title={t('dashboard.finance.doneNotYetBilledError', "Couldn't load earned amounts")} onRetry={() => void figures.refetch()} />
        ) : figures.data.pack.unbilled.length === 0 ? (
          <p className="text-control text-muted-foreground">{t('dashboard.finance.doneNotYetBilledEmpty', 'No earned amounts to show')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border" data-testid="done-not-yet-billed-totals">
            {figures.data.pack.unbilled.map(({ currency, cents }) => (
              <li key={currency} className="flex items-baseline justify-between gap-3 py-2">
                <span className="font-semibold tabular">{formatCurrency(cents / 100, currency)}</span>
                <span className="text-control text-muted-foreground">{currency}</span>
              </li>
            ))}
          </ul>
        )}
        <Link to="/finance/reports" className="mt-2 inline-flex min-h-11 items-center font-medium text-primary-text hover:underline">
          {t('dashboard.finance.openReports', 'Open reports')}
        </Link>
      </CardPad>
    </Card>
  );
};
