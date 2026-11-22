import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ListState, PageHeader, SelectField, TextField, useToast } from '@/src/components/ui';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { HandoverCapture } from '@/src/components/stock/HandoverCapture';
import { buildConfirmation, emptyHandover, isHandoverComplete, type HandoverValue } from '@/src/components/stock/handoverValue';
import { useStockErrorText } from '@/src/components/stock/useStockErrorText';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import { useStockItems, useStockWarehouses } from '@/src/hooks/useStock';
import { useDeliveryNoteSettings } from '@/src/hooks/useMaterialRequests';
import { useStockTags } from '@/src/hooks/useStockSiteWork';
import { useProofStatus, useStockTransfer, useTransferConfirmations, useTransferRefresh, useTransferSettings } from '@/src/hooks/useStockTransfers';
import { useOperationalWaitingRoute, operationalWaitingForText } from '@/src/hooks/useOperationalWaitingRoute';
import { formatDateTime } from '@/src/lib/format';
import { formatQuantity, normalizeDecimal } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { stockTransfersRepository as repo, type ProofRule, type QualityResult, type ShortResolution, type StockTransfer, type StockTransferLine } from '@/src/lib/repositories/stockTransfers';

interface Count { counted: string; accepted: string; reason: string; quality: QualityResult | '' }
const ruleOf = (tag: { proof_required?: string; paper_required: boolean }): ProofRule => (tag.proof_required as ProofRule | undefined) ?? (tag.paper_required ? 'paper' : 'none');
const flagged = (item: object | undefined): boolean => (item as { needs_quality_check?: boolean } | undefined)?.needs_quality_check === true;

const text = (v: string | number | null): string | null => (v === null ? null : String(v));
const stringQuantities = (t: StockTransfer): StockTransfer => ({ ...t, lines: t.lines.map((l) => ({ ...l, qtySent: String(l.qtySent), qtyCounted: text(l.qtyCounted), qtyAccepted: text(l.qtyAccepted), qtyRejected: text(l.qtyRejected) })) });

