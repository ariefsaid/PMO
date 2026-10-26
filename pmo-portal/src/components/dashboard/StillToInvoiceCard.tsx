import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, TaxBasisLabel } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useUnbilledWorkOrders } from '@/src/hooks/useWorkOrderBilling';
import { formatNumberExact } from '@/src/lib/format';
import { moneyFigure } from '@/src/lib/dashboardMoney';

/** Straight to the work order on its project's Work orders tab — highlighted, scrolled to and focused there. */
const workOrderHref = (projectId: string, workOrderId: string) =>
  `/projects/${projectId}/work-orders?wo=${encodeURIComponent(workOrderId)}`;
const LINK = 'min-w-0 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring';

/**
 * What is still to invoice on the client's POs (OD-BILL-1, #786 AC-UNB-005). Totals per currency (never converted,
 * DD-MMP-5) are computed server-side by get_unbilled_work_orders, so they are not bounded by max_rows. Work orders that
 * cannot be totalled are counted apart, never added as zero.
 */
const StillToInvoiceBody: React.FC<{ excludeWorkOrderId?: string }> = ({ excludeWorkOrderId }) => {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useUnbilledWorkOrders();
  const isClear = !isPending && !isError && data !== undefined
    && data.totals.length === 0 && data.incompleteCount === 0;
  const title = t('dashboard.stillToInvoice.title', 'Still to invoice on work orders');

  if (isClear) {
    return (
      <section aria-labelledby="still-to-invoice-title" data-testid="dashboard-still-to-invoice" className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="still-to-invoice-title" className="text-xl font-bold">{title}</h2>
        <p role="status" data-testid="still-to-invoice-clear" className="text-sm text-muted-foreground">
          {t('dashboard.stillToInvoice.empty', 'Nothing left to invoice on issued work orders')}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="still-to-invoice-title" data-testid="dashboard-still-to-invoice">
      <h2 id="still-to-invoice-title" className="text-xl font-bold">{title}</h2>
      <div className="mt-4">
        {isPending ? (
          <ListState variant="loading" rows={3} testId="still-to-invoice-loading" />
        ) : isError || !data ? (
          <ListState
            variant="error"
            title={t('dashboard.stillToInvoice.error', "Couldn't load what is still to invoice")}
            onRetry={() => refetch()}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-4" data-testid="still-to-invoice-totals">
              {data.totals.map((total) => {
                const compact = moneyFigure(total.remaining, total.currency, t('dashboard.stillToInvoice.error', "Couldn't load what is still to invoice"), { code: true });
                const groupFigure = compact.exactValue ? compact.value : `${total.currency} ${formatNumberExact(total.remaining)}`;
                const groupRows = data.rows.filter((row) => row.currency === total.currency && row.workOrderId !== excludeWorkOrderId);
                return <section key={total.currency} aria-label={`${total.currency} ${title}`}>
                  <h3 className="text-xl font-bold tabular">
                    {groupFigure} · <TaxBasisLabel treatment="exclusive" showDetails={false} testId={`still-to-invoice-basis-${total.currency.toLowerCase()}`} />
                  </h3>
                  {compact.exactValue ? (
                    <p className="text-sm text-muted-foreground">
                      {t('dashboard:finance.unbilledExactRemaining', 'Exact remaining: {{amount}} · {{count}} work orders', { amount: formatNumberExact(total.remaining), count: total.count })}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('dashboard:finance.unbilledCount', '{{count}} work orders', { count: total.count })}</p>
                  )}
                  {groupRows.length > 0 && <ul className="mt-2 flex flex-col divide-y divide-border" data-testid="still-to-invoice-rows">
                    {groupRows.map((row) => (
                      <li key={row.workOrderId} className="grid min-w-0 grid-cols-1 gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
                        <Link to={workOrderHref(row.projectId, row.workOrderId)} className={LINK}>
                  <span className="block break-words">{row.woNumber ?? row.title}</span>
                          {row.woNumber && <span className="block break-words text-sm">{row.title}</span>}
                          <span className="block break-words text-sm text-muted-foreground">
                            {row.projectName}
                            {row.clientPoNumber
                              ? ` · ${t('dashboard.stillToInvoice.clientPo', { defaultValue: 'Client PO {{po}}', po: row.clientPoNumber, interpolation: { escapeValue: false } })}`
                              : ''}
                            {row.daysSinceClosed !== null
                              ? ` · ${t('dashboard.stillToInvoice.daysSinceClosed', { defaultValue: 'Days since closed: {{days}}', days: row.daysSinceClosed })}`
                              : ''}
                          </span>
                        </Link>
                        <span className="text-sm font-semibold tabular text-foreground sm:text-right">{formatNumberExact(row.remaining)}</span>
                      </li>
                    ))}
                  </ul>}
                </section>;
              })}
            </div>
            {data.incompleteCount > 0 && (
              <div data-testid="still-to-invoice-incomplete" className="text-sm text-muted-foreground">
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
                          <span className="text-foreground">{wo.woNumber ?? wo.title}</span>
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
          </div>
        )}
      </div>
    </section>
  );
};

/** Rendered only for the revenue read set (salesInvoice.view); the body (and its query) never mounts otherwise. */
export const StillToInvoiceCard: React.FC<{ excludeWorkOrderId?: string }> = ({ excludeWorkOrderId }) => {
  const may = usePermission();
  return may('view', 'salesInvoice') ? <StillToInvoiceBody excludeWorkOrderId={excludeWorkOrderId} /> : null;
};
