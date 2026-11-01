import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, DataTable, ListState, PageHeader, StatusPill, useToast, type Column } from '@/src/components/ui';
import { StockTabs } from '@/src/components/stock/StockTabs';
import { useStockErrorText } from '@/src/components/stock/useStockErrorText';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useProjectConsumption, useStockDocument, useStockDocumentCosts, useStockDocumentEntries, useStockDocumentMutations, useStockKeepers, useStockOnHand } from '@/src/hooks/useStock';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { formatQuantity, formatStockValue, stockValuePreview, subtractDecimal } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { formatInstantDate } from '@/src/lib/format';
import { statusVariant } from '@/src/components/stock/stockStatus';
import type { StockDocumentLine } from '@/src/lib/db/stockDocuments';
import type { StockLedgerRow } from '@/src/lib/db/stockReports';

/** OQ-STK-7: after an issue posts, flag any of its work-item lines now over allowance (to the issue's date). Never blocks. */
const OverAllowanceNotice: React.FC<{ projectId: string; on: string; lines: StockDocumentLine[] }> = ({ projectId, on, lines }) => {
  const { t } = useTranslation('stock');
  const loc = getNumberLocale();
  const report = useProjectConsumption(projectId, on, on);
  const over = (report.data?.allowances ?? []).filter((a) => a.overAllowance && lines.some((l) => l.boq_item_id === a.boqItemId && l.item_id === a.itemId));
  if (over.length === 0) return null;
  return (
    <div role="status" className="space-y-1 rounded-md border border-warning/40 bg-warning/12 px-3 py-2 text-sm text-warning-foreground">
      {over.map((a) => (
        <p key={a.id}>{t('issueOverAllowance', { workItem: a.boqItemCode, used: formatQuantity(a.netToDate, loc), planned: formatQuantity(a.plannedQuantity, loc), unit: a.unitCode })}</p>
      ))}
    </div>
  );
};

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
  const writeOff = d?.kind === 'adjustment' || d?.kind === 'count';
  const isAuthor = !!me && d?.created_by === me;
  // FR-STK-062: the author of a write-off Draft reopens it; another person (rank >= 20) posts it.
  const canEdit = writeOff && d?.status === 'Draft' && isAuthor && may('create', 'stockDocument', ctx);
  // The approver of a Draft write-off reviews what it WILL post: live system quantity, difference and, at rank >= 20, value (FR-STK-062/063).
  const liveDraft = writeOff && d?.status === 'Draft';
  const seeCost = may('create', 'stockItem');
  const onHand = useStockOnHand({ warehouseId: d?.warehouse_id, includeZero: true }, Boolean(liveDraft && d?.warehouse_id));
  const costs = useStockDocumentCosts(d?.id, liveDraft && seeCost);
  const balanceOf = (itemId: string) => (onHand.data ? onHand.data.find((r) => r.itemId === itemId && r.warehouseId === d?.warehouse_id) ?? { qtyOnHand: '0', valueOnHand: '0' } : undefined);
  const costOf = (lineId: string) => costs.data?.find((c) => c.lineId === lineId)?.unitCost;
  const systemOf = (l: StockDocumentLine) => (liveDraft ? balanceOf(l.item_id)?.qtyOnHand ?? null : l.expected_quantity);
  const varianceOf = (l: StockDocumentLine) => { const sys = systemOf(l); return sys === null || l.counted_quantity === null ? null : subtractDecimal(l.counted_quantity, sys); };
  // Signed change of the line, valued as the server will: a stated in-cost, else the moving average (0416).
  const valueOf = (l: StockDocumentLine): string | undefined => {
    const b = balanceOf(l.item_id);
    const delta = d?.kind === 'count' ? varianceOf(l) : l.quantity && (l.direction === 'out' ? `-${l.quantity}` : l.quantity);
    if (!b || !delta || delta === '0') return undefined;
    const cost = costOf(l.id);
    const atAvg = b.valueOnHand !== undefined ? stockValuePreview(delta, { valueOnHand: b.valueOnHand, qtyOnHand: b.qtyOnHand }) : undefined;
    if (delta.startsWith('-')) return atAvg;
    return d?.kind === 'adjustment' && cost ? stockValuePreview(delta, { unitCost: cost }) : atAvg ?? (cost ? stockValuePreview(delta, { unitCost: cost }) : undefined);
  };

  const lineCols: Column<StockDocumentLine>[] = useMemo(() => [
    { key: 'no', header: '#', cell: (l) => <span className="tabular-nums">{l.line_no}</span>, exportValue: (l) => l.line_no },
    {
      key: 'item', header: t('detail.columns.item'), rowHeader: true,
      cell: (l) => (<div className="min-w-0"><span className="block truncate font-mono text-sm font-semibold">{l.item?.code}</span><span className="block truncate text-xs text-muted-foreground">{l.item?.name}</span></div>),
      exportValue: (l) => l.item?.code ?? '',
    },
    {
      key: 'qty', header: d?.kind === 'count' ? t('count.detail.counted') : t('detail.columns.quantity'), align: 'num',
      cell: (l) => <span className="tabular-nums">{formatQuantity(l.quantity ?? l.counted_quantity ?? '0', loc)} <span className="text-muted-foreground">{l.item?.unit.code}</span></span>,
      exportValue: (l) => l.quantity ?? l.counted_quantity ?? '',
    },
    ...(d?.kind === 'adjustment' ? [{
      key: 'dir', header: t('count.detail.direction'), cell: (l: StockDocumentLine) => <span className="text-sm">{l.direction === 'in' ? t('count.in') : t('count.out')}</span>,
      exportValue: (l: StockDocumentLine) => l.direction ?? '',
    }] : []),
    ...(d?.kind === 'count' ? [{
      key: 'expected', header: liveDraft ? t('count.systemNow') : t('count.detail.expected'), align: 'num' as const,
      cell: (l: StockDocumentLine) => { const sys = systemOf(l); return <span className="tabular-nums">{sys === null ? '—' : formatQuantity(sys, loc)}</span>; },
      exportValue: (l: StockDocumentLine) => systemOf(l) ?? '',
    }, {
      key: 'variance', header: t('count.variance'), align: 'num' as const,
      cell: (l: StockDocumentLine) => {
        const v = varianceOf(l);
        if (v === null) return <span className="text-muted-foreground">—</span>;
        return <span className="font-semibold tabular-nums">{v === '0' || v.startsWith('-') ? '' : '+'}{formatQuantity(v, loc)}</span>;
      },
      exportValue: (l: StockDocumentLine) => varianceOf(l) ?? '',
    }] : []),
    ...(liveDraft && seeCost && d?.kind === 'adjustment' ? [{
      key: 'cost', header: t('count.detail.unitCost'), align: 'num' as const,
      cell: (l: StockDocumentLine) => { const c = l.direction === 'in' ? costOf(l.id) : undefined; return c ? <span className="tabular-nums">{formatStockValue(c, currency, loc)}</span> : <span className="text-xs text-muted-foreground">{t('count.detail.atAverage')}</span>; },
      exportValue: (l: StockDocumentLine) => costOf(l.id) ?? '',
    }] : []),
    ...(liveDraft && seeCost ? [{
      key: 'value', header: t('detail.columns.value'), align: 'num' as const,
      cell: (l: StockDocumentLine) => { const v = valueOf(l); return <span className="tabular-nums">{v === undefined ? '—' : formatStockValue(v, currency, loc)}</span>; },
      exportValue: (l: StockDocumentLine) => valueOf(l) ?? '',
    }] : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers read onHand/costs, listed below
  ], [t, loc, d?.kind, d?.warehouse_id, liveDraft, seeCost, currency, onHand.data, costs.data]);

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
            actions={(canPost || canCancel || canEdit) && (
              <div className="flex gap-2">
                {canEdit && <Button variant="outline" size="sm" onClick={() => navigate(`/stock/documents/${d.id}/edit`)}>{t('count.editDraft')}</Button>}
                {canPost && <Button variant="primary" size="sm" loading={m.post.isPending} onClick={() => void run(() => m.post.mutateAsync({ id: d.id, revision: d.revision }), 'detail.posted')}>{t('detail.post')}</Button>}
                {canCancel && <Button variant="outline" size="sm" onClick={() => setConfirmCancel(true)}>{t('detail.cancelDraft')}</Button>}
              </div>
            )}
          />
          {d.kind === 'issue' && d.status === 'Posted' && d.project_id && <OverAllowanceNotice projectId={d.project_id} on={d.occurred_on} lines={d.lines} />}
          {writeOff && d.status === 'Draft' && isAuthor && <p className="text-sm text-muted-foreground">{t('count.anotherPerson')}</p>}
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
