import React, { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { DataTable, ListPage, ListState, SelectField, StatusPill, TextField, type Column } from '@/src/components/ui';
import { StockFilters, StockTabs } from '@/src/components/stock/StockTabs';
import { useStockItems, useStockLedger, useStockWarehouses } from '@/src/hooks/useStock';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { formatQuantity, formatStockValue } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { formatDay } from '@/src/lib/format';
import type { StockLedgerRow } from '@/src/lib/db/stockReports';

/**
 * A code has no spaces, and a segment of one has no break opportunity either (F9b ruling 2): a line
 * may break only AFTER a hyphen. So the code renders as its hyphen-ended pieces, each held on one line
 * (whitespace-nowrap) with a break opportunity (`<wbr>`) after each hyphen. Every character stays in
 * the DOM exactly once, so copying the cell gives the original code — no added spaces, no lost hyphen.
 * Below `md` the pieces let the phone card break a long code anywhere again (`break-all` on the caller).
 */
const CodeText: React.FC<{ code: string; className: string; testId?: string }> = ({ code, className, testId }) => {
  const pieces = code.split('-');
  return (
    <span data-testid={testId} className={className}>
      {pieces.map((piece, index) => (
        <React.Fragment key={index}>
          <span className="whitespace-normal md:whitespace-nowrap">{index < pieces.length - 1 ? `${piece}-` : piece}</span>
          {index < pieces.length - 1 && <wbr />}
        </React.Fragment>
      ))}
    </span>
  );
};

/** The ledger's columns. A named builder so the export seam (which reads this list, not the screen) is
 *  asserted without the DOM. */
// eslint-disable-next-line react-refresh/only-export-components -- the column builder is co-located with its page so the export seam is testable; HMR-only lint concern
export function buildLedgerColumns({ t, loc, currency, showCost }: {
  t: TFunction;
  loc: string;
  currency: string;
  showCost: boolean;
}): Column<StockLedgerRow>[] {
  const cols: Column<StockLedgerRow>[] = [
    // F9b ruling 3: ONE date column on screen — the movement date, because From/To bound it and it is
    // the day the stock actually moved. The posting day rides under it (muted, same size as the other
    // second lines) only when it is a different day; a same-day posting is said once, not twice.
    {
      key: 'occurred', header: t('ledger.columns.occurred'),
      cell: (r) => {
        const movedDay = formatDay(r.occurredOn);
        const postedDay = formatDay(r.postedAt);
        return (
          <div>
            <span className="block whitespace-nowrap tabular-nums">{movedDay}</span>
            {postedDay !== movedDay && (
              <span className="block whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                {t('ledger.columns.posted', 'Posted {{day}}', { day: postedDay })}
              </span>
            )}
          </div>
        );
      },
      exportValue: (r) => r.occurredOn,
    },
    // Never on screen (`exportOnly`), still a column of the export: both dates travel to the spreadsheet.
    { key: 'when', header: t('ledger.columns.when'), exportOnly: true, cell: (r) => formatDay(r.postedAt), exportValue: (r) => r.postedAt },
    {
      key: 'doc', header: t('ledger.columns.document'), rowHeader: true,
      // F9c ruling 4: the By column never fits beside Document below 1536, so there it leaves the table
      // (see the actor column) and the same fact becomes a muted third line under the kind — the reader
      // still learns who posted the movement, nothing is dropped.
      cell: (r) => (
        <div className="min-w-0">
          <Link to={`/stock/documents/${r.documentId}`} className="block whitespace-nowrap font-mono text-sm font-semibold hover:underline">{r.documentNumber}</Link>
          <span className="block truncate text-sm text-muted-foreground">{t(`kinds.${r.kind}`, r.kind)}</span>
          {r.actorName && (
            <span data-testid="stock-ledger-actor" className="block truncate text-sm text-muted-foreground 2xl:hidden">{r.actorName}</span>
          )}
        </div>
      ),
      exportValue: (r) => r.documentNumber,
    },
    {
      key: 'item', header: t('ledger.columns.item'),
      // F9b ruling 2: a code wraps only after a hyphen in the table, never inside a segment; the phone
      // card below md still breaks a long code anywhere so it stays inside the card.
      cell: (r) => (
        <div className="min-w-0">
          <CodeText code={r.itemCode} testId="stock-ledger-item-code" className="block break-all font-mono text-sm md:break-normal" />
          <span className="block break-words text-sm text-muted-foreground">{r.itemName}</span>
        </div>
      ),
      exportValue: (r) => r.itemCode,
    },
    { key: 'warehouse', header: t('ledger.columns.warehouse'), cell: (r) => <CodeText code={r.warehouseCode} testId="stock-ledger-warehouse-code" className="block min-w-0 break-all font-mono text-sm md:break-normal" />, exportValue: (r) => r.warehouseCode },
    {
      key: 'project', header: t('ledger.columns.project'), colClassName: 'hidden lg:table-cell',
      cell: (r) => (r.projectName ? (<div className="min-w-0"><span className="block truncate text-sm">{r.projectName}</span><span className="block truncate text-sm text-muted-foreground">{r.boqItemCode ?? ''}</span></div>) : null),
      exportValue: (r) => r.projectName ?? '',
    },
    {
      key: 'delta', header: t('ledger.columns.change'), align: 'num',
      cell: (r) => <span data-testid="stock-ledger-change" className={`inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1 break-words tabular-nums ${r.qtyDelta.startsWith('-') ? 'text-destructive-text' : ''}`}><span className="whitespace-nowrap">{r.qtyDelta.startsWith('-') ? '' : '+'}{formatQuantity(r.qtyDelta, loc)}</span>{' '}<span className="whitespace-nowrap">{r.unitCode}</span></span>,
      exportValue: (r) => r.qtyDelta,
    },
    { key: 'after', header: t('ledger.columns.balance'), align: 'num', cell: (r) => <span className="tabular-nums">{formatQuantity(r.qtyAfter, loc)}</span>, exportValue: (r) => r.qtyAfter },
  ];
  if (showCost) {
    cols.push(
      // C13: a cost-rank role never gets a ledger with no money on it — the trace scrolls sideways rather
      // than dropping the two value columns below a wide breakpoint.
      { key: 'vdelta', header: t('ledger.columns.valueChange'), align: 'num', cell: (r) => <span className="tabular-nums">{formatStockValue(r.valueDelta, currency, loc)}</span>, exportValue: (r) => r.valueDelta ?? '' },
      { key: 'vafter', header: t('ledger.columns.valueBalance'), align: 'num', cell: (r) => <span className="tabular-nums">{formatStockValue(r.valueAfter, currency, loc)}</span>, exportValue: (r) => r.valueAfter ?? '' },
    );
  }
  // F9c ruling 4: By shows on screen only from 2xl (1536px); below that its fact rides under Document.
  cols.push({ key: 'actor', header: t('ledger.columns.by'), colClassName: 'hidden 2xl:table-cell', cell: (r) => <span className="text-sm">{r.actorName ?? ''}</span>, exportValue: (r) => r.actorName ?? '' });
  return cols;
}

/** The stock trace: every posting with who, when, project, work item and the running balance (FR-STK-041). */
const StockLedger: React.FC<{ projectId?: string; embedded?: boolean }> = ({ projectId: fixedProject, embedded }) => {
  const { t } = useTranslation('stock');
  const currency = useOrgCurrency();
  const loc = getNumberLocale();
  const [params, setParams] = useSearchParams();
  const itemId = params.get('item') ?? '';
  const warehouseId = params.get('warehouse') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const projectId = fixedProject ?? (params.get('project') ?? '');
  const documentId = params.get('document') ?? '';
  const set = (k: string, v: string) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });

  const items = useStockItems(true);
  const warehouses = useStockWarehouses(true);
  const ledger = useStockLedger({
    ...(itemId ? { itemId } : {}), ...(warehouseId ? { warehouseId } : {}), ...(projectId ? { projectId } : {}),
    ...(documentId ? { documentId } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}),
  });
  const rows = useMemo(() => (ledger.data?.pages ?? []).flatMap((p) => p.rows), [ledger.data]);
  const total = ledger.data && !ledger.hasNextPage ? rows.length : undefined;
  const showCost = rows.some((r) => r.valueDelta !== undefined);

  const columns: Column<StockLedgerRow>[] = useMemo(
    () => buildLedgerColumns({ t, loc, currency, showCost }),
    [t, loc, currency, showCost],
  );

  // A failed next page keeps the trace already read: that failure is reported under the table, not by
  // replacing the whole trace with a page-level error.
  const state: 'loading' | 'empty' | 'error' | undefined =
    (ledger.isError && !ledger.isFetchNextPageError) || items.isError || warehouses.isError
      ? 'error'
      : ledger.isPending ? 'loading' : rows.length === 0 ? 'empty' : undefined;
  const filtered = Boolean(itemId || warehouseId || from || to || documentId || (!fixedProject && projectId));

  const body = (
    <>
      {state === 'loading' && <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={6} /></div>}
      {state === 'error' && (
        <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')}
          onRetry={() => { void ledger.refetch(); void items.refetch(); void warehouses.refetch(); }} />
      )}
      {state === 'empty' && <ListState variant="empty" icon="folder" title={t(filtered ? 'ledger.states.noMatch' : 'ledger.states.empty')} sub={t(filtered ? 'ledger.states.noMatchSub' : 'ledger.states.emptySub')} />}
      {state === undefined && (
        <>
          <DataTable<StockLedgerRow> rows={rows} columns={columns} rowKey={(r) => String(r.seq)} tableId={embedded ? 'stock-ledger-embedded' : 'stock-ledger'} accessibleName={t('ledger.title')} embedded={embedded}
            total={total}
            hasMore={Boolean(ledger.hasNextPage)}
            isLoadingMore={ledger.isFetchingNextPage}
            onLoadMore={() => void ledger.fetchNextPage()}
            loadMoreLabel={t('ledger.loadMore')} />
          {!ledger.hasNextPage && <p className="mt-3 text-center text-sm text-muted-foreground">{t('ledger.end', { count: total })}</p>}
          {ledger.isFetchNextPageError && (
            /* C1: a failed next page must not leave the trace looking complete. */
            <div className="mt-3">
              <ListState
                variant="error"
                title={t('ledger.loadMoreFailed', "Couldn't load more entries")}
                sub={t('states.errorSub')}
                retryLabel={t('actions.retry')}
                onRetry={() => void ledger.fetchNextPage()}
              />
            </div>
          )}
        </>
      )}
    </>
  );

  if (embedded) return body;
  return (
    <ListPage
      title={t('ledger.title')}
      count={total}
    >
      <StockTabs />
      <StockFilters>
          <SelectField label={t('ledger.filters.item')} hideLabel value={itemId} onChange={(v) => set('item', v)}
            options={(items.data ?? []).map((i) => ({ value: i.id, label: `${i.code} - ${i.name}` }))} placeholder={t('ledger.filters.allItems')} />
          <SelectField label={t('ledger.filters.warehouse')} hideLabel value={warehouseId} onChange={(v) => set('warehouse', v)}
            options={(warehouses.data ?? []).map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` }))} placeholder={t('ledger.filters.allWarehouses')} />
          <TextField label={t('ledger.filters.from')} type="date" value={from} onChange={(v) => set('from', v)} />
          <TextField label={t('ledger.filters.to')} type="date" value={to} onChange={(v) => set('to', v)} />
          {documentId && <StatusPill variant="neutral">{t('ledger.filters.oneDocument')}</StatusPill>}
      </StockFilters>
      {body}
    </ListPage>
  );
};

export default StockLedger;
