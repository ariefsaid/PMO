import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, ConfirmDialog, DataTable, MobileActionBar, FieldError, ListState, PageHeader, SelectField, StatusPill, TextField, type Column } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';
import { DateField } from '@/src/components/ui/DateField';
import { ItemPicker } from '@/src/components/stock/ItemPicker';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useOrderReceiving, useOrderReceivingEnabled, useReceivingOrders } from '@/src/hooks/useOrderReceiving';
import { useStockKeepers, useStockWarehouses } from '@/src/hooks/useStock';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useRefusalLine } from '@/src/lib/refusals';
import { orderReceivingRepository as repository } from '@/src/lib/repositories/orderReceiving';
import type { ReceiptCount } from '@/src/lib/db/orderReceiving';
import { formatQuantity, isPositiveDecimal, normalizeDecimal } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { NO_QUALITY, qualityProblem, qualityWire, type QualityProblem, type QualityValue } from '@/src/lib/receiptQuality';
import { OrderReceivingLines } from './OrderReceivingLines';

type ReceiptRow = { key: string; count: ReceiptCount; line: ReceiptCount['lines'][number]; first: boolean };
const RECEIPT_VARIANT = { posted: 'won', approved: 'open', waiting: 'warn', reversed: 'neutral' } as const;

export function OrderReceivingSetting() {
  const { t } = useTranslation('stock');
  const flag = useOrderReceivingEnabled();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const qc = useQueryClient();
  const refusal = useRefusalLine();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [nextEnabled, setNextEnabled] = useState<boolean | null>(null);
  const save = () => {
    if (nextEnabled === null) return;
    const enabled = nextEnabled;
    setNextEnabled(null); setBusy(true); setError('');
    void repository.setEnabled(enabled).then(() => qc.invalidateQueries({ queryKey: ['order-receiving-enabled'] }))
      .catch((e: unknown) => setError(refusal(e))).finally(() => setBusy(false));
  };
  if (!may('manage', 'orderReceiving', { record: { viewOnly: realRole !== effectiveRole } })) return null;
  return <div className="flex flex-wrap items-center gap-2">
    <Checkbox checked={flag.data === true} disabled={busy || flag.isPending || flag.isError} label={t('receiving.enable')} onChange={setNextEnabled}>{t('receiving.enable')}</Checkbox>
    {flag.isError && <Button variant="outline" onClick={() => void flag.refetch()}>{t('receiving.retry')}</Button>}
    <FieldError>{error}</FieldError>
    <ConfirmDialog open={nextEnabled !== null} title={t('receiving.changeMode')} description={t('receiving.changeModeBody')} confirmLabel={t('receiving.confirmAction')} cancelLabel={t('receiving.cancel')} onCancel={() => setNextEnabled(null)} onConfirm={save} />
  </div>;
}