/** One transfer: its counts, the receive form (count, accept or reject, quality, handover confirmation), shortfall resolution and the confirmations on record. */
const StockTransferDetail: React.FC = () => {
  const { t } = useTranslation('stock');
  const { transferId } = useParams<{ transferId: string }>();
  const { toast } = useToast();
  const errorText = useStockErrorText();
  const refresh = useTransferRefresh();
  const { realRole, effectiveRole } = useEffectiveRole();
  const me = useAuth().currentUser;
  const q = useStockTransfer(transferId);
  // A Sent transfer waits on its named receiver or a keeper of its destination — never its sender, and never every
  // senior role that could technically receive it (1560/1308). Only fetched while Sent.
  const waitingRoute = useOperationalWaitingRoute('transfer_receipt', transferId, q.data?.status === 'Sent');
  const confirmations = useTransferConfirmations(transferId);
  const proof = useProofStatus();
  const settings = useTransferSettings();
  const deliveryNotes = useDeliveryNoteSettings();
  const items = useStockItems(true);
  const tags = useStockTags(true);
  const warehouses = useStockWarehouses(true);
  const profiles = useAssignableProfiles();
  const [counts, setCounts] = useState<Record<string, Count>>({});
  const [handover, setHandover] = useState<HandoverValue>(emptyHandover());
  const [withHandover, setWithHandover] = useState(false);
  const [late, setLate] = useState<HandoverValue>(emptyHandover());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const transfer = q.data ? stringQuantities(q.data) : q.data;   // a numeric column can arrive as a JSON number; the formatters take strings
  const itemById = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);
  const tagById = useMemo(() => new Map((tags.data ?? []).map((g) => [g.id, g])), [tags.data]);
  if (q.isPending) return <ListState variant="loading" rows={4} />;
  if (q.isError) return <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => void q.refetch()} />;
  if (!transfer) return <ListState variant="empty" icon="folder" title={t('transfers.notFound')} />;

  const loc = getNumberLocale();
  const wh = (id: string) => (warehouses.data ?? []).find((w) => w.id === id)?.name ?? '';
  const person = (id: string | null) => (id ? (profiles.data ?? []).find((p) => p.id === id)?.full_name ?? '' : '');
  const item = (l: StockTransferLine) => { const i = itemById.get(l.itemId); return i ? `${i.code} - ${i.name}` : ''; };
  const viewOnly = realRole !== effectiveRole;
  const isAdmin = realRole === 'Admin';
  const countOf = (l: StockTransferLine): Count => counts[l.id] ?? { counted: l.qtySent, accepted: l.qtySent, reason: '', quality: '' };
  const setCount = (l: StockTransferLine, patch: Partial<Count>) => setCounts((c) => ({ ...c, [l.id]: { ...countOf(l), ...patch } }));
  const rules = new Set<ProofRule>(transfer.lines.map((l) => { const tag = tagById.get(itemById.get(l.itemId)?.tag_id ?? ''); return tag ? ruleOf(tag as never) : 'none'; }).filter((r) => r !== 'none'));
  const needsProof = rules.size > 0;
  const blocking = needsProof && settings.data?.proofTiming !== 'may_follow';
  const proofRow = (proof.data ?? []).find((p) => p.movementId === transfer.id);
  const openShort = transfer.lines.filter((l) => l.qtyCounted !== null && l.qtyCounted !== l.qtySent && l.shortResolution === null);
  const mine = me?.id === transfer.sentBy;
  // The sender never counts their own shipment (a second person recounts); only an Admin may, and the database audits it (STK_SELF_RECEIVE).
  const canCount = !mine || isAdmin;
  // The summary already names the addressed receiver; only the extra people (a destination keeper when the transfer is
  // unassigned or the addressed person is not the keeper) are added, so the same name never appears twice.
  const waitingOthers = waitingRoute.data
    ? { approvers: waitingRoute.data.approvers.filter((p) => p.id !== transfer.toUserId), routeKind: waitingRoute.data.routeKind }
    : undefined;
  const waitingText = operationalWaitingForText(waitingOthers, t, { empty: 'none' });
  const waitingFailed = waitingRoute.isError && !transfer.toUserId;

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true); setError('');
    try { await fn(); await refresh(); toast(done, '', 'success'); setReason(''); setWithHandover(false); setHandover(emptyHandover()); setLate(emptyHandover()); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  const receive = () => run(async () => {
    const confirmation = withHandover ? await buildConfirmation(me!.org_id, transfer.id, handover, 'receive') : null;
    await repo.receive(transfer.id, transfer.lines.map((l) => { const c = countOf(l); return { lineId: l.id, counted: normalizeDecimal(c.counted), accepted: normalizeDecimal(c.accepted), rejectReason: c.reason, qualityResult: c.quality === '' ? null : c.quality }; }), confirmation);
  }, t('transfers.receivedToast'));
  const addProof = () => run(async () => {
    const stage = transfer.status === 'Sent' ? 'send' : 'receive';
    await repo.recordHandover(transfer.id, { ...(await buildConfirmation(me!.org_id, transfer.id, late, stage)), stage });
  }, t('transfers.proofAddedToast'));
  const valid = transfer.lines.every((l) => { const c = countOf(l); return c.counted !== '' && c.accepted !== '' && (!flagged(itemById.get(l.itemId)) || c.quality !== ''); });
  const canSubmit = valid && !busy && (!withHandover || isHandoverComplete(handover)) && (!blocking || (withHandover && isHandoverComplete(handover)));

  return (
    <div className="max-w-3xl space-y-4 pb-24 md:pb-0">
      <PageHeader title={`${t('transfers.detailTitle')} ${transfer.number}`} />
      <p className="flex flex-wrap items-center gap-x-4 text-sm text-muted-foreground">
        <Link to="/stock/transfers">{t('transfers.back')}</Link>
        {deliveryNotes.data?.enabled && <Link to={`/stock/transfers/${transfer.id}/print`} className="font-medium text-foreground underline">{t('transfers.print.action')}</Link>}
      </p>
      <section className="space-y-1 rounded-lg border border-border p-4" aria-label={t('transfers.summary')}>
        <div>{wh(transfer.fromWarehouseId)} → {wh(transfer.toWarehouseId)}</div>
        <div className="text-sm text-muted-foreground">{t(`transfers.status.${transfer.status}`)} · {t('transfers.sentBy', { name: person(transfer.sentBy), at: formatDateTime(new Date(transfer.sentAt)) })}</div>
        {transfer.toUserId && <div className="text-sm text-muted-foreground">{t('transfers.addressedTo', { name: person(transfer.toUserId) })}</div>}
        {transfer.status === 'Sent' && waitingFailed && (
          <div data-testid="transfer-waiting" className="text-sm text-muted-foreground">
            <button type="button" onClick={() => void waitingRoute.refetch()} className="font-medium text-primary-text hover:underline">{t('actions.retry')}</button>
          </div>
        )}
        {transfer.status === 'Sent' && waitingText && (
          <div data-testid="transfer-waiting" className="text-sm text-muted-foreground">{waitingText}</div>
        )}
        {transfer.receivedAt && <div className="text-sm text-muted-foreground">{t('transfers.receivedBy', { name: person(transfer.receivedBy), at: formatDateTime(new Date(transfer.receivedAt)) })}</div>}
        {transfer.cancelReason && <div className="text-sm">{t('transfers.recalled', { reason: transfer.cancelReason })}</div>}
        {proofRow && <div className="text-sm font-medium">{proofRow.proofStatus === 'complete' ? t('proof.complete') : t('proof.outstandingMissing', { missing: proofRow.missing?.split(',').map((m) => t(`proof.rule.${m}`)).join(', ') })}</div>}
      </section>
      <FormErrorStrip>{error || undefined}</FormErrorStrip>

      {transfer.status === 'Sent' && !viewOnly && canCount ? (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (canSubmit) void receive(); }} noValidate>
          <h2 className="text-base font-semibold">{t('transfers.receiveTitle')}</h2>
          <ul className="space-y-3">{transfer.lines.map((l) => { const c = countOf(l); const rejected = Number(normalizeDecimal(c.counted) || 0) - Number(normalizeDecimal(c.accepted) || 0); const f = flagged(itemById.get(l.itemId)); return (
            <li key={l.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="font-medium">{item(l)}</div>
              <div className="text-sm text-muted-foreground">{t('transfers.sentQty', { qty: formatQuantity(l.qtySent, loc) })}</div>
              <div className="grid grid-cols-2 gap-3">
                <TextField id={`counted-${l.id}`} label={t('transfers.counted')} inputMode="decimal" value={c.counted} onChange={(v) => setCount(l, { counted: v, accepted: c.accepted === c.counted ? v : c.accepted })} required />
                <TextField id={`accepted-${l.id}`} label={t('transfers.accepted')} inputMode="decimal" value={c.accepted} onChange={(v) => setCount(l, { accepted: v })} required />
              </div>
              {rejected > 0 && <TextField id={`reason-${l.id}`} label={t('transfers.rejectReason')} value={c.reason} onChange={(v) => setCount(l, { reason: v })} required />}
              {f && <SelectField label={t('transfers.quality')} required value={c.quality} onChange={(v) => setCount(l, { quality: v as QualityResult, accepted: v === 'fail' ? '0' : c.accepted })} options={[{ value: 'pass', label: t('transfers.qualityPass') }, { value: 'fail', label: t('transfers.qualityFail') }]} placeholder={t('transfers.qualityChoose')} />}
              {Number(normalizeDecimal(c.counted) || 0) < Number(l.qtySent) && <p className="text-sm">{t('transfers.shortNote', { qty: formatQuantity(String(Number(l.qtySent) - Number(normalizeDecimal(c.counted) || 0)), loc) })}</p>}
            </li>); })}</ul>
          {needsProof && <p className="text-sm">{blocking ? t('proof.requiredNow', { rules: [...rules].map((r) => t(`proof.rule.${r}`)).join(', ') }) : t('proof.mayFollow')}</p>}
          <Checkbox label={t('handover.confirmNow')} checked={withHandover || blocking} disabled={blocking} onChange={(c) => setWithHandover(c === true)}>{t('handover.confirmNow')}</Checkbox>
          {(withHandover || blocking) && <HandoverCapture idPrefix="receive" value={handover} onChange={(v) => { setHandover(v); setWithHandover(true); }} signerName={me?.full_name ?? ''} proofs={['in_app', 'paper']} />}
          <div className="fixed inset-x-0 bottom-[var(--phone-nav-height)] z-20 border-t border-border bg-card p-3 md:static md:border-0 md:bg-transparent md:p-0">
            <Button variant="primary" type="submit" disabled={!canSubmit} loading={busy}>{t('transfers.receiveAction')}</Button>
          </div>
        </form>
      ) : (
        <section aria-label={t('transfers.lines')} className="space-y-2">
          {transfer.status === 'Sent' && !viewOnly && !canCount && <p className="rounded-lg border border-border p-3 text-sm" role="status">{t('transfers.senderWaits')}</p>}
          <h2 className="text-base font-semibold">{t('transfers.lines')}</h2>
          <ul className="space-y-2">{transfer.lines.map((l) => (
            <li key={l.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="font-medium">{item(l)}</div>
              <div>{t('transfers.sentQty', { qty: formatQuantity(l.qtySent, loc) })}{l.qtyCounted !== null && ` · ${t('transfers.countedQty', { qty: formatQuantity(l.qtyCounted, loc) })} · ${t('transfers.acceptedQty', { qty: formatQuantity(l.qtyAccepted ?? '0', loc) })}`}</div>
              {l.qtyRejected !== null && Number(l.qtyRejected) > 0 && <div>{t('transfers.rejectedQty', { qty: formatQuantity(l.qtyRejected, loc), reason: l.rejectReason ?? '' })}</div>}
              {l.shortResolution && <div>{t(`transfers.resolution.${l.shortResolution}`)}{l.shortReason ? ` · ${l.shortReason}` : ''}</div>}
            </li>))}</ul>
        </section>
      )}

      {transfer.status === 'Received' && openShort.length > 0 && !viewOnly && (
        <section aria-label={t('transfers.shortfalls')} className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="text-base font-semibold">{t('transfers.shortfalls')}</h2>
          <TextField id="short-reason" label={t('transfers.shortReason')} value={reason} onChange={setReason} />
          <ul className="space-y-3">{openShort.map((l) => (
            <li key={l.id} className="space-y-2">
              <div>{item(l)}: {t('transfers.shortQty', { qty: formatQuantity(String(Number(l.qtySent) - Number(l.qtyCounted)), loc) })}</div>
              <div className="flex flex-wrap gap-2">{(['delivered', 'returned', ...(isAdmin ? ['written_off'] : [])] as ShortResolution[]).map((r) => (
                <Button key={r} variant={r === 'written_off' ? 'ghost' : 'outline'} disabled={busy || (r === 'written_off' && !reason.trim())} onClick={() => void run(() => repo.resolveShortfall(l.id, r, reason), t('transfers.resolvedToast'))}>{t(`transfers.resolveAs.${r}`)}</Button>))}</div>
            </li>))}</ul>
        </section>
      )}

      {transfer.status === 'Sent' && !viewOnly && (mine || isAdmin) && (
        <section aria-label={t('transfers.recallTitle')} className="space-y-2 rounded-lg border border-border p-4">
          <TextField id="recall-reason" label={t('transfers.recallReason')} value={reason} onChange={setReason} />
          <Button variant="outline" disabled={busy || !reason.trim()} onClick={() => void run(() => repo.recall(transfer.id, reason), t('transfers.recalledToast'))}>{t('transfers.recallAction')}</Button>
        </section>
      )}

      <section aria-label={t('handover.recorded')} className="space-y-2">
        <h2 className="text-base font-semibold">{t('handover.recorded')}</h2>
        {(confirmations.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{t('handover.none')}</p> : (
          <ul className="space-y-2">{(confirmations.data ?? []).map((c) => (
            <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="font-medium">{c.signerName}{c.signerKind === 'guest' ? ` (${t('handover.guestBadge')})` : ''}</div>
              <div className="text-muted-foreground">{t(`handover.stage.${c.stage}`)} · {t(c.proofType === 'paper' ? 'handover.proofPaper' : 'handover.proofInApp')} · {formatDateTime(new Date(c.confirmedAt))} · {t('handover.recordedBy', { name: person(c.recordedBy) })}</div>
            </li>))}</ul>)}
        {proofRow?.proofStatus === 'outstanding' && transfer.status !== 'Cancelled' && !viewOnly && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold">{t('proof.addTitle')}</h3>
            <HandoverCapture idPrefix="late" value={late} onChange={setLate} signerName={me?.full_name ?? ''} />
            <Button variant="primary" disabled={busy || !isHandoverComplete(late)} onClick={() => void addProof()}>{t('proof.addAction')}</Button>
          </div>)}
      </section>
    </div>
  );
};
export default StockTransferDetail;
