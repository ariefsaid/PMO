import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, DataTable, ListState, PageHeader, StatusPill, useToast, type Column } from '@/src/components/ui';
import { StockTabs } from '@/src/components/stock/StockTabs';
import { useStockErrorText } from '@/src/components/stock/StockError';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useStockDocument, useStockDocumentEntries, useStockDocumentMutations, useStockKeepers } from '@/src/hooks/useStock';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { formatQuantity, formatStockValue } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { formatInstantDate } from '@/src/lib/format';
import { statusVariant } from './StockDocuments';
import type { StockDocumentLine } from '@/src/lib/db/stockDocuments';
import type { StockLedgerRow } from '@/src/lib/db/stockReports';

const StockDocumentDetail: React.FC = () => {
  const { t } = useTranslation('stock');
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const me = useAuth().currentUser?.id;
  const currency = useOrgCurrency();
  const loc = getNumberLocale();
  const errorText = useStockErrorText();
  const doc = useStockDocument(documentId);
  const entries = useStockDocumentEntries(documentId);
  const keepers = useStockKeepers();
  const m = useStockDocumentMutations();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const d = doc.data;
  const isKeeper = (keepers.data ?? []).some((k) => k.warehouse_id === d?.warehouse_id && k.user_id === me);
  const record = { kind: d?.kind, status: d?.status, created_by: d?.created_by, isKeeper, viewOnly: realRole !== effectiveRole };
  const ctx = { currentUserId: me, record };
  const canCancel = may('withdraw', 'stockDocument', ctx);
  const canPost = d?.status === 'Draft' && may('post', 'stockDocument', ctx);

  const lineCols: Column<StockDocumentLine>[] = useMemo(() => [
    { key: 'no', header: '#', cell: (l) => <span className="tabular-nums">{l.line_no}</span>, exportValue: (l) => l.line_no },
    {
      key: 'item', header: t('detail.columns.item'), rowHeader: true,
      cell: (l) => (<div className="min-w-0"><span className="block truncate font-mono text-sm font-semibold">{l.item?.code}</span><span className="block truncate text-xs text-muted-foreground">{l.item?.name}</span></div>),
      exportValue: (l) => l.item?.code ?? '',
    },
    {
      key: 'qty', header: t('detail.columns.quantity'), align: 'num',
      cell: (l) => <span className="tabular-nums">{formatQuantity(l.quantity ?? l.counted_quantity ?? '0', loc)} <span className="text-muted-foreground">{l.item?.unit.code}</span></span>,
      exportValue: (l) => l.quantity ?? l.counted_quantity ?? '',
    },
  ], [t, loc]);

  const entryRows = entries.data ?? [];
  const showCost = entryRows.some((r) => r.valueDelta !== undefined);
  const entryCols: Column<StockLedgerRow>[] = useMemo(() => {
    const cols: Column<StockLedgerRow>[] = [
      { key: 'item', header: t('detail.columns.item'), rowHeader: true, cell: (r) => <span className="font-mono text-sm">{r.itemCode}</span>, exportValue: (r) => r.itemCode },
      { key: 'wh', header: t('detail.columns.warehouse'), cell: (r) => <span className="text-sm">{r.warehouseCode}</span>, exportValue: (r) => r.warehouseCode },
      { key: 'delta', header: t('detail.columns.change'), align: 'num', cell: (r) => <span className="tabular-nums">{r.qtyDelta.startsWith('-') ? '' : '+'}{formatQuantity(r.qtyDelta, loc)} {r.unitCode}</span>, exportValue: (r) => r.qtyDelta },
      { key: 'after', header: t('detail.columns.balance'), align: 'num', cell: (r) => <span className="tabular-nums">{formatQuantity(r.qtyAfter, loc)}</span>, exportValue: (r) => r.qtyAfter },
    ];
    if (showCost) cols.push({ key: 'value', header: t('detail.columns.value'), align: 'num', cell: (r) => <span className="tabular-nums">{formatStockValue(r.valueDelta, currency, loc)}</span>, exportValue: (r) => r.valueDelta ?? '' });
    return cols;
  }, [t, loc, currency, showCost]);

  const run = async (fn: () => Promise<unknown>, okKey: string) => {
    try { await fn(); toast(t(okKey), undefined, 'success'); } catch (err) { toast(t('detail.actionFailed'), errorText(err), 'warning'); }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4">
      <StockTabs />
      {doc.isPending && <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={5} /></div>}
      {doc.isError && <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => void doc.refetch()} />}
      {!doc.isPending && !doc.isError && !d && (
        <ListState variant="empty" icon="folder" title={t('detail.notFound.title')} sub={t('detail.notFound.sub')} action={{ label: t('detail.backToList'), onClick: () => navigate('/stock/documents') }} />
      )}
      {d && (
        <div className="space-y-4">
          <PageHeader
            name={<span className="font-mono">{d.number}</span>}
            meta={`${t(`kinds.${d.kind}`)} · ${d.occurred_on}`}
            status={<StatusPill variant={statusVariant(d.status)}>{t(`documents.status.${d.status}`)}</StatusPill>}
            statusInline
            actions={(canPost || canCancel) && (
              <div className="flex gap-2">
                {canPost && <Button variant="primary" size="sm" loading={m.post.isPending} onClick={() => void run(() => m.post.mutateAsync(d.id), 'detail.posted')}>{t('detail.post')}</Button>}
                {canCancel && <Button variant="outline" size="sm" onClick={() => setConfirmCancel(true)}>{t('detail.cancelDraft')}</Button>}
              </div>
            )}
          />
          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 text-sm md:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">{t('detail.fields.warehouse')}</dt><dd>{d.warehouse?.code}{d.to_warehouse ? ` → ${d.to_warehouse.code}` : ''}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t('detail.fields.project')}</dt><dd>{d.project ? <Link className="hover:underline" to={`/projects/${d.project_id}`}>{d.project.name}</Link> : '–'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t('detail.fields.author')}</dt><dd>{d.author?.full_name ?? ''}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t('detail.fields.created')}</dt><dd className="tabular-nums">{formatInstantDate(d.created_at)}</dd></div>
            {d.reason && <div className="col-span-full"><dt className="text-xs text-muted-foreground">{t('detail.fields.reason')}</dt><dd>{d.reason}</dd></div>}
            {d.note && <div className="col-span-full"><dt className="text-xs text-muted-foreground">{t('detail.fields.note')}</dt><dd>{d.note}</dd></div>}
          </dl>
          <section aria-labelledby="lines-h">
            <h2 id="lines-h" className="mb-2 text-group font-semibold">{t('detail.lines')}</h2>
            <DataTable<StockDocumentLine> rows={d.lines} columns={lineCols} rowKey={(l) => l.id} tableId="stock-document-lines" accessibleName={t('detail.lines')} embedded />
          </section>
          <section aria-labelledby="entries-h">
            <h2 id="entries-h" className="mb-2 text-group font-semibold">{t('detail.entries')}</h2>
            {entries.isError && <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => void entries.refetch()} />}
            {entries.isPending && <ListState variant="loading" rows={2} />}
            {!entries.isPending && !entries.isError && entryRows.length === 0 && <p className="text-sm text-muted-foreground">{t('detail.noEntries')}</p>}
            {entryRows.length > 0 && <DataTable<StockLedgerRow> rows={entryRows} columns={entryCols} rowKey={(r) => String(r.seq)} tableId="stock-document-entries" accessibleName={t('detail.entries')} embedded />}
            {d.status === 'Posted' && <p className="mt-2 text-xs"><Link className="underline" to={`/stock/ledger?document=${d.id}`}>{t('detail.openInLedger')}</Link></p>}
          </section>
        </div>
      )}
      <ConfirmDialog
        open={confirmCancel}
        tone="destructive"
        title={t('detail.confirm.title')}
        description={t('detail.confirm.description')}
        confirmLabel={t('detail.confirm.confirm')}
        loading={m.cancel.isPending}
        onConfirm={() => { if (d) void run(() => m.cancel.mutateAsync(d.id), 'detail.cancelled').then(() => setConfirmCancel(false)); }}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
};

export default StockDocumentDetail;
