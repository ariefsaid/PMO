import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, ListPage, ListState, type Column } from '@/src/components/ui';
import { StockTabs } from '@/src/components/stock/StockTabs';
import { useStockAtRisk } from '@/src/hooks/useStock';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { formatStockValue, sumDecimal } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import type { StockAtRiskRow } from '@/src/lib/db/stockReports';

/** True only for a figure that actually carries value; decimal strings, no negatives in this report. */
const isNonZero = (v: string | undefined) => v !== undefined && /[1-9]/.test(v);

/**
 * #2694: stock value held per location against the cover recorded on it (docs/specs/stock-at-risk.spec.md).
 * The server sends money keys only to a caller who may see stock cost, so the money columns follow the DATA,
 * never the role (the StockOnHand rule). Rows arrive sorted by at-risk figure, so the exposed locations lead.
 */
const StockAtRisk: React.FC = () => {
  const { t } = useTranslation('stock');
  const currency = useOrgCurrency();
  const loc = getNumberLocale();
  const atRisk = useStockAtRisk();

  const rows = atRisk.data ?? [];
  const showCost = rows.some((r) => r.stockValue !== undefined);
  const totalAtRisk = showCost ? sumDecimal(rows.flatMap((r) => (r.atRisk === undefined ? [] : [r.atRisk]))) : null;
  const totalHeld = showCost ? sumDecimal(rows.flatMap((r) => (r.stockValue === undefined ? [] : [r.stockValue]))) : null;
  const exposedCount = rows.filter((r) => isNonZero(r.atRisk)).length;

  const columns: Column<StockAtRiskRow>[] = useMemo(() => {
    const cols: Column<StockAtRiskRow>[] = [
      {
        key: 'location', header: t('atRisk.columns.location'), rowHeader: true, stickyLeft: true,
        cell: (r) => (
          <div className="min-w-0">
            <span className="block truncate record-id font-semibold text-foreground">{r.warehouseCode}</span>
            <span className="block truncate text-sm text-muted-foreground">{r.warehouseName}</span>
          </div>
        ),
        exportValue: (r) => r.warehouseCode,
      },
      { key: 'kind', header: t('atRisk.columns.kind'), cell: (r) => <span className="text-sm">{t(`setup.kinds.${r.warehouseKind}`)}</span>, exportValue: (r) => t(`setup.kinds.${r.warehouseKind}`) },
      { key: 'project', header: t('atRisk.columns.project'), cell: (r) => (r.projectName ? <span className="block truncate text-sm">{r.projectName}</span> : <span className="text-muted-foreground">—</span>), exportValue: (r) => r.projectName ?? '' },
    ];
    if (showCost) {
      cols.push(
        { key: 'stockValue', header: t('atRisk.columns.stockValue'), align: 'num', cell: (r) => <span className="tabular-nums">{formatStockValue(r.stockValue, currency, loc)}</span>, exportValue: (r) => r.stockValue ?? '' },
        {
          key: 'cover', header: t('atRisk.columns.cover'), align: 'num',
          cell: (r) => (r.coverValue == null
            ? <span className="text-muted-foreground">{t('atRisk.notRecorded')}</span>
            : <span className="tabular-nums">{formatStockValue(r.coverValue, currency, loc)}</span>),
          exportValue: (r) => r.coverValue ?? '',
        },
        {
          key: 'atRisk', header: t('atRisk.columns.atRisk'), align: 'num',
          cell: (r) => (isNonZero(r.atRisk)
            ? <span className="tabular-nums font-semibold text-foreground">{formatStockValue(r.atRisk, currency, loc)}</span>
            : <span className="tabular-nums text-muted-foreground">{formatStockValue(r.atRisk, currency, loc) || '—'}</span>),
          exportValue: (r) => r.atRisk ?? '',
        },
      );
    }
    return cols;
  }, [t, loc, currency, showCost]);

  const state: 'loading' | 'empty' | 'error' | undefined =
    atRisk.isError ? 'error' : atRisk.isPending ? 'loading' : rows.length === 0 ? 'empty' : undefined;

  return (
    <ListPage
      title={
        <>
          {t('atRisk.title')}
          {state === undefined && (
            <span className="ml-2.5 align-middle text-control font-semibold tabular-nums text-muted-foreground">
              {rows.length === 1 ? t('atRisk.countOne') : t('atRisk.count', { count: rows.length })}
            </span>
          )}
        </>
      }
    >
      <StockTabs />
      {state === undefined && showCost && (
        <div className="mb-3">
          {/* The exposure figure leads; the held value is its context. */}
          <div className="mb-2 flex flex-wrap gap-x-10 gap-y-3">
            <figure>
              <figcaption className="text-sm font-medium text-muted-foreground">{t('atRisk.summary.atRisk')}</figcaption>
              <div className="text-[30px] font-semibold leading-tight tabular-nums text-foreground">{formatStockValue(totalAtRisk, currency, loc)}</div>
            </figure>
            <figure>
              <figcaption className="text-sm font-medium text-muted-foreground">{t('atRisk.summary.held')}</figcaption>
              <div className="text-[30px] font-semibold leading-tight tabular-nums text-foreground">{formatStockValue(totalHeld, currency, loc)}</div>
            </figure>
          </div>
          <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span>
              <b className="font-semibold text-foreground tabular-nums">{exposedCount}</b>{' '}
              {exposedCount === 1 ? t('atRisk.summary.exposedOne') : t('atRisk.summary.exposed', { count: exposedCount })}
            </span>
          </p>
        </div>
      )}
      {state === 'loading' && <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={4} /></div>}
      {state === 'error' && (
        <ListState
          variant="error"
          title={t('states.errorTitle')}
          sub={t('states.errorSub')}
          retryLabel={t('actions.retry')}
          onRetry={() => { void atRisk.refetch(); }}
        />
      )}
      {state === 'empty' && (
        <ListState variant="empty" icon="folder" title={t('atRisk.states.emptyTitle')} sub={t('atRisk.states.emptySub')} />
      )}
      {state === undefined && (
        <DataTable<StockAtRiskRow>
          rows={rows}
          columns={columns}
          rowKey={(r) => r.warehouseId}
          tableId="stock-at-risk"
          accessibleName={t('atRisk.title')}
          mobileCardTitle={(r) => (
            <div className="min-w-0">
              <span className="block min-h-11 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap record-id font-semibold text-foreground">{r.warehouseCode}</span>
              <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-muted-foreground">{r.warehouseName}</span>
            </div>
          )}
          mobileCardDetails={(r) => (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 text-control">
              <dt className="text-muted-foreground">{t('atRisk.columns.kind')}</dt>
              <dd>{t(`setup.kinds.${r.warehouseKind}`)}</dd>
              <dt className="text-muted-foreground">{t('atRisk.columns.project')}</dt>
              <dd className="min-w-0">{r.projectName ?? <span className="text-muted-foreground">—</span>}</dd>
              {showCost && (
                <>
                  <dt className="text-muted-foreground">{t('atRisk.columns.stockValue')}</dt>
                  <dd className="tabular-nums">{formatStockValue(r.stockValue, currency, loc)}</dd>
                  <dt className="text-muted-foreground">{t('atRisk.columns.cover')}</dt>
                  <dd className="tabular-nums">{r.coverValue == null ? <span className="text-muted-foreground">{t('atRisk.notRecorded')}</span> : formatStockValue(r.coverValue, currency, loc)}</dd>
                  <dt className="text-muted-foreground">{t('atRisk.columns.atRisk')}</dt>
                  <dd className={isNonZero(r.atRisk) ? 'tabular-nums font-semibold' : 'tabular-nums text-muted-foreground'}>{formatStockValue(r.atRisk, currency, loc) || '—'}</dd>
                </>
              )}
            </dl>
          )}
        />
      )}
    </ListPage>
  );
};

export default StockAtRisk;
