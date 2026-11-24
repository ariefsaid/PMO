import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, ConfirmDialog, FieldError, ListState, PageHeader, SelectField, TextField } from '@/src/components/ui';
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
import { isPositiveDecimal } from '@/src/lib/stockFormat';
import { OrderReceivingLines } from './OrderReceivingLines';

export function OrderReceivingSetting() {
  const { t } = useTranslation('stock');
  const flag = useOrderReceivingEnabled();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const qc = useQueryClient();
  const refusal = useRefusalLine();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!may('manage', 'orderReceiving', { record: { viewOnly: realRole !== effectiveRole } })) return null;
  return <section className="space-y-2 border-t border-border py-4">
    <Checkbox checked={flag.data === true} disabled={busy || flag.isPending || flag.isError} label={t('receiving.enable')} onChange={(enabled) => {
      setBusy(true); setError('');
      void repository.setEnabled(enabled).then(() => qc.invalidateQueries({ queryKey: ['order-receiving-enabled'] }))
        .catch((e: unknown) => setError(refusal(e))).finally(() => setBusy(false));
    }}>{t('receiving.enable')}</Checkbox>
    {flag.isError && <Button variant="outline" onClick={() => void flag.refetch()}>{t('receiving.retry')}</Button>}
    <FieldError>{error}</FieldError>
  </section>;
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
      lines: count ? count.lines.map((l) => ({ ...l, quantity: String(l.quantity) })) : Object.entries(quantities).filter(([, q]) => q !== '').map(([id, q]) => ({ item_id: id, quantity: q })),
      requestId: count?.id ?? requestId });
    setMessage(t(result.status === 'posted' ? 'receiving.posted' : 'receiving.waiting'));
    if (!count) { setQuantities({}); setRequestId(crypto.randomUUID()); }
  });
  const pending = orders.isPending || warehouses.isPending || keepers.isPending;
  const failure = orders.isError || warehouses.isError || keepers.isError;
  return <div className="space-y-6">
    <PageHeader title={t('receiving.title')} />
    <OrderReceivingSetting />
    {pending ? <ListState variant="loading" rows={3} /> : failure ? <div role="alert"><p>{t('receiving.loadError')}</p><Button variant="outline" onClick={() => { void orders.refetch(); void warehouses.refetch(); void keepers.refetch(); }}>{t('receiving.retry')}</Button></div> : <>
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField id="receipt-order" label={t('receiving.order')} value={orderId} onChange={(id) => { setSearch(id ? { order: id } : {}); setQuantities({}); setRequestId(crypto.randomUUID()); }} options={(orders.data ?? []).map((o) => ({ value: o.id, label: o.number }))} placeholder={t('receiving.chooseOrder')} />
        <SelectField id="receipt-warehouse" label={t('form.warehouse')} placeholder={t('form.warehousePlaceholder')} value={warehouse} onChange={setWarehouse} options={(warehouses.data ?? []).filter((w) => !w.archived_at).map((w) => ({ value: w.id, label: w.name }))} />
        <DateField id="receipt-date" label={t('receiving.date')} value={date || day.day || ''} onChange={setDate} />
      </div>
      {orders.data?.length === 0 && <p className="text-control text-muted-foreground">{t('receiving.noOrders')}</p>}
      {orderId && (order.isPending ? <ListState variant="loading" rows={3} /> : order.isError ? <div role="alert"><p>{t('receiving.loadError')}</p><Button variant="outline" onClick={() => void order.refetch()}>{t('receiving.retry')}</Button></div> : data && <>
        {data.purchaser && <section className="space-y-4">{data.lines.map((line) => <div key={line.id} className="grid items-end gap-3 border-b border-border pb-4 md:grid-cols-2">
          <div><h2 className="text-base font-semibold">{line.name}</h2><p className="text-control">{t('receiving.progress', { ordered: line.ordered, received: line.received, outstanding: line.outstanding })}</p><p className="text-control text-muted-foreground">{t(`receiving.${line.status}`)}</p></div>
          {editable ? <div className="space-y-2"><ItemPicker id={`mapping-${line.id}`} label={t('receiving.stockItem')} value={line.stock_item_id} onChange={(id) => void run(() => repository.map(line.id, id))} />{line.stock_item_id && !data.requests.some((r) => r.lines.some((l) => l.item_id === line.id)) && <Button variant="outline" disabled={busy} onClick={() => void run(() => repository.map(line.id, null))}>{t('receiving.clearMapping')}</Button>}</div> : <p>{line.stock_name}</p>}
        </div>)}</section>}
        <OrderReceivingLines lines={data.lines} quantities={quantities} disabled={busy || viewOnly} onChange={(id, q) => setQuantities((old) => ({ ...old, [id]: q }))} />
        {canReceive && <Button variant="primary" loading={busy} disabled={!warehouse || !(date || day.day) || !Object.values(quantities).some((q) => isPositiveDecimal(q)) || Object.values(quantities).some((q) => q !== '' && !isPositiveDecimal(q))} onClick={() => setConfirm(true)}>{t('receiving.record')}</Button>}
        <section className="space-y-4">{data.requests.map((count) => <div key={count.id} className="space-y-2 border-t border-border pt-4">
          <p className="text-control font-medium">{t(count.reversed ? 'receiving.reversed' : count.document_id ? 'receiving.posted' : count.approved ? 'receiving.approved' : 'receiving.waiting')}</p>
          <ul className="text-control">{count.lines.map((line) => <li key={line.item_id}>{data.lines.find((l) => l.id === line.item_id)?.name}: {line.quantity}</li>)}</ul>
          {count.document_id && <Link className="text-control text-primary underline" to={`/stock/documents/${count.document_id}`}>{t('receiving.openMovement')}</Link>}
          {!count.document_id && count.approved && count.receiver_id === user?.id && !viewOnly && <Button variant="outline" disabled={busy} onClick={() => void post(count)}>{t('receiving.recordApproved')}</Button>}
          {may('approve', 'orderReceiving', { currentUserId: user?.id, record: { viewOnly, receivingPurchaser: data.purchaser, created_by: count.receiver_id } }) && !count.reversed && (!count.document_id && !count.approved || count.document_id && may('post', 'stockDocument', { currentUserId: user?.id, record: { viewOnly, kind: 'adjustment', created_by: count.receiver_id } })) && <Button variant="outline" disabled={busy} onClick={() => { setReason(''); setDecision({ count, reverse: !!count.document_id }); }}>{t(count.document_id ? 'receiving.reverse' : 'receiving.approve')}</Button>}
        </div>)}</section>
      </>)}
    </>}
    <FieldError>{error}</FieldError><p role="status" className="text-control">{message}</p>
    <ConfirmDialog open={confirm} title={t('receiving.confirm')} description={t('receiving.confirmBody')} confirmLabel={t('receiving.record')} cancelLabel={t('receiving.cancel')} onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void post(); }} />
    <ConfirmDialog open={!!decision} title={t(decision?.reverse ? 'receiving.reverse' : 'receiving.approve')} description={<TextField id="receipt-decision-reason" label={t('receiving.reason')} value={reason} onChange={setReason} />} confirmLabel={t('receiving.confirmAction')} cancelLabel={t('receiving.cancel')} confirmDisabled={!reason.trim() || busy} onCancel={() => setDecision(null)} onConfirm={() => { if (!decision) return; const d = decision; setDecision(null); void run(() => d.reverse ? repository.reverse(d.count.id, reason) : repository.approve(d.count.id, reason)); }} />
  </div>;
}
