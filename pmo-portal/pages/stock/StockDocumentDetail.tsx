import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, DataTable, ListState, RecordHeader, StatusPill, useToast, type Column } from '@/src/components/ui';
import { StockTabs } from '@/src/components/stock/StockTabs';
import { useStockFailureNotice } from '@/src/components/stock/useStockErrorText';
import { usePermission } from '@/src/auth/usePermission';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { STOCK_COMMAND_IN_FLIGHT, useProjectConsumption, useStockDocument, useStockErpState, useStockDocumentCosts, useStockDocumentEntries, useStockDocumentMutations, useStockKeepers, useStockOnHand } from '@/src/hooks/useStock';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { formatQuantity, formatStockValue, stockValuePreview, subtractDecimal } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { isSetupRefusal, parseRefusalEvidence } from '@/src/lib/adapterSeam/odoo/stock/refusal';
import { formatDay } from '@/src/lib/format';
import type { StockDocumentLine } from '@/src/lib/db/stockDocuments';
import type { StockLedgerRow } from '@/src/lib/db/stockReports';

/** OQ-STK-7: after an issue posts, flag any of its work-item lines now over allowance (to the issue's date). Never blocks. */
const OverAllowanceNotice: React.FC<{ projectId: string; on: string; lines: StockDocumentLine[] }> = ({ projectId, on, lines }) => {
  const { t } = useTranslation('stock');
  const loc = getNumberLocale();
  const report = useProjectConsumption(projectId, on, on);
  // C5: a check that could not run is not a clean bill of health — say so, and let it be re-run.
  if (report.isError) {
    return (
      <ListState
        variant="error"
        title={t('detail.overAllowanceFailed', 'Could not check whether this issue is over its work-item allowance.')}
        sub={t('states.errorSub')}
        retryLabel={t('actions.retry')}
        onRetry={() => void report.refetch()}
      />
    );
  }
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
  const { t, i18n } = useTranslation('stock');
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const me = useAuth().currentUser?.id;
  const currency = useOrgCurrency();
  const loc = getNumberLocale();
  const notify = useStockFailureNotice();
  const doc = useStockDocument(documentId);
  const entries = useStockDocumentEntries(documentId);
  const keepers = useStockKeepers();
  const m = useStockDocumentMutations();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmPost, setConfirmPost] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  // Connected posting: the document is a Draft until Odoo confirms; the command and Odoo's evidence say where it stands.
  const connected = routeDomainWrite('inventory') === 'external';
  const erp = useStockErpState(documentId, connected);
  const command = erp.data?.command ?? null;
  const evidence = erp.data?.mirror ?? null;
  const held = command?.state === 'held';
  const settling = STOCK_COMMAND_IN_FLIGHT.includes(command?.state ?? '');
  // The last post was refused before anything reached Odoo: the mirror holds the reason code; the copy names the setup step.
  const refusal = command?.state === 'failed' && evidence?.state === 'failed' && evidence.exception ? parseRefusalEvidence(evidence.exception) : null;

  const d = doc.data;
  // The warehouse a refusal names, when it is one of this document's two.
  const refusedWarehouse = refusal?.subjectId === undefined ? null : refusal.subjectId === d?.warehouse_id ? d?.warehouse : refusal.subjectId === d?.to_warehouse_id ? d?.to_warehouse : null;
  const refusalFact = !refusal ? '' : refusedWarehouse && i18n.exists(`stock:refusalWarehouse.${refusal.reason}`)
    ? t(`refusalWarehouse.${refusal.reason}`, { warehouse: refusedWarehouse.code })
    : t(`refusal.${refusal.reason}`, { defaultValue: t('refusal.other') });
  const refusalIsSetup = !refusal || !i18n.exists(`stock:refusal.${refusal.reason}`) || isSetupRefusal(refusal.reason);
  const canOpenSetup = may('manage', 'integration');
  const postedFromOdoo = d?.status === 'Posted' && evidence?.state === 'confirmed';
  // Odoo's number is a sum across items: it reads as a quantity only when every line shares one unit, else the lines are counted.
  const units = new Set((d?.lines ?? []).map((l) => l.item?.unit.code));
  const moved = units.size === 1 ? t('detail.erp.movedQuantity', { quantity: formatQuantity(evidence?.completedQuantity ?? '0', loc), unit: [...units][0] }) : t('detail.erp.movedLines', { count: d?.lines.length ?? 0 });
  // The valuation is the project's material cost: the database answers it only to the roles that see stock costs.
  const value = evidence?.completedValue ?? null;
  const awaitingEvidence = connected && d?.status === 'Posted' && erp.isPending;
  const isKeeper = (keepers.data ?? []).some((k) => k.warehouse_id === d?.warehouse_id && k.user_id === me);
  const record = { kind: d?.kind, status: d?.status, created_by: d?.created_by, isKeeper, viewOnly: realRole !== effectiveRole };
  const ctx = { currentUserId: me, record };
  const canCancel = may('withdraw', 'stockDocument', ctx);
  const canPost = d?.status === 'Draft' && !held && !settling && may('post', 'stockDocument', ctx);
  const canRelease = held && may('manage', 'pushHold');
  const keeperReadBlocksPost = Boolean(d?.status === 'Draft' && keepers.isError && !canPost && may('post', 'stockDocument', { ...ctx, record: { ...record, isKeeper: true } }));
  const writeOff = d?.kind === 'adjustment' || d?.kind === 'count';
  const isAuthor = !!me && d?.created_by === me;
  // FR-STK-062: the author of a write-off Draft reopens it; another person (rank >= 20) posts it.
  const canEdit = writeOff && d?.status === 'Draft' && isAuthor && may('create', 'stockDocument', ctx);
  // The approver of a Draft write-off reviews what it WILL post: live system quantity, difference and, at rank >= 20, value (FR-STK-062/063).
  const liveDraft = writeOff && d?.status === 'Draft';
  const seeCost = may('create', 'stockItem');
  // C13: the line unit costs are stamped on the lines and stay readable after posting, so a
  // write-off's per-line money does not vanish from the record the moment it posts. A Draft reads them
  // for its value column; a posted ADJUSTMENT reads them for its unit-cost column.
  const readsLineCosts = seeCost && (liveDraft || d?.kind === 'adjustment');
  const onHand = useStockOnHand({ warehouseId: d?.warehouse_id, includeZero: true }, Boolean(liveDraft && d?.warehouse_id));
  const costs = useStockDocumentCosts(d?.id, Boolean(readsLineCosts));
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
      cell: (l) => (<div className="min-w-0"><span className="block truncate font-mono text-sm font-semibold">{l.item?.code}</span><span className="block truncate text-sm text-muted-foreground">{l.item?.name}</span></div>),
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
    ...(seeCost && d?.kind === 'adjustment' ? [{
      key: 'cost', header: t('count.detail.unitCost'), align: 'num' as const,
      cell: (l: StockDocumentLine) => {
        const c = costOf(l.id);
        if (c) return <span className="tabular-nums">{formatStockValue(c, currency, loc)}</span>;
        // Only a Draft may still say "at average cost" — that is what posting WILL use.
        return liveDraft
          ? <span className="text-sm text-muted-foreground">{t('count.detail.atAverage')}</span>
          : <span className="text-muted-foreground">—</span>;
      },
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

  const run = async (fn: () => Promise<unknown>, okKey: string): Promise<boolean> => {
    try {
      await fn();
      toast(t(okKey), undefined, 'success');
      return true;
    } catch (err) {
      notify(err);
      return false;
    }
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
          <RecordHeader
            className="!mb-4"
            name={<span className="font-mono">{d.number}</span>}
            meta={`${t(`kinds.${d.kind}`)} · ${formatDay(d.occurred_on)}`}
            status={<StatusPill record="stockDocument" state={d.status === 'Draft' && held ? 'On hold' : d.status} />}
            primaryAction={canPost
              ? <Button variant="primary" size="sm" loading={m.post.isPending} onClick={() => setConfirmPost(true)}>{t('detail.post')}</Button>
              : canEdit ? <Button variant="primary" size="sm" onClick={() => navigate(`/stock/documents/${d.id}/edit`)}>{t('count.editDraft')}</Button> : undefined}
            menuItems={[
              ...(canPost && canEdit ? [{ key: 'edit', label: t('count.editDraft'), onSelect: () => navigate(`/stock/documents/${d.id}/edit`) }] : []),
              ...(canCancel ? [{ key: 'cancel', label: t('detail.cancelDraft'), danger: true, onSelect: () => setConfirmCancel(true) }] : []),
            ]}
          />
          {d.status === 'Draft' && settling && <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">{t('detail.erp.settling')}</p>}
          {d.status === 'Draft' && refusal && !settling && !held && (
            <p role="alert" className="rounded-md border border-warning/40 bg-warning/12 px-3 py-2 text-sm text-warning-foreground">
              {t('detail.erp.refused', { reason: refusalFact })}{refusalIsSetup && (
                <>{' '}{canOpenSetup ? <Link className="font-medium underline" to="/administration/integrations">{t('detail.erp.checkSetup')}</Link> : t('detail.erp.askAdmin')}</>
              )}
            </p>
          )}
          {d.status === 'Draft' && held && (
            <div role="alert" className="space-y-2 rounded-md border border-warning/40 bg-warning/12 px-3 py-2 text-sm text-warning-foreground">
              <p>{evidence?.exception ?? t('detail.erp.heldNoReason')}</p>
              <p>{canRelease ? t('detail.erp.heldAdmin') : t('detail.erp.heldOther')}</p>
              {canRelease && command && <Button variant="outline" size="sm" loading={m.releaseHold.isPending} onClick={() => setConfirmRelease(true)}>{t('detail.erp.release')}</Button>}
            </div>
          )}
          {postedFromOdoo && (
            <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
              {evidence.externalReference ? t('detail.erp.fromOdoo', { ref: evidence.externalReference, moved }) : t('detail.erp.fromOdooNoRef', { moved })}{' '}
              {d.kind === 'transfer' || (value !== null && /^-?0(\.0+)?$/.test(value))
                ? t('detail.erp.noValueChange')
                : value !== null && t('detail.erp.value', { value: formatStockValue(value.replace(/^-/, ''), evidence.currency ?? currency, loc) })}
            </p>
          )}
          {keeperReadBlocksPost && <ListState
            variant="error"
            title={t('detail.keepersError', 'Could not load stock keepers, so Post is unavailable.')}
            onRetry={() => void keepers.refetch()}
          />}
          {d.kind === 'issue' && d.status === 'Posted' && d.project_id && <OverAllowanceNotice projectId={d.project_id} on={d.occurred_on} lines={d.lines} />}
          {writeOff && d.status === 'Draft' && isAuthor && <p className="text-sm text-muted-foreground">{t('count.anotherPerson')}</p>}
          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 text-sm md:grid-cols-4">
            <div><dt className="text-sm text-muted-foreground">{t('detail.fields.warehouse')}</dt><dd>{d.warehouse?.code}{d.to_warehouse ? ` → ${d.to_warehouse.code}` : ''}</dd></div>
            {d.project && <div><dt className="text-sm text-muted-foreground">{t('detail.fields.project')}</dt><dd><Link className="hover:underline" to={`/projects/${d.project_id}`}>{d.project.name}</Link></dd></div>}
            <div><dt className="text-sm text-muted-foreground">{t('detail.fields.author')}</dt><dd>{d.author?.full_name ?? ''}</dd></div>
            <div><dt className="text-sm text-muted-foreground">{t('detail.fields.created')}</dt><dd className="tabular-nums">{formatDay(d.created_at)}</dd></div>
            {d.reason && <div className="col-span-full"><dt className="text-sm text-muted-foreground">{t('detail.fields.reason')}</dt><dd>{d.reason}</dd></div>}
            {d.note && <div className="col-span-full"><dt className="text-sm text-muted-foreground">{t('detail.fields.note')}</dt><dd>{d.note}</dd></div>}
          </dl>
          <section aria-labelledby="lines-h">
            <h2 id="lines-h" className="mb-2 text-group font-semibold">{t('detail.lines')}</h2>
            <DataTable<StockDocumentLine> rows={d.lines} columns={lineCols} rowKey={(l) => l.id} tableId="stock-document-lines" accessibleName={t('detail.lines')} embedded />
            {readsLineCosts && costs.isError && (
              /* C1: a failed cost read leaves the money cells blank — say why, and let it be re-run. */
              <div className="mt-3">
                <ListState
                  variant="error"
                  title={t('detail.costsFailed', "Couldn't load the line costs")}
                  sub={t('states.errorSub')}
                  retryLabel={t('actions.retry')}
                  onRetry={() => void costs.refetch()}
                />
              </div>
            )}
          </section>
          <section aria-labelledby="entries-h">
            <h2 id="entries-h" className="mb-2 text-group font-semibold">{t('detail.entries')}</h2>
            {entries.isError && <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => void entries.refetch()} />}
            {entries.isPending && <ListState variant="loading" rows={2} />}
            {postedFromOdoo && <p className="text-sm text-muted-foreground">{t('detail.erp.entriesInOdoo')}</p>}
            {!postedFromOdoo && !awaitingEvidence && !entries.isPending && !entries.isError && entryRows.length === 0 && <p className="text-sm text-muted-foreground">{t('detail.noEntries')}</p>}
            {entryRows.length > 0 && <DataTable<StockLedgerRow> rows={entryRows} columns={entryCols} rowKey={(r) => String(r.seq)} tableId="stock-document-entries" accessibleName={t('detail.entries')} embedded />}
            {d.status === 'Posted' && !postedFromOdoo && !awaitingEvidence && <p className="mt-2 text-sm"><Link className="underline" to={`/stock/ledger?document=${d.id}`}>{t('detail.openInLedger')}</Link></p>}
          </section>
        </div>
      )}
      <ConfirmDialog
        open={confirmPost}
        tone="destructive"
        title={t('detail.postConfirm.title', 'Post this stock document?')}
        description={t('detail.postConfirm.description', '{{number}} will be posted and stock on hand will change using these lines. This document can no longer be edited.', { number: d?.number ?? '' })}
        confirmLabel={t('detail.post')}
        loading={m.post.isPending}
        onConfirm={() => {
          if (d) void run(() => m.post.mutateAsync({ id: d.id, revision: d.revision }), 'detail.posted').then((succeeded) => {
            if (succeeded) setConfirmPost(false);
          });
        }}
        onCancel={() => { if (!m.post.isPending) setConfirmPost(false); }}
      />
      <ConfirmDialog
        open={confirmRelease}
        tone="destructive"
        title={t('detail.erp.releaseConfirm.title')}
        description={t('detail.erp.releaseConfirm.description')}
        confirmLabel={t('detail.erp.release')}
        loading={m.releaseHold.isPending}
        onConfirm={() => {
          if (command) void run(() => m.releaseHold.mutateAsync(command.id), 'detail.erp.released').then((ok) => { if (ok) setConfirmRelease(false); });
        }}
        onCancel={() => { if (!m.releaseHold.isPending) setConfirmRelease(false); }}
      />
      <ConfirmDialog
        open={confirmCancel}
        tone="destructive"
        title={t('detail.confirm.title')}
        description={t('detail.confirm.description')}
        confirmLabel={t('detail.confirm.confirm')}
        loading={m.cancel.isPending}
        onConfirm={() => {
          if (d) void run(() => m.cancel.mutateAsync(d.id), 'detail.cancelled').then((succeeded) => {
            if (succeeded) setConfirmCancel(false);
          });
        }}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
};

export default StockDocumentDetail;
