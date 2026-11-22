import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, FormActions, FormGrid, ListState, PageHeader, SelectField, TextField, MobileActionBar, useToast } from '@/src/components/ui';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { ItemPicker } from '@/src/components/stock/ItemPicker';
import { useStockErrorText } from '@/src/components/stock/useStockErrorText';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useStockKeepers, useStockUnits, useStockItems, useStockWarehouses } from '@/src/hooks/useStock';
import { useTransferRefresh, useIsTwoStep } from '@/src/hooks/useStockTransfers';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import { isPositiveDecimal, isWholeQuantity, normalizeDecimal } from '@/src/lib/stockFormat';
import { receiverCandidates } from '@/src/lib/stockReceivers';
import { stockTransfersRepository } from '@/src/lib/repositories/stockTransfers';

interface LineState { key: number; itemId: string | null; quantity: string }

/** Send: the first step of a two-step transfer. The stock leaves the source into transit; the receiver counts it on arrival. */
const StockTransferSend: React.FC = () => {
  const { t } = useTranslation('stock');
  const navigate = useNavigate();
  const { toast } = useToast();
  const errorText = useStockErrorText();
  const refresh = useTransferRefresh();
  const twoStep = useIsTwoStep();
  const { realRole, effectiveRole } = useEffectiveRole();
  const me = useAuth().currentUser?.id;
  const warehouses = useStockWarehouses(false);
  const keepers = useStockKeepers();
  const items = useStockItems(false);
  const units = useStockUnits(true);
  const profiles = useAssignableProfiles();
  const requestId = useRef(crypto.randomUUID());
  const nextKey = useRef(2);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [receiver, setReceiver] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineState[]>([{ key: 1, itemId: null, quantity: '' }]);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const isAdmin = realRole === 'Admin';
  const kept = useMemo(() => new Set((keepers.data ?? []).filter((k) => k.user_id === me).map((k) => k.warehouse_id)), [keepers.data, me]);
  const sources = useMemo(() => (warehouses.data ?? []).filter((w) => w.kind !== 'transit' && (isAdmin || kept.has(w.id))), [warehouses.data, isAdmin, kept]);
  const destinations = useMemo(() => (warehouses.data ?? []).filter((w) => w.kind !== 'transit' && w.id !== from), [warehouses.data, from]);
  const whole = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u.whole_only])), [units.data]);
  const itemById = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);
  // Who may be named: a keeper of the destination or a field account (the delivery addressed to me); never the sender.
  const candidates = useMemo(() => receiverCandidates(profiles.data ?? [], keepers.data ?? [], to, me ?? ''), [profiles.data, keepers.data, to, me]);
  const setLine = (key: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  if (!twoStep) return <div className="p-4"><ListState variant="empty" icon="folder" title={t('transfers.off.title')} sub={t('transfers.off.sub')} /></div>;
  if (realRole !== effectiveRole) return <div className="p-4"><ListState variant="empty" icon="folder" title={t('transfers.viewOnly')} /></div>;

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!from) next.from = t('form.errors.warehouse');
    if (!to) next.to = t('form.errors.toWarehouse');
    for (const l of lines) {
      const unitWhole = l.itemId ? whole.get(itemById.get(l.itemId)?.unit_id ?? '') : false;
      if (!l.itemId) next[`item${l.key}`] = t('form.errors.item');
      const q = normalizeDecimal(l.quantity);
      if (!isPositiveDecimal(q) || (unitWhole && !isWholeQuantity(q))) next[`qty${l.key}`] = t('form.errors.quantity');
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true); setError('');
    try {
      const id = await stockTransfersRepository.send({ fromWarehouseId: from, toWarehouseId: to, toUserId: receiver || null, note, lines: lines.map((l) => ({ itemId: l.itemId!, quantity: normalizeDecimal(l.quantity) })) }, requestId.current);
      await refresh();
      toast(t('transfers.sentToast'), '', 'success');
      navigate(`/stock/transfers/${id}`);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title={t('transfers.sendTitle')} />
      <form className="max-w-3xl space-y-4 pb-24 md:pb-0" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <FormErrorStrip>{error || undefined}</FormErrorStrip>
        <FormGrid>
          <SelectField label={t('form.fromWarehouse')} required value={from} onChange={setFrom} options={sources.map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` }))} placeholder={t('form.warehousePlaceholder')} error={errors.from} />
          <SelectField label={t('form.toWarehouse')} required value={to} onChange={(v) => { setTo(v); setReceiver(''); }} options={destinations.map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` }))} placeholder={t('form.warehousePlaceholder')} error={errors.to} />
          <SelectField label={t('transfers.receiver')} value={receiver} onChange={setReceiver} options={candidates.map((p) => ({ value: p.id, label: p.full_name ?? '' }))} placeholder={t('transfers.receiverNone')} helper={t('transfers.receiverHelp')} />
        </FormGrid>
        <ul className="space-y-3">{lines.map((l, i) => (
          <li key={l.key} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
            <ItemPicker label={`${t('form.item')}${i + 1}`} required value={l.itemId} onChange={(v) => setLine(l.key, { itemId: v })} error={errors[`item${l.key}`]} />
            <TextField label={`${t('form.quantity')}${i + 1}`} required inputMode="decimal" value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v })} error={errors[`qty${l.key}`]} />
            {lines.length > 1 && <Button variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>{t('form.removeLine')}</Button>}
          </li>
        ))}</ul>
        <Button variant="outline" onClick={() => setLines((ls) => [...ls, { key: nextKey.current++, itemId: null, quantity: '' }])}>{t('form.addLine')}</Button>
        <TextField label={t('form.note')} value={note} onChange={setNote} />
        <MobileActionBar className="fixed inset-x-0 bottom-[var(--phone-nav-height)] z-20 border-t border-border bg-card p-3 md:static md:border-0 md:bg-transparent md:p-0">
          <FormActions submitLabel={t('transfers.send')} cancelLabel={t('actions.cancel')} onCancel={() => navigate('/stock/transfers')} loading={busy} />
        </MobileActionBar>
      </form>
    </div>
  );
};
export default StockTransferSend;
