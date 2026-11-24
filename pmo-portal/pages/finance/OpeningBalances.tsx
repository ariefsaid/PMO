import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ListState, PageHeader } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { FinanceAccessDenied } from '@/src/components/finance/FinanceAccessDenied';
import { useOpeningBalances } from '@/src/hooks/useOpeningBalances';
import { useSetupWorkflows } from '@/src/hooks/useSetupWorkflows';
import type { OpeningBalance, OpeningStock, OpeningWorkOrder } from '@/src/lib/db/openingBalances';
import { formatCurrency, formatDay, formatNumberExact } from '@/src/lib/format';

/**
 * Opening balances (FR-OBS-001, spec docs/specs/opening-balances-screen.spec.md): what the CLI loaded at go-live, for Finance and
 * Admin to check against the source file. Read-only: loading and reversing stay with `pmo`. Order (docs/ux/screen-rules.md):
 * the reconciliation totals first, then each opening with who loaded it and its lines.
 */
const money = (v: number, currency: string) => formatCurrency(v, currency, { precision: 'minor' });

const TH = 'px-3 py-2 text-left text-control font-medium text-muted-foreground';
const TD = 'px-3 py-2 text-control text-foreground';
const NUM = 'tabular-nums text-right';

/** Totals per currency, so two currencies are never added together. */
function sumBy<T>(rows: T[], currency: (r: T) => string, pick: (r: T) => number): [string, number][] {
  const out = new Map<string, number>();
  for (const r of rows) out.set(currency(r), Math.round(((out.get(currency(r)) ?? 0) + pick(r)) * 100) / 100);
  return [...out.entries()];
}

const Who: React.FC<{ row: OpeningBalance }> = ({ row }) => {
  const { t } = useTranslation('financeHub');
  return (
    <p className="text-control text-muted-foreground">
      {t('openingBalances.loadedLine', { defaultValue: 'Go-live {{asOf}} · loaded {{loadedAt}} by {{who}}', asOf: formatDay(row.asOf), loadedAt: formatDay(row.loadedAt.slice(0, 10)), who: row.loadedBy ?? t('openingBalances.unknownUser', 'a former member') })}
      {row.note ? ` · ${row.note}` : ''}
    </p>
  );
};

const StockCard: React.FC<{ row: OpeningStock }> = ({ row }) => {
  const { t } = useTranslation('financeHub');
  return (
    <Card role="region" aria-labelledby={`ob-${row.id}`}>
      <CardHead id={`ob-${row.id}`}>{row.label}{row.subLabel ? ` · ${row.subLabel}` : ''}</CardHead>
      <CardPad>
        <Who row={row} />
        <table className="mt-2 w-full">
          <thead><tr><th className={TH}>{t('openingBalances.item', 'Item')}</th><th className={`${TH} ${NUM}`}>{t('openingBalances.quantity', 'Quantity')}</th><th className={`${TH} ${NUM}`}>{t('openingBalances.value', 'Value')}</th></tr></thead>
          <tbody>
            {row.lines.map((l) => (
              <tr key={l.itemCode} className="border-t border-border">
                <td className={TD}>{l.itemCode} · {l.itemName}</td>
                <td className={`${TD} ${NUM}`}>{formatNumberExact(l.quantity)}</td>
                <td className={`${TD} ${NUM}`}>{money(l.value, row.currency)}</td>
              </tr>
            ))}
            <tr className="border-t border-border font-medium">
              <td className={TD}>{t('openingBalances.total', 'Total')}</td>
              <td className={`${TD} ${NUM}`}>{formatNumberExact(row.quantity)}</td>
              <td className={`${TD} ${NUM}`}>{money(row.value, row.currency)}</td>
            </tr>
          </tbody>
        </table>
      </CardPad>
    </Card>
  );
};

