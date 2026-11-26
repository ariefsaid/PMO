import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, DataTable, FormGrid, ListState, ReasonDialog, RecordHeader, RecordSection, RecordStack, SelectField, StatusPill, TextField, useToast, type Column } from '@/src/components/ui';
import { buttonClasses } from '@/src/components/ui/buttonClasses';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { HandoverCapture } from '@/src/components/stock/HandoverCapture';
import { HandoverPhotos } from '@/src/components/stock/HandoverPhotos';
import { buildConfirmation, emptyHandover, isHandoverComplete, type HandoverValue } from '@/src/components/stock/handoverValue';
import { useStockErrorText } from '@/src/components/stock/useStockErrorText';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import { useStockItems, useStockUnits, useStockWarehouses } from '@/src/hooks/useStock';
import { useDeliveryNoteSettings } from '@/src/hooks/useMaterialRequests';
import { useStockTags } from '@/src/hooks/useStockSiteWork';
import { useProofStatus, useStockTransfer, useTransferConfirmations, useTransferRefresh, useTransferSettings } from '@/src/hooks/useStockTransfers';
import { useOperationalWaitingRoute, operationalWaitingForText } from '@/src/hooks/useOperationalWaitingRoute';
import { useRoleOptions } from '@/src/hooks/useRoleOptions';
import { formatDecisionDateTime } from '@/src/lib/format';
import { TRANSFER_VARIANT, openShortfalls } from './transferStatus';
import { formatQuantity, normalizeDecimal } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { stockTransfersRepository as repo, type ProofRule, type QualityResult, type ShortResolution, type StockTransfer, type StockTransferLine } from '@/src/lib/repositories/stockTransfers';

interface Count { counted: string; accepted: string; reason: string; quality: QualityResult | '' }
const ruleOf = (tag: { proof_required?: string; paper_required: boolean }): ProofRule => (tag.proof_required as ProofRule | undefined) ?? (tag.paper_required ? 'paper' : 'none');
const flagged = (item: object | undefined): boolean => (item as { needs_quality_check?: boolean } | undefined)?.needs_quality_check === true;

const text = (v: string | number | null): string | null => (v === null ? null : String(v));
const stringQuantities = (t: StockTransfer): StockTransfer => ({ ...t, lines: t.lines.map((l) => ({ ...l, qtySent: String(l.qtySent), qtyCounted: text(l.qtyCounted), qtyAccepted: text(l.qtyAccepted), qtyRejected: text(l.qtyRejected) })) });

/**
 * One transfer. Header: number, state, route and who sent / receives it (the Summary region); print and recall in its
 * action zone. Then ONE table of the lines (receiving: the counts as inputs; on record: sent, counted, accepted, rejected
 * in their own columns), the open shortfalls to decide, and the handover confirmations on record.
 */
