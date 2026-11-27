import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, FormActions, FormGrid, ListState, MobileActionBar, PageHeader, SelectField, TextField, useToast } from '@/src/components/ui';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { useStockErrorText } from '@/src/components/stock/useStockErrorText';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useIssuableProjects, useMyStockLocations, useStockWarehouses } from '@/src/hooks/useStock';
import { useProjectWorkOrdersForStock, useReturnable, useWoTransferRefresh } from '@/src/hooks/useStockWorkOrderTransfer';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { formatQuantity, isPositiveDecimal, normalizeDecimal } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { stockWorkOrderTransferRepository } from '@/src/lib/repositories/stockWorkOrderTransfer';

interface LineState { key: number; itemId: string; quantity: string }
const PROJECT_KINDS = new Set(['site', 'yard', 'staging']);
const woLabel = (w: { wo_number?: string | null; title?: string | null; id: string }): string => [w.wo_number, w.title].filter(Boolean).join(' - ') || w.id;

/** Move leftover from one work order to another: a return from the first and an issue to the second, one document (#2691). Off until an Admin turns it on. */
const StockWorkOrderTransfer: React.FC = () => {
  const { t } = useTranslation('stock');
  const navigate = useNavigate();
  const { toast } = useToast();
  const errorText = useStockErrorText();
  const refresh = useWoTransferRefresh();
  const enabled = useOrgSwitch('stockWoTransfers').data === true;
  const { realRole, effectiveRole } = useEffectiveRole();
  const projects = useIssuableProjects();
  const warehouses = useStockWarehouses(false);
  const requestId = useRef(crypto.randomUUID());
  const nextKey = useRef(2);
  const [projectId, setProjectId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineState[]>([{ key: 1, itemId: '', quantity: '' }]);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const workOrders = useProjectWorkOrdersForStock(projectId || undefined);
  const returnable = useReturnable(from || undefined);
  const loc = getNumberLocale();
  const isAdmin = realRole === 'Admin';
  const mine = useMyStockLocations();
  const wos = useMemo(() => (workOrders.data ?? []).filter((w) => w.status !== 'Cancelled'), [workOrders.data]);
  const places = useMemo(
    () => (warehouses.data ?? []).filter((w) => PROJECT_KINDS.has(w.kind) && (w as { project_id?: string | null }).project_id === projectId && (isAdmin || mine.keeps(w.id))),
    [warehouses.data, projectId, isAdmin, mine],
  );
  const held = useMemo(() => new Map((returnable.data ?? []).map((r) => [r.itemId, r])), [returnable.data]);
  const setLine = (key: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const toName = wos.find((w) => w.id === to);

  if (!enabled) return <div className="p-4"><ListState variant="empty" icon="folder" title={t('workOrderTransfer.off.title')} sub={t('workOrderTransfer.off.sub')} /></div>;
  if (realRole !== effectiveRole) return <div className="p-4"><ListState variant="empty" icon="folder" title={t('transfers.viewOnly')} /></div>;

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!projectId) next.project = t('workOrderTransfer.errors.project');
    if (!from) next.from = t('workOrderTransfer.errors.from');
    if (!to) next.to = t('workOrderTransfer.errors.to');
    if (from && to && from === to) next.to = t('workOrderTransfer.errors.same');
    if (!location) next.location = t('workOrderTransfer.errors.location');
    const seen = new Set<string>();
    for (const l of lines) {
      if (!l.itemId) next[`item${l.key}`] = t('form.errors.item');
      else if (seen.has(l.itemId)) next[`item${l.key}`] = t('workOrderTransfer.errors.duplicate');
      seen.add(l.itemId);
      const q = normalizeDecimal(l.quantity);
      if (!isPositiveDecimal(q)) next[`qty${l.key}`] = t('form.errors.quantity');
      else if (l.itemId && held.has(l.itemId) && Number(q) > Number(held.get(l.itemId)!.quantity)) {
        next[`qty${l.key}`] = t('workOrderTransfer.errors.exceeds', { qty: formatQuantity(held.get(l.itemId)!.quantity, loc) });
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const id = await stockWorkOrderTransferRepository.post({
        warehouseId: location, fromWorkOrderId: from, toWorkOrderId: to, note, disciplineId: null,
        lines: lines.map((l) => ({ itemId: l.itemId, quantity: normalizeDecimal(l.quantity), boqItemId: held.get(l.itemId)?.boqItemId ?? null })),
      }, requestId.current);
      await refresh();
      toast(t('workOrderTransfer.postedToast'), '', 'success');
      navigate(`/stock/work-order-transfer/${id}`);
    } catch (err) { setError(errorText(err)); setConfirm(false); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title={t('workOrderTransfer.title')} help={<p>{t('workOrderTransfer.intro')}</p>} />
      <form className="max-w-3xl space-y-4 pb-24 md:pb-0" onSubmit={(e) => { e.preventDefault(); if (validate()) setConfirm(true); }} noValidate>
        <FormErrorStrip>{error || undefined}</FormErrorStrip>
        <FormGrid>
          <SelectField label={t('workOrderTransfer.project')} required value={projectId} onChange={(v) => { setProjectId(v); setFrom(''); setTo(''); setLocation(''); setLines([{ key: nextKey.current++, itemId: '', quantity: '' }]); }}
            options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))} placeholder={t('workOrderTransfer.projectPlaceholder')} error={errors.project} />
          <SelectField label={t('workOrderTransfer.from')} required value={from} onChange={(v) => { setFrom(v); setLines([{ key: nextKey.current++, itemId: '', quantity: '' }]); }}
            options={wos.map((w) => ({ value: w.id, label: woLabel(w) }))} placeholder={t('workOrderTransfer.woPlaceholder')} error={errors.from} />
          <SelectField label={t('workOrderTransfer.to')} required value={to} onChange={setTo}
            options={wos.filter((w) => w.id !== from).map((w) => ({ value: w.id, label: woLabel(w) }))} placeholder={t('workOrderTransfer.woPlaceholder')} error={errors.to} />
          <SelectField label={t('workOrderTransfer.location')} required value={location} onChange={setLocation} helper={t('workOrderTransfer.locationHelp')}
            options={places.map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` }))} placeholder={t('form.warehousePlaceholder')} error={errors.location} />
        </FormGrid>
        {from && returnable.data && returnable.data.length === 0 && <p role="status" className="text-sm">{t('workOrderTransfer.nothingHeld')}</p>}
        <ul className="space-y-3">{lines.map((l, i) => {
          const h = l.itemId ? held.get(l.itemId) : undefined;
          return (
            <li key={l.key} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
              <SelectField label={`${t('form.item')}${i + 1}`} required value={l.itemId} onChange={(v) => setLine(l.key, { itemId: v })}
                options={(returnable.data ?? []).map((r) => ({ value: r.itemId, label: `${r.itemCode} - ${r.itemName}` }))} placeholder={t('workOrderTransfer.itemPlaceholder')}
                helper={h ? t('workOrderTransfer.available', { qty: formatQuantity(h.quantity, loc), unit: h.unitCode }) : undefined} error={errors[`item${l.key}`]} />
              <TextField label={`${t('form.quantity')}${i + 1}`} required inputMode="decimal" value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v })} error={errors[`qty${l.key}`]} />
              {lines.length > 1 && <Button variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>{t('form.removeLine')}</Button>}
            </li>);
        })}</ul>
        <Button variant="outline" onClick={() => setLines((ls) => [...ls, { key: nextKey.current++, itemId: '', quantity: '' }])}>{t('form.addLine')}</Button>
        <TextField label={t('form.note')} value={note} onChange={setNote} />
        <MobileActionBar className="fixed inset-x-0 bottom-[var(--phone-nav-height)] z-20 border-t border-border bg-card p-3 md:static md:border-0 md:bg-transparent md:p-0">
          <FormActions submitLabel={t('workOrderTransfer.move')} cancelLabel={t('actions.cancel')} onCancel={() => navigate('/stock/documents')} loading={busy} />
        </MobileActionBar>
      </form>
      <ConfirmDialog
        open={confirm}
        title={t('workOrderTransfer.confirm.title', { to: toName ? woLabel(toName) : '' })}
        description={t('workOrderTransfer.confirm.description')}
        confirmLabel={t('workOrderTransfer.move')}
        loading={busy}
        onConfirm={() => void submit()}
        onCancel={() => { if (!busy) setConfirm(false); }}
      />
    </div>
  );
};
export default StockWorkOrderTransfer;