const WorkOrderCard: React.FC<{ row: OpeningWorkOrder }> = ({ row }) => {
  const { t } = useTranslation('financeHub');
  return (
    <Card role="region" aria-labelledby={`ob-${row.id}`}>
      <CardHead id={`ob-${row.id}`}>{row.label}{row.subLabel ? ` · ${row.subLabel}` : ''}</CardHead>
      <CardPad>
        <Who row={row} />
        <table className="mt-2 w-full">
          <thead><tr>
            <th className={TH}>{t('openingBalances.line', 'Contract line')}</th>
            <th className={`${TH} ${NUM}`}>{t('openingBalances.certified', 'Certified quantity')}</th>
            <th className={`${TH} ${NUM}`}>{t('openingBalances.claimedQuantity', 'Claimed quantity')}</th>
            <th className={`${TH} ${NUM}`}>{t('openingBalances.claimedAmount', 'Claimed value')}</th>
          </tr></thead>
          <tbody>
            {row.lines.map((l) => (
              <tr key={l.itemCode} className="border-t border-border">
                <td className={TD}>{l.itemCode} · {l.description}</td>
                <td className={`${TD} ${NUM}`}>{formatNumberExact(l.certifiedQuantity)}</td>
                <td className={`${TD} ${NUM}`}>{formatNumberExact(l.claimedQuantity)}</td>
                <td className={`${TD} ${NUM}`}>{money(l.claimedAmount, row.currency)}</td>
              </tr>
            ))}
            <tr className="border-t border-border font-medium">
              <td className={TD}>{t('openingBalances.total', 'Total')}</td>
              <td className={`${TD} ${NUM}`} colSpan={2}>{t('openingBalances.certifiedValue', 'Certified value')} {money(row.certifiedValue, row.currency)}</td>
              <td className={`${TD} ${NUM}`}>{money(row.claimedValue, row.currency)}</td>
            </tr>
          </tbody>
        </table>
      </CardPad>
    </Card>
  );
};

