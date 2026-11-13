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
  // At cost rank these visible columns total 988px; the By column is hidden below 2xl and its fact
  // stays under Document, so a 1280px table box fits without dropping the value columns.
  const cols: Column<StockLedgerRow>[] = [
    // F9b ruling 3: ONE date column on screen — the movement date, because From/To bound it and it is
    // the day the stock actually moved. The posting day rides under it (muted, same size as the other
    // second lines) only when it is a different day; a same-day posting is said once, not twice.
    {
      key: 'occurred', header: t('ledger.columns.occurred'), size: 106,
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
      key: 'doc', header: t('ledger.columns.document'), rowHeader: true, size: 138,
      // F9c ruling 4: the By column never fits beside Document below 1536, so there it leaves the table
      // (see the actor column) and the same fact becomes a muted third line under the kind — the reader
      // still learns who posted the movement, nothing is dropped.
      // F9d: the secondary lines WRAP (`break-words`) instead of truncating. In an auto-layout table a
      // nowrap line is never truncated — it makes its column at least as wide as its full text. (The
      // shared desktop cell already forces `.truncate` descendants to wrap, so carrying `truncate` here
      // was a width the cell had to undo; these lines now say what they mean.) The document number stays
      // on one line: it is short, and the reader scans it as one token.
      cell: (r) => (
        <div className="min-w-0">
          <Link to={`/stock/documents/${r.documentId}`} className="block whitespace-nowrap font-mono text-sm font-semibold hover:underline">{r.documentNumber}</Link>
          <span className="block break-words text-sm text-muted-foreground">{t(`kinds.${r.kind}`, r.kind)}</span>
          {r.actorName && (
            <span data-testid="stock-ledger-actor" className="block break-words text-sm text-muted-foreground 2xl:hidden">{r.actorName}</span>
          )}
        </div>
      ),
      exportValue: (r) => r.documentNumber,
    },
    {
      key: 'item', header: t('ledger.columns.item'), size: 102,
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
    { key: 'warehouse', header: t('ledger.columns.warehouse'), size: 94, cell: (r) => <CodeText code={r.warehouseCode} testId="stock-ledger-warehouse-code" className="block min-w-0 break-all font-mono text-sm md:break-normal" />, exportValue: (r) => r.warehouseCode },
    {
      key: 'project', header: t('ledger.columns.project'), size: 94, colClassName: 'hidden lg:table-cell',
      // F9d: the project name and its work-item code wrap too; a nowrap line here would push the column
      // (and the table) wider instead of ending.
      cell: (r) => (r.projectName ? (<div className="min-w-0"><span className="block break-words text-sm">{r.projectName}</span><span className="block break-words text-sm text-muted-foreground">{r.boqItemCode ?? ''}</span></div>) : null),
      exportValue: (r) => r.projectName ?? '',
    },
    {
      key: 'delta', header: t('ledger.columns.change'), align: 'num', size: 136,
      // Keep the signed quantity and its unit together; the full-width flex line also applies the
      // numeric column's right alignment to the cell content, matching its header.
      cell: (r) => <span data-testid="stock-ledger-change" className={`flex w-full min-w-0 max-w-full flex-nowrap items-baseline justify-end gap-x-1 whitespace-nowrap tabular-nums ${r.qtyDelta.startsWith('-') ? 'text-destructive-text' : ''}`}><span className="whitespace-nowrap">{r.qtyDelta.startsWith('-') ? '' : '+'}{formatQuantity(r.qtyDelta, loc)}</span>{' '}<span className="whitespace-nowrap">{r.unitCode}</span></span>,
      exportValue: (r) => r.qtyDelta,
    },
    { key: 'after', header: t('ledger.columns.balance'), align: 'num', size: 84, cell: (r) => <span className="whitespace-nowrap tabular-nums">{formatQuantity(r.qtyAfter, loc)}</span>, exportValue: (r) => r.qtyAfter },
  ];
  if (showCost) {
    cols.push(
      // C13: keep cost values visible at every desktop width; explicit widths let the full trace fit at
      // 1280px while retaining the existing code and secondary-line wrapping rules.
      // F9d: one line per figure (`whitespace-nowrap`) — a hyphen or the space after a currency code is
      // otherwise a place the line may break, and the reader gets a minus with no number under it.
      { key: 'vdelta', header: t('ledger.columns.valueChange'), align: 'num', size: 117, cell: (r) => <span className="whitespace-nowrap tabular-nums">{formatStockValue(r.valueDelta, currency, loc)}</span>, exportValue: (r) => r.valueDelta ?? '' },
      { key: 'vafter', header: t('ledger.columns.valueBalance'), align: 'num', size: 117, cell: (r) => <span className="whitespace-nowrap tabular-nums">{formatStockValue(r.valueAfter, currency, loc)}</span>, exportValue: (r) => r.valueAfter ?? '' },
    );
  }
  // F9c ruling 4: By shows on screen only from 2xl (1536px); below that its fact rides under Document.
  cols.push({ key: 'actor', header: t('ledger.columns.by'), size: 120, colClassName: 'hidden 2xl:table-cell', cell: (r) => <span className="text-sm">{r.actorName ?? ''}</span>, exportValue: (r) => r.actorName ?? '' });
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
