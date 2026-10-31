import React, { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, ListPage, ListState, SelectField, StatusPill, TextField, type Column } from '@/src/components/ui';
import { StockTabs } from '@/src/components/stock/StockTabs';
import { useStockItems, useStockLedger, useStockWarehouses } from '@/src/hooks/useStock';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { formatQuantity, formatStockValue } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { formatDate, formatDateTime } from '@/src/lib/format';
import type { StockLedgerRow } from '@/src/lib/db/stockReports';

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
  const showCost = rows.some((r) => r.valueDelta !== undefined);

  const columns: Column<StockLedgerRow>[] = useMemo(() => {
    const cols: Column<StockLedgerRow>[] = [
      { key: 'when', header: t('ledger.columns.when'), cell: (r) => <span className="whitespace-nowrap tabular-nums">{formatDateTime(new Date(r.postedAt))}</span>, exportValue: (r) => r.postedAt },
      ...(embedded ? [] : [{ key: 'occurred', header: t('ledger.columns.occurred'), colClassName: 'hidden 2xl:table-cell', cell: (r) => <span className="whitespace-nowrap tabular-nums">{formatDate(r.occurredOn)}</span>, exportValue: (r) => r.occurredOn} as Column<StockLedgerRow>]),
      {
        key: 'doc', header: t('ledger.columns.document'), rowHeader: true,
        cell: (r) => (
          <div className="min-w-0">
            <Link to={`/stock/documents/${r.documentId}`} className="block truncate font-mono text-sm font-semibold hover:underline">{r.documentNumber}</Link>
            <span className="block truncate text-xs text-muted-foreground">{t(`kinds.${r.kind}`, r.kind)}</span>
          </div>
        ),
        exportValue: (r) => r.documentNumber,
      },
      {
        key: 'item', header: t('ledger.columns.item'),
        cell: (r) => (<div className="min-w-0"><span className="block truncate font-mono text-sm">{r.itemCode}</span><span className="block truncate text-xs text-muted-foreground">{r.itemName}</span></div>),
        exportValue: (r) => r.itemCode,
      },
      { key: 'warehouse', header: t('ledger.columns.warehouse'), cell: (r) => <span className="text-sm">{r.warehouseCode}</span>, exportValue: (r) => r.warehouseCode },
      {
        key: 'project', header: t('ledger.columns.project'), colClassName: 'hidden lg:table-cell',
        cell: (r) => (r.projectName ? (<div className="min-w-0"><span className="block truncate text-sm">{r.projectName}</span><span className="block truncate text-xs text-muted-foreground">{r.boqItemCode ?? ''}</span></div>) : <span className="text-muted-foreground">–</span>),
        exportValue: (r) => r.projectName ?? '',
      },
      {
        key: 'delta', header: t('ledger.columns.change'), align: 'num',
        cell: (r) => <span className={`tabular-nums ${r.qtyDelta.startsWith('-') ? 'text-destructive-text' : ''}`}>{r.qtyDelta.startsWith('-') ? '' : '+'}{formatQuantity(r.qtyDelta, loc)} {r.unitCode}</span>,
        exportValue: (r) => r.qtyDelta,
      },
      { key: 'after', header: t('ledger.columns.balance'), align: 'num', cell: (r) => <span className="tabular-nums">{formatQuantity(r.qtyAfter, loc)}</span>, exportValue: (r) => r.qtyAfter },
    ];
    if (showCost) {
      cols.push(
        { key: 'vdelta', header: t('ledger.columns.valueChange'), align: 'num', colClassName: 'hidden xl:table-cell', cell: (r) => <span className="tabular-nums">{formatStockValue(r.valueDelta, currency, loc)}</span>, exportValue: (r) => r.valueDelta ?? '' },
        { key: 'vafter', header: t('ledger.columns.valueBalance'), align: 'num', colClassName: 'hidden xl:table-cell', cell: (r) => <span className="tabular-nums">{formatStockValue(r.valueAfter, currency, loc)}</span>, exportValue: (r) => r.valueAfter ?? '' },
      );
    }
    cols.push({ key: 'actor', header: t('ledger.columns.by'), colClassName: 'hidden md:table-cell', cell: (r) => <span className="text-sm">{r.actorName ?? ''}</span>, exportValue: (r) => r.actorName ?? '' });
    return cols;
  }, [t, loc, currency, showCost, embedded]);

  const state: 'loading' | 'empty' | 'error' | undefined =
    ledger.isError || items.isError || warehouses.isError ? 'error' : ledger.isPending ? 'loading' : rows.length === 0 ? 'empty' : undefined;
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
          <DataTable<StockLedgerRow> rows={rows} columns={columns} rowKey={(r) => String(r.seq)} tableId={embedded ? 'stock-ledger-embedded' : 'stock-ledger'} accessibleName={t('ledger.title')} embedded={embedded} />
          {ledger.hasNextPage && (
            <div className="mt-3 flex justify-center">
              <Button variant="outline" loading={ledger.isFetchingNextPage} onClick={() => void ledger.fetchNextPage()}>{t('ledger.loadMore')}</Button>
            </div>
          )}
          {!ledger.hasNextPage && <p className="mt-3 text-center text-xs text-muted-foreground">{t('ledger.end', { count: rows.length })}</p>}
        </>
      )}
    </>
  );

  if (embedded) return body;
  return (
    <ListPage
      title={t('ledger.title')}
      description={t('ledger.description')}
      filters={
        <div className="flex flex-wrap items-end gap-3">
          <SelectField label={t('ledger.filters.item')} hideLabel value={itemId} onChange={(v) => set('item', v)}
            options={(items.data ?? []).map((i) => ({ value: i.id, label: `${i.code} - ${i.name}` }))} placeholder={t('ledger.filters.allItems')} />
          <SelectField label={t('ledger.filters.warehouse')} hideLabel value={warehouseId} onChange={(v) => set('warehouse', v)}
            options={(warehouses.data ?? []).map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` }))} placeholder={t('ledger.filters.allWarehouses')} />
          <TextField label={t('ledger.filters.from')} type="date" value={from} onChange={(v) => set('from', v)} />
          <TextField label={t('ledger.filters.to')} type="date" value={to} onChange={(v) => set('to', v)} />
          {documentId && <StatusPill variant="neutral">{t('ledger.filters.oneDocument')}</StatusPill>}
        </div>
      }
    >
      <StockTabs />
      {body}
    </ListPage>
  );
};

export default StockLedger;