const OpeningBalances: React.FC = () => {
  const { t } = useTranslation('financeHub');
  const may = usePermission();
  const allowed = may('view', 'openingBalance');
  const setupWorkflows = useSetupWorkflows();
  const query = useOpeningBalances(allowed && setupWorkflows.enabled && !setupWorkflows.isLoading && !setupWorkflows.isError);

  if (!allowed) return <FinanceAccessDenied />;

  const header = (
    <PageHeader
      title={t('openingBalances.title', 'Opening balances')}
      help={<>
        <p>{t('openingBalances.help.what', 'What was loaded when you went live: where each running work order stood and what each stock location held. Nothing here can be changed on this screen.')}</p>
        <p>{t('openingBalances.help.how', 'Opening balances are loaded and reversed with the pmo command line tool. Check the totals below against your source file.')}</p>
      </>}
      helpSubject={t('openingBalances.title', 'Opening balances')}
    />
  );

  if (setupWorkflows.isLoading) {
    return <div className="min-w-0">{header}<ListState variant="loading" shape="table" rows={2} loadingLabel={t('setupWorkflows.loading', 'Checking setup workflow access')} /></div>;
  }
  if (setupWorkflows.isError) {
    return <div className="min-w-0">{header}<ListState variant="error" title={t('setupWorkflows.error', 'Could not load or save this setting. Try again.')} retryLabel={t('openingBalances.retry', 'Try again')} onRetry={() => void setupWorkflows.refetch()} /></div>;
  }
  if (!setupWorkflows.enabled) {
    return <div className="min-w-0">{header}<p className="text-control text-muted-foreground">{t('openingBalances.setupDisabled', 'Opening balances are turned off for this organisation. Ask an Admin to enable setup workflows.')}</p></div>;
  }

  if (query.isLoading) {
    return <div className="min-w-0">{header}<ListState variant="loading" shape="table" rows={4} loadingLabel={t('openingBalances.loading', 'Loading opening balances')} /></div>;
  }
  if (query.isError || !query.data) {
    return <div className="min-w-0">{header}<ListState variant="error" title={t('openingBalances.error', "Couldn't load opening balances")} retryLabel={t('openingBalances.retry', 'Try again')} onRetry={() => void query.refetch()} /></div>;
  }

  const stock = query.data.filter((r): r is OpeningStock => r.kind === 'stock');
  const orders = query.data.filter((r): r is OpeningWorkOrder => r.kind === 'work_order');
  if (stock.length === 0 && orders.length === 0) {
    return <div className="min-w-0">{header}<ListState variant="empty" title={t('openingBalances.empty', 'No opening balances are loaded')} /></div>;
  }

  return (
    <div className="min-w-0">
      {header}
      <div className="space-y-[var(--space-panel-gap)]">
        <Card role="region" aria-labelledby="ob-totals">
          <CardHead id="ob-totals">{t('openingBalances.totalsTitle', 'Totals to check against your source file')}</CardHead>
          <CardPad>
            <table className="w-full">
              <thead><tr><th className={TH}>{t('openingBalances.kind', 'What')}</th><th className={`${TH} ${NUM}`}>{t('openingBalances.count', 'Loaded')}</th><th className={`${TH} ${NUM}`}>{t('openingBalances.totalValue', 'Value')}</th></tr></thead>
              <tbody>
                {stock.length > 0 && sumBy(stock, (r) => r.currency, (r) => r.value).map(([cur, v]) => (
                  <tr key={`s-${cur}`} className="border-t border-border" data-testid="ob-total-stock">
                    <td className={TD}>{t('openingBalances.stockTotal', 'Stock (value at cost)')}</td>
                    <td className={`${TD} ${NUM}`}>{t('openingBalances.locations', { count: stock.filter((r) => r.currency === cur).length, defaultValue_one: '{{count}} location', defaultValue_other: '{{count}} locations' })}</td>
                    <td className={`${TD} ${NUM}`}>{money(v, cur)}</td>
                  </tr>
                ))}
                {orders.length > 0 && sumBy(orders, (r) => r.currency, (r) => r.certifiedValue).map(([cur, v]) => (
                  <tr key={`c-${cur}`} className="border-t border-border" data-testid="ob-total-certified">
                    <td className={TD}>{t('openingBalances.certifiedTotal', 'Work orders: certified value')}</td>
                    <td className={`${TD} ${NUM}`}>{t('openingBalances.orders', { count: orders.filter((r) => r.currency === cur).length, defaultValue_one: '{{count}} work order', defaultValue_other: '{{count}} work orders' })}</td>
                    <td className={`${TD} ${NUM}`}>{money(v, cur)}</td>
                  </tr>
                ))}
                {orders.length > 0 && sumBy(orders, (r) => r.currency, (r) => r.claimedValue).map(([cur, v]) => (
                  <tr key={`b-${cur}`} className="border-t border-border" data-testid="ob-total-claimed">
                    <td className={TD}>{t('openingBalances.claimedTotal', 'Work orders: already invoiced')}</td>
                    <td className={`${TD} ${NUM}`} />
                    <td className={`${TD} ${NUM}`}>{money(v, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-control text-muted-foreground" data-testid="ob-source-note">
              {t('openingBalances.sourceNote', 'The totals of the source file are not kept with the load. Compare these with your file. Receivables, payables and site cash floats are not loaded by the command line tool, so none are shown.')}
            </p>
          </CardPad>
        </Card>
        {stock.length > 0 && <h2 className="text-group font-semibold text-foreground">{t('openingBalances.stockHeading', 'Stock by location')}</h2>}
        {stock.map((r) => <StockCard key={r.id} row={r} />)}
        {orders.length > 0 && <h2 className="text-group font-semibold text-foreground">{t('openingBalances.ordersHeading', 'Running work orders')}</h2>}
        {orders.map((r) => <WorkOrderCard key={r.id} row={r} />)}
        <p className="text-control text-muted-foreground"><Link to="/finance" className="font-medium text-primary-text underline-offset-4 hover:underline">{t('openingBalances.back', 'Back to Finance')}</Link></p>
      </div>
    </div>
  );
};

export default OpeningBalances;