const StockTransferDetail: React.FC = () => {
  const { t } = useTranslation(['stock', 'waitingList']);
  const { transferId } = useParams<{ transferId: string }>();
  const { toast } = useToast();
  const errorText = useStockErrorText();
  const refresh = useTransferRefresh();
  const { realRole, effectiveRole } = useEffectiveRole();
  const me = useAuth().currentUser;
  const q = useStockTransfer(transferId);
  // A Sent transfer is ASSIGNED to its addressed receiver or a full keeper of its destination — never its sender, and
  // never every senior role that could technically receive it (1560/1308). Only fetched while Sent.
  const waitingRoute = useOperationalWaitingRoute('transfer_receipt', transferId, q.data?.status === 'Sent');
  const { label: roleLabel } = useRoleOptions();
  const confirmations = useTransferConfirmations(transferId);
  const proof = useProofStatus();
  const settings = useTransferSettings();
  const deliveryNotes = useDeliveryNoteSettings();
  const items = useStockItems(true);
  const tags = useStockTags(true);
  const warehouses = useStockWarehouses(true);
  const units = useStockUnits(true);
  const profiles = useAssignableProfiles();
  const [counts, setCounts] = useState<Record<string, Count>>({});
  const [handover, setHandover] = useState<HandoverValue>(emptyHandover());
  const [withHandover, setWithHandover] = useState(false);
  const [late, setLate] = useState<HandoverValue>(emptyHandover());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recalling, setRecalling] = useState(false);
  const transfer = q.data ? stringQuantities(q.data) : q.data;   // a numeric column can arrive as a JSON number; the formatters take strings
  const itemById = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);
  const tagById = useMemo(() => new Map((tags.data ?? []).map((g) => [g.id, g])), [tags.data]);
  const unitCode = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u.code])), [units.data]);
  if (q.isPending) return <ListState variant="loading" rows={4} />;
  if (q.isError) return <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => void q.refetch()} />;
  if (!transfer) return <ListState variant="empty" icon="folder" title={t('transfers.notFound')} />;

  const loc = getNumberLocale();
  const wh = (id: string) => (id === transfer.fromWarehouseId ? transfer.fromWarehouseName : id === transfer.toWarehouseId ? transfer.toWarehouseName : undefined) ?? (warehouses.data ?? []).find((w) => w.id === id)?.name ?? '';
  const person = (id: string | null) => (id ? (profiles.data ?? []).find((p) => p.id === id)?.full_name ?? '' : '');
  const item = (l: StockTransferLine) => { const i = itemById.get(l.itemId); return l.itemName ?? (i ? `${i.code} - ${i.name}` : ''); };
  const viewOnly = realRole !== effectiveRole;
  const isAdmin = realRole === 'Admin';
  const countOf = (l: StockTransferLine): Count => counts[l.id] ?? { counted: l.qtySent, accepted: l.qtySent, reason: '', quality: '' };
  const setCount = (l: StockTransferLine, patch: Partial<Count>) => setCounts((c) => ({ ...c, [l.id]: { ...countOf(l), ...patch } }));
  const rules = new Set<ProofRule>(transfer.lines.map((l) => { const tag = tagById.get(itemById.get(l.itemId)?.tag_id ?? ''); return l.proofRule ?? (tag ? ruleOf(tag as never) : 'none'); }).filter((r) => r !== 'none'));
  const needsProof = rules.size > 0;
  const blocking = needsProof && settings.data?.proofTiming !== 'may_follow';
  const proofRow = (proof.data ?? []).find((p) => p.movementId === transfer.id);
  const openShort = openShortfalls(transfer);
  const mine = me?.id === transfer.sentBy;
  // The sender never counts their own shipment (a second person recounts); only an Admin may, and the database audits it (STK_SELF_RECEIVE).
  const canCount = !mine || isAdmin;
  // The summary already names the addressed receiver; only the extra people (a destination keeper when the transfer is
  // unassigned or the addressed person is not the keeper) are added, so the same name never appears twice. The role
  // word is the person's actual role, never a static "keeper" label.
  const waitingOthers = waitingRoute.data
    ? { approvers: waitingRoute.data.approvers.filter((p) => p.id !== transfer.toUserId), routeKind: waitingRoute.data.routeKind }
    : undefined;
  const waitingText = operationalWaitingForText(waitingOthers, t, { roleLabel, empty: 'none' });
  // An error is surfaced whenever the read failed: the summary names only the addressed person, so the extra people
  // are unknown until the read succeeds.
  const waitingFailed = waitingRoute.isError;

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
  const valid = transfer.lines.every((l) => { const c = countOf(l); return c.counted !== '' && c.accepted !== '' && (!(l.needsQualityCheck ?? flagged(itemById.get(l.itemId))) || c.quality !== ''); });
  const canSubmit = valid && !busy && (!withHandover || isHandoverComplete(handover)) && (!blocking || (withHandover && isHandoverComplete(handover)));

  const unitOf = (l: StockTransferLine) => unitCode.get(itemById.get(l.itemId)?.unit_id ?? '') ?? '';
  const qty = (v: string | null | undefined, l: StockTransferLine) => v === null || v === undefined
    ? <span className="text-muted-foreground">—</span>
    : <span className="whitespace-nowrap tabular-nums">{formatQuantity(v, loc)}{unitOf(l) && <span className="text-muted-foreground"> {unitOf(l)}</span>}</span>;
  const receiving = transfer.status === 'Sent' && !viewOnly && canCount;
  const rejectedOf = (c: Count) => Number(normalizeDecimal(c.counted) || 0) - Number(normalizeDecimal(c.accepted) || 0);
  const shortOf = (l: StockTransferLine, c: Count) => Number(l.qtySent) - Number(normalizeDecimal(c.counted) || 0);
  const flaggedLine = (l: StockTransferLine) => l.needsQualityCheck ?? flagged(itemById.get(l.itemId));
  const unitSlot = (l: StockTransferLine) => <span className="w-8 shrink-0 text-left text-control text-muted-foreground">{unitOf(l)}</span>;
  const lineColumn: Column<StockTransferLine> = { key: 'item', header: t('form.item'), rowHeader: true, cell: (l) => <span className="break-words font-medium text-foreground">{item(l)}</span> };
  const sentColumn: Column<StockTransferLine> = { key: 'sent', header: t('transfers.columns.sent'), align: 'num', size: 136, cell: (l) => qty(l.qtySent, l) };
  // Receiving: one row per line, the two counts as inputs on one right edge; the unit sits after each input.
  const receiveColumns: Column<StockTransferLine>[] = [lineColumn, sentColumn,
    { key: 'counted', header: t('transfers.counted'), align: 'num', keepWhenBlank: true, size: 168, cell: (l) => { const c = countOf(l); return <span className="inline-flex flex-nowrap items-center justify-end gap-2 align-middle">
      <TextField id={`counted-${l.id}`} hideLabel label={t('transfers.counted')} inputMode="decimal" value={c.counted} onChange={(v) => setCount(l, { counted: v, accepted: c.accepted === c.counted ? v : c.accepted })} required wrapperClassName="w-24" className="text-right tabular-nums" />
      {unitSlot(l)}</span>; } },
    { key: 'accepted', header: t('transfers.accepted'), align: 'num', keepWhenBlank: true, size: 168, cell: (l) => { const c = countOf(l); return <span className="inline-flex flex-nowrap items-center justify-end gap-2 align-middle">
      <TextField id={`accepted-${l.id}`} hideLabel label={t('transfers.accepted')} inputMode="decimal" value={c.accepted} onChange={(v) => setCount(l, { accepted: v })} required wrapperClassName="w-24" className="text-right tabular-nums" />
      {unitSlot(l)}</span>; } },
  ];
  // On record: sent, counted, accepted and rejected each in their own column; the reason and the shortfall's outcome as text.
  const recordColumns: Column<StockTransferLine>[] = [lineColumn, sentColumn,
    { key: 'counted', header: t('transfers.counted'), align: 'num', size: 128, cell: (l) => qty(l.qtyCounted, l) },
    { key: 'accepted', header: t('transfers.accepted'), align: 'num', size: 128, cell: (l) => qty(l.qtyAccepted, l) },
    { key: 'rejected', header: t('transfers.columns.rejected'), align: 'num', size: 128, cell: (l) => (l.qtyRejected !== null && Number(l.qtyRejected) > 0 ? qty(l.qtyRejected, l) : null) },
    { key: 'note', header: t('transfers.columns.note'), size: 240, cell: (l) => {
      const parts = [
        ...(l.qtyRejected !== null && Number(l.qtyRejected) > 0 && l.rejectReason ? [l.rejectReason] : []),
        ...(l.shortResolution ? [`${t(`transfers.resolution.${l.shortResolution}`)}${l.shortReason ? ` · ${l.shortReason}` : ''}`] : []),
      ];
      return parts.length > 0 ? <span className="break-words">{parts.join(' · ')}</span> : null;
    } },
  ];
  const checks = receiving ? transfer.lines.filter((l) => rejectedOf(countOf(l)) > 0 || flaggedLine(l) || shortOf(l, countOf(l)) > 0) : [];
  const recallItems = transfer.status === 'Sent' && !viewOnly && (mine || isAdmin) ? [{ key: 'recall', label: t('transfers.recallAction'), danger: true, onSelect: () => { setError(''); setRecalling(true); } }] : [];
  const facts = (
    <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="text-foreground">{wh(transfer.fromWarehouseId)} → {wh(transfer.toWarehouseId)}</span>
      <span>{t('transfers.sentBy', { name: person(transfer.sentBy), at: formatDecisionDateTime(new Date(transfer.sentAt)) })}</span>
      {transfer.toUserId && <span>{t('transfers.addressedTo', { name: person(transfer.toUserId) })}</span>}
      {transfer.status === 'Sent' && waitingFailed && (
        <span data-testid="transfer-waiting">
          <button type="button" onClick={() => void waitingRoute.refetch()} className="font-medium text-primary-text hover:underline">{t('actions.retry')}</button>
        </span>
      )}
      {transfer.status === 'Sent' && waitingText && <span data-testid="transfer-waiting">{waitingText}</span>}
      {transfer.receivedAt && <span>{t('transfers.receivedBy', { name: person(transfer.receivedBy), at: formatDecisionDateTime(new Date(transfer.receivedAt)) })}</span>}
      {transfer.cancelReason && <span className="text-foreground">{t('transfers.recalled', { reason: transfer.cancelReason })}</span>}
      {proofRow && <span className="font-medium text-foreground">{proofRow.proofStatus === 'complete' ? t('proof.complete') : t('proof.outstandingMissing', { missing: proofRow.missing?.split(',').map((m) => t(`proof.rule.${m}`)).join(', ') })}</span>}
      {transfer.note && <span>{t('form.note')}: {transfer.note}</span>}
    </span>
  );

  return (
    <div className="pb-24 md:pb-0">
      <section aria-label={t('transfers.summary')}>
        <RecordHeader
          panelInset
          clampNameOnMobile
          name={`${t('transfers.detailTitle')} ${transfer.number}`}
          status={<StatusPill variant={TRANSFER_VARIANT[transfer.status]}>{t(`transfers.status.${transfer.status}`)}</StatusPill>}
          meta={facts}
          actions={deliveryNotes.data?.enabled ? <Link to={`/stock/transfers/${transfer.id}/print`} className={buttonClasses('outline')}>{t('transfers.print.action')}</Link> : undefined}
          menuItems={recallItems}
        />
      </section>
      <RecordStack>
        <FormErrorStrip>{error || undefined}</FormErrorStrip>
        {transfer.status === 'Sent' && !viewOnly && !canCount && <p className="panel-card p-[var(--panel-inset)] text-control" role="status">{t('transfers.senderWaits')}</p>}

        {receiving ? (
          <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) void receive(); }} noValidate>
            <RecordSection title={t('transfers.receiveTitle')} flush>
              <DataTable<StockTransferLine> rows={transfer.lines} columns={receiveColumns} rowKey={(l) => l.id} tableId="stock-transfer-receive" accessibleName={t('transfers.receiveTitle')} embedded cardValuesEnd />
              {checks.length > 0 && <div className="space-y-4 border-t border-border p-[var(--panel-inset)]">{checks.map((l) => { const c = countOf(l); const short = shortOf(l, c); return (
                <div key={l.id} className="space-y-2">
                  {transfer.lines.length > 1 && <h3 className="text-control font-medium">{item(l)}</h3>}
                  {(rejectedOf(c) > 0 || flaggedLine(l)) && <FormGrid>
                    {rejectedOf(c) > 0 && <TextField id={`reason-${l.id}`} label={t('transfers.rejectReason')} value={c.reason} onChange={(v) => setCount(l, { reason: v })} required />}
                    {flaggedLine(l) && <SelectField label={t('transfers.quality')} required value={c.quality} onChange={(v) => setCount(l, { quality: v as QualityResult, accepted: v === 'fail' ? '0' : c.accepted })} options={[{ value: 'pass', label: t('transfers.qualityPass') }, { value: 'fail', label: t('transfers.qualityFail') }]} placeholder={t('transfers.qualityChoose')} />}
                  </FormGrid>}
                  {short > 0 && <p className="text-control">{t('transfers.shortNote', { qty: [formatQuantity(String(short), loc), unitOf(l)].filter(Boolean).join(' ') })}</p>}
                </div>); })}</div>}
              <div className="space-y-4 border-t border-border p-[var(--panel-inset)]">
                {needsProof && <p className="text-control">{blocking ? t('proof.requiredNow', { rules: [...rules].map((r) => t(`proof.rule.${r}`)).join(', ') }) : t('proof.mayFollow')}</p>}
                <Checkbox label={t('handover.confirmNow')} checked={withHandover || blocking} disabled={blocking} onChange={(c) => setWithHandover(c === true)}>{t('handover.confirmNow')}</Checkbox>
                {(withHandover || blocking) && <HandoverCapture idPrefix="receive" value={handover} onChange={(v) => { setHandover(v); setWithHandover(true); }} signerName={me?.full_name ?? ''} proofs={['in_app', 'paper']} />}
                <div className="fixed inset-x-0 bottom-[var(--phone-nav-height)] z-20 border-t border-border bg-card p-3 md:static md:border-0 md:bg-transparent md:p-0">
                  <Button variant="primary" type="submit" disabled={!canSubmit} loading={busy} className="max-md:w-full">{t('transfers.receiveAction')}</Button>
                </div>
              </div>
            </RecordSection>
          </form>
        ) : (
          <RecordSection title={t('transfers.lines')} flush>
            <DataTable<StockTransferLine> rows={transfer.lines} columns={recordColumns} rowKey={(l) => l.id} tableId="stock-transfer-lines" accessibleName={t('transfers.lines')} embedded cardValuesEnd />
          </RecordSection>
        )}

        {transfer.status === 'Received' && openShort.length > 0 && !viewOnly && (
          <RecordSection title={t('transfers.shortfalls')} className="bg-waiting-surface">
            <div className="space-y-4">
              <div className="max-w-md"><TextField id="short-reason" label={t('transfers.shortReason')} value={reason} onChange={setReason} /></div>
              <ul className="divide-y divide-border">{openShort.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1 font-medium">{item(l)}</span>
                  <span className="whitespace-nowrap tabular-nums">{t('transfers.shortQty', { qty: [formatQuantity(String(Number(l.qtySent) - Number(l.qtyCounted)), loc), unitOf(l)].filter(Boolean).join(' ') })}</span>
                  <span className="flex flex-wrap gap-2">{(['delivered', 'returned', ...(isAdmin ? ['written_off'] : [])] as ShortResolution[]).map((r) => (
                    <Button key={r} variant={r === 'written_off' ? 'ghost' : 'outline'} disabled={busy || (r === 'written_off' && !reason.trim())} onClick={() => void run(() => repo.resolveShortfall(l.id, r, reason), t('transfers.resolvedToast'))}>{t(`transfers.resolveAs.${r}`)}</Button>))}</span>
                </li>))}</ul>
            </div>
          </RecordSection>
        )}

        <RecordSection title={t('handover.recorded')} flush={(confirmations.data ?? []).length > 0}>
          {(confirmations.data ?? []).length === 0 ? <p className="text-control text-muted-foreground">{t('handover.none')}</p> : (
            <ul className="divide-y divide-border">{(confirmations.data ?? []).map((c) => (
              <li key={c.id} className="space-y-2 px-[var(--panel-inset)] py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-medium">{c.signerName}{c.signerKind === 'guest' ? ` (${t('handover.guestBadge')})` : ''}</span>
                  <span className="whitespace-nowrap text-control tabular-nums text-muted-foreground">{formatDecisionDateTime(new Date(c.confirmedAt))}</span>
                </div>
                <div className="text-control text-muted-foreground">{t(`handover.stage.${c.stage}`)} · {t(c.proofType === 'paper' ? 'handover.proofPaper' : 'handover.proofInApp')} · {t('handover.recordedBy', { name: person(c.recordedBy) })}</div>
                <HandoverPhotos confirmation={c} />
              </li>))}</ul>)}
          {proofRow?.proofStatus === 'outstanding' && transfer.status !== 'Cancelled' && !viewOnly && (
            <div className="space-y-3 border-t border-border p-[var(--panel-inset)]">
              <h3 className="text-control font-semibold">{t('proof.addTitle')}</h3>
              <HandoverCapture idPrefix="late" value={late} onChange={setLate} signerName={me?.full_name ?? ''} />
              <Button variant="primary" disabled={busy || !isHandoverComplete(late)} onClick={() => void addProof()}>{t('proof.addAction')}</Button>
            </div>)}
        </RecordSection>
      </RecordStack>
      <ReasonDialog
        open={recalling}
        kind="reject"
        title={t('transfers.recallTitle')}
        label={t('transfers.recallReason')}
        helper=""
        confirmLabel={t('transfers.recallAction')}
        loading={busy}
        error={recalling ? error || undefined : undefined}
        onConfirm={(why) => void run(() => repo.recall(transfer.id, why), t('transfers.recalledToast')).then(() => setRecalling(false))}
        onCancel={() => { if (!busy) setRecalling(false); }}
      />
    </div>
  );
};
export default StockTransferDetail;
