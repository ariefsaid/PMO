import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ListState, TaxBasisLabel } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useUnbilledWorkOrders } from '@/src/hooks/useWorkOrderBilling';
import { formatCurrencyCents } from '@/src/lib/format';

/** Straight to the work order on its project's Work orders tab — highlighted, scrolled to and focused there. */
const workOrderHref = (projectId: string, workOrderId: string) =>
  `/projects/${projectId}/work-orders?wo=${encodeURIComponent(workOrderId)}`;
const LINK = 'min-w-0 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring';

/**
 * What is still to invoice on the client's POs (OD-BILL-1, #786 AC-UNB-005). Totals per currency (never converted,
 * DD-MMP-5) are computed server-side by get_unbilled_work_orders, so they are not bounded by max_rows. Work orders that
 * cannot be totalled are counted apart, never added as zero.
 */
const StillToInvoiceBody: React.FC = () => {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useUnbilledWorkOrders();

  return (
    <Card data-testid="dashboard-still-to-invoice">
      <CardHead>{t('dashboard.stillToInvoice.title', 'Still to invoice on work orders')}</CardHead>
      <CardPad>
        {isPending ? (
          <ListState variant="loading" rows={3} testId="still-to-invoice-loading" />
        ) : isError || !data ? (
          <ListState
            variant="error"
            title={t('dashboard.stillToInvoice.error', "Couldn't load what is still to invoice")}
            onRetry={() => refetch()}
          />
        ) : data.totals.length === 0 && data.incompleteCount === 0 ? (
          <ListState variant="empty" icon="doc" title={t('dashboard.stillToInvoice.empty', 'Nothing left to invoice on issued work orders')} />
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-1" data-testid="still-to-invoice-totals">
              {data.totals.map((total) => (
                <li key={total.currency} className="text-[15px] font-bold tabular">
                  {formatCurrencyCents(total.remaining, total.currency)}{' '}
                  {/* Every figure here is normalised excl. tax (DD-BWO-3) — the shared basis label (OD-TAX-1). */}
                  <TaxBasisLabel treatment="exclusive" showDetails={false} testId="still-to-invoice-basis" />
                  <span className="text-[11px] font-normal text-muted-foreground">
                    {' · '}
                    {t('dashboard.stillToInvoice.count', { defaultValue: 'Work orders: {{n}}', n: total.count })}
                  </span>
                </li>
              ))}
            </ul>
            {data.incompleteCount > 0 && (
              <div data-testid="still-to-invoice-incomplete" className="text-[12px] text-muted-foreground">
                <p>
                  {t('dashboard.stillToInvoice.incomplete', {
                    defaultValue: 'Work orders not totalled (an invoice on them has no amount or is in another currency): {{n}}',
                    n: data.incompleteCount,
                  })}
                </p>
                {/* Each one links to where it can be fixed: the cell there names the invoice and the cause. */}
                {data.incomplete.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {data.incomplete.map((wo) => (
                      <li key={wo.workOrderId}>
                        <Link to={workOrderHref(wo.projectId, wo.workOrderId)} className={LINK}>
                          <span className="font-medium text-foreground">{wo.woNumber ?? wo.title}</span>
                          {wo.woNumber && <span> · {wo.title}</span>}
                          <span> · {wo.projectName}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {data.incompleteCount > data.incomplete.length && data.incomplete.length > 0 && (
                  <p className="mt-0.5">
                    {t('dashboard.stillToInvoice.incompleteMore', {
                      defaultValue: 'and {{n}} more',
                      n: data.incompleteCount - data.incomplete.length,
                    })}
                  </p>
                )}
              </div>
            )}
            <ul className="flex flex-col divide-y divide-border" data-testid="still-to-invoice-rows">
              {data.rows.map((row) => (
                <li key={row.workOrderId} className="flex items-baseline justify-between gap-3 py-2">
                  <Link to={workOrderHref(row.projectId, row.workOrderId)} className={LINK}>
                    <span className="block truncate font-medium" title={row.woNumber ?? row.title}>{row.woNumber ?? row.title}</span>
                    {row.woNumber && <span className="block truncate text-[12px]" title={row.title}>{row.title}</span>}
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {row.projectName}
                      {row.clientPoNumber
                        ? ` · ${t('dashboard.stillToInvoice.clientPo', { defaultValue: 'Client PO {{po}}', po: row.clientPoNumber, interpolation: { escapeValue: false } })}`
                        : ''}
                      {row.daysSinceClosed !== null
                        ? ` · ${t('dashboard.stillToInvoice.daysSinceClosed', { defaultValue: 'Days since closed: {{days}}', days: row.daysSinceClosed })}`
                        : ''}
                    </span>
                  </Link>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="text-[13px] font-semibold tabular">
                      {formatCurrencyCents(row.remaining, row.currency)}
                    </span>
                    <TaxBasisLabel treatment="exclusive" showDetails={false} testId="still-to-invoice-row-basis" />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardPad>
    </Card>
  );
};

/** Rendered only for the revenue read set (salesInvoice.view); the body (and its query) never mounts otherwise. */
export const StillToInvoiceCard: React.FC = () => {
  const may = usePermission();
  return may('view', 'salesInvoice') ? <StillToInvoiceBody /> : null;
};