export default function OrderReceiving() {
  const { t } = useTranslation('stock');
  const [search, setSearch] = useSearchParams();
  const orderId = search.get('order') ?? '';
  const orders = useReceivingOrders(true);
  const order = useOrderReceiving(orderId);
  const warehouses = useStockWarehouses();
  const keepers = useStockKeepers();
  const user = useAuth().currentUser;
  const { realRole, effectiveRole } = useEffectiveRole();
  const viewOnly = realRole !== effectiveRole;
  const may = usePermission();
  const refusal = useRefusalLine();
  const qc = useQueryClient();
  const day = useFxOrgDay(true);
  const [warehouse, setWarehouse] = useState('');
  const [date, setDate] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, QualityValue>>({});
  const [problems, setProblems] = useState<Record<string, QualityProblem | null>>({});
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [decision, setDecision] = useState<{ count: ReceiptCount; reverse: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const data = order.data;
  const editable = may('edit', 'orderReceiving', { record: { viewOnly, receivingPurchaser: data?.purchaser } });
  const canReceive = may('create', 'stockDocument', { record: { viewOnly, isKeeper: (keepers.data ?? []).some((k) => k.warehouse_id === warehouse && k.user_id === user?.id) } });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['order-receiving'] });
    await qc.invalidateQueries({ queryKey: ['stock'] });
  };
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(''); setMessage('');
    try { await work(); await refresh(); } catch (e) { setError(refusal(e)); } finally { setBusy(false); }
  };
  const post = (count?: ReceiptCount) => run(async () => {
    const result = await repository.receive({ orderId, warehouseId: count?.warehouse_id ?? warehouse, date: count?.date ?? (date || day.day || ''),
      lines: count ? count.lines.map((l) => ({ ...l, quantity: String(l.quantity) })) : Object.entries(quantities).filter(([, q]) => q !== '').map(([id, q]) => {
        const flagged = data?.lines.find((l) => l.id === id)?.needs_quality_check;
        const check = flagged ? qualityWire(checks[id] ?? NO_QUALITY) : null;
        return { item_id: id, quantity: normalizeDecimal(q), ...(check ? { rejected: check.rejected, ...(check.rejectNote ? { reject_note: check.rejectNote } : {}) } : {}) };
      }),
      requestId: count?.id ?? requestId });
    setMessage(t(result.status === 'posted' ? 'receiving.posted' : 'receiving.waiting'));
    if (!count) { setQuantities({}); setChecks({}); setProblems({}); setRequestId(crypto.randomUUID()); }
  });
  // D4: a counted line whose item needs a quality check records only with a check that adds up.
  const askToRecord = () => {
    const found: Record<string, QualityProblem | null> = {};
    for (const line of data?.lines ?? []) {
      const q = normalizeDecimal(quantities[line.id] ?? '');
      if (line.needs_quality_check && isPositiveDecimal(q)) found[line.id] = qualityProblem(q, checks[line.id] ?? NO_QUALITY);
    }
    setProblems(found);
    if (Object.values(found).every((p) => p === null)) setConfirm(true);
  };
  const pending = orders.isPending || warehouses.isPending || keepers.isPending;
  const failure = orders.isError || warehouses.isError || keepers.isError;
  const lineName = (id: string) => data?.lines.find((l) => l.id === id);
  const receiptRows: ReceiptRow[] = (data?.requests ?? []).flatMap((count) => count.lines.map((line, index) => ({ key: `${count.id}-${line.item_id}`, count, line, first: index === 0 })));
  const receiptState = (count: ReceiptCount) => count.reversed ? 'reversed' : count.document_id ? 'posted' : count.approved ? 'approved' : 'waiting';
  const receiptActions = (count: ReceiptCount) => <div className="flex flex-wrap items-center justify-end gap-2">
    {count.document_id && <Link className="inline-flex min-h-9 items-center text-control font-medium text-primary-text underline underline-offset-4" to={`/stock/documents/${count.document_id}`}>{t('receiving.openMovement')}</Link>}
    {!count.document_id && count.approved && count.receiver_id === user?.id && !viewOnly && <Button variant="outline" disabled={busy} onClick={() => void post(count)}>{t('receiving.recordApproved')}</Button>}
    {may('approve', 'orderReceiving', { currentUserId: user?.id, record: { viewOnly, receivingPurchaser: data?.purchaser, created_by: count.receiver_id } }) && !count.reversed && (!count.document_id && !count.approved || count.document_id && may('post', 'stockDocument', { currentUserId: user?.id, record: { viewOnly, kind: 'adjustment', created_by: count.receiver_id } })) && <Button variant="outline" disabled={busy} onClick={() => { setReason(''); setDecision({ count, reverse: !!count.document_id }); }}>{t(count.document_id ? 'receiving.reverse' : 'receiving.approve')}</Button>}
  </div>;
  const receiptColumns: Column<ReceiptRow>[] = [
    { key: 'item', header: t('receiving.line'), rowHeader: true, cell: (r) => { const l = lineName(r.line.item_id); return l ? (data?.purchaser ? l.name : l.stock_name ?? l.name) : ''; },
      secondaryCell: undefined },
    { key: 'qty', header: t('receiving.received'), align: 'num', cell: (r) => <span className="tabular-nums whitespace-nowrap">{formatQuantity(String(r.line.quantity), getNumberLocale())}<span className="text-muted-foreground"> {lineName(r.line.item_id)?.unit ?? ''}</span></span> },
    { key: 'rejected', header: t('quality.rejected'), align: 'num', cell: (r) => Number(r.line.rejected ?? 0) > 0
      ? <span className="tabular-nums whitespace-nowrap">{formatQuantity(String(r.line.rejected), getNumberLocale())}<span className="block text-control text-muted-foreground">{r.line.reject_note ?? ''}</span></span> : null },
  ];
  const canRecord = !!warehouse && !!(date || day.day) && Object.values(quantities).some((q) => isPositiveDecimal(normalizeDecimal(q))) && !Object.values(quantities).some((q) => q !== '' && !isPositiveDecimal(normalizeDecimal(q)));
  return <div className="space-y-6 pb-24 md:pb-0">
    <PageHeader title={t('receiving.title')} action={<OrderReceivingSetting />} />
    {pending ? <ListState variant="loading" rows={3} /> : failure ? <div role="alert" className="space-y-2"><p>{t('receiving.loadError')}</p><Button variant="outline" onClick={() => { void orders.refetch(); void warehouses.refetch(); void keepers.refetch(); }}>{t('receiving.retry')}</Button></div> : <>
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField id="receipt-order" label={t('receiving.order')} value={orderId} onChange={(id) => { setSearch(id ? { order: id } : {}); setQuantities({}); setChecks({}); setProblems({}); setRequestId(crypto.randomUUID()); }} options={(orders.data ?? []).map((o) => ({ value: o.id, label: o.number }))} placeholder={t('receiving.chooseOrder')} />
        <SelectField id="receipt-warehouse" label={t('form.warehouse')} placeholder={t('form.warehousePlaceholder')} value={warehouse} onChange={setWarehouse} options={(warehouses.data ?? []).filter((w) => !w.archived_at).map((w) => ({ value: w.id, label: w.name }))} />
        <DateField id="receipt-date" label={t('receiving.date')} value={date || day.day || ''} onChange={setDate} />
      </div>
      {orders.data?.length === 0 && <p className="text-control text-muted-foreground">{t('receiving.noOrders')}</p>}
      {orderId && (order.isPending ? <ListState variant="loading" rows={3} /> : order.isError ? <div role="alert" className="space-y-2"><p>{t('receiving.loadError')}</p><Button variant="outline" onClick={() => void order.refetch()}>{t('receiving.retry')}</Button></div> : data && <>
        <OrderReceivingLines lines={data.lines} purchaser={data.purchaser} quantities={quantities} disabled={busy || viewOnly}
          onChange={(id, q) => setQuantities((old) => ({ ...old, [id]: q }))} checks={checks} onCheck={(id, v) => setChecks((old) => ({ ...old, [id]: v }))} problems={problems}
          mapping={(line) => editable
            ? <ItemPicker id={`mapping-${line.id}`} hideLabel label={`${t('receiving.stockItem')} · ${line.name}`} value={line.stock_item_id} onChange={(id) => void run(() => repository.map(line.id, id))} />
            : line.stock_name && <span className="text-control text-muted-foreground">{line.stock_name}</span>}
          rowMenu={editable ? (line) => line.stock_item_id && !data.requests.some((r) => r.lines.some((l) => l.item_id === line.id))
            ? [{ label: t('receiving.clearMapping'), onClick: () => void run(() => repository.map(line.id, null)), disabled: busy }] : undefined : undefined} />
        {canReceive && <MobileActionBar className="fixed inset-x-0 bottom-[var(--phone-nav-height)] z-20 flex justify-end border-t border-border bg-background p-3 md:static md:z-auto md:border-0 md:bg-transparent md:p-0">
          <Button variant="primary" className="w-full md:w-auto" loading={busy} disabled={!canRecord} onClick={askToRecord}>{t('receiving.record')}</Button>
        </MobileActionBar>}
        {data.requests.length > 0 && <section className="space-y-3" aria-label={t('receiving.receipts')}>
          <h2 className="text-base font-semibold">{t('receiving.receipts')}</h2>
          <DataTable<ReceiptRow> rows={receiptRows} columns={receiptColumns} rowKey={(r) => r.key} tableId="order-receiving-receipts" accessibleName={t('receiving.receipts')} embedded cardValuesEnd
            groupBy={(r) => r.count.id} groupHeaderSpan
            groupLabel={(id) => { const count = data.requests.find((r) => r.id === id); return count ? formatDay(count.date) : ''; }}
            groupHeader={(_, rows) => { const count = rows[0].count; return <div className="flex flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-2 py-1">
              <StatusPill variant={RECEIPT_VARIANT[receiptState(count)]}>{t(`receiving.${receiptState(count)}`)}</StatusPill>
              {receiptActions(count)}
            </div>; }} />
        </section>}
      </>)}
    </>}
    <FieldError>{error}</FieldError><p role="status" className="text-control">{message}</p>
    <ConfirmDialog open={confirm} title={t('receiving.confirm')} description={t('receiving.confirmBody')} confirmLabel={t('receiving.record')} cancelLabel={t('receiving.cancel')} onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void post(); }} />
    <ConfirmDialog open={!!decision} title={t(decision?.reverse ? 'receiving.reverse' : 'receiving.approve')} description={<TextField id="receipt-decision-reason" label={t('receiving.reason')} value={reason} onChange={setReason} />} confirmLabel={t('receiving.confirmAction')} cancelLabel={t('receiving.cancel')} confirmDisabled={!reason.trim() || busy} onCancel={() => setDecision(null)} onConfirm={() => { if (!decision) return; const d = decision; setDecision(null); void run(() => d.reverse ? repository.reverse(d.count.id, reason) : repository.approve(d.count.id, reason)); }} />
  </div>;
}
