import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ConfirmDialog, DataTable, ListState, MobileActionBar, RecordHeader, SelectField, StatusPill, TextField, useToast, type Column } from '@/src/components/ui';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { buttonClasses } from '@/src/components/ui/buttonClasses';
import { HandoverCapture } from '@/src/components/stock/HandoverCapture';
import { HandoverPhotos } from '@/src/components/stock/HandoverPhotos';
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
import { useRoleOptions } from '@/src/hooks/useRoleOptions';
import { formatCalendarDayInTimeZone, formatDay, formatInstantTime } from '@/src/lib/format';
import { getActiveLocale } from '@/src/lib/locale/activeLocale';
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
  const profiles = useAssignableProfiles();
  const [counts, setCounts] = useState<Record<string, Count>>({});
  const [handover, setHandover] = useState<HandoverValue>(emptyHandover());
  const [withHandover, setWithHandover] = useState(false);
  const [late, setLate] = useState<HandoverValue>(emptyHandover());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recalling, setRecalling] = useState(false);
  const wide = useIsDesktop();
  const transfer = q.data ? stringQuantities(q.data) : q.data;   // a numeric column can arrive as a JSON number; the formatters take strings
  const itemById = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);
  const tagById = useMemo(() => new Map((tags.data ?? []).map((g) => [g.id, g])), [tags.data]);
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
  const openShort = transfer.lines.filter((l) => l.qtyCounted !== null && l.qtyCounted !== l.qtySent && l.shortResolution === null);
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

  const when = (iso: string) => `${formatDay(formatCalendarDayInTimeZone(new Date(iso), getActiveLocale().timezone))} ${formatInstantTime(iso)}`;
  const qty = (v: string | null, _l: StockTransferLine) => v === null ? null : <span className="whitespace-nowrap tabular-nums">{formatQuantity(v, loc)}</span>;
  const shortOf = (sent: string, counted: string | null) => counted === null ? 0 : Number(sent) - Number(normalizeDecimal(counted) || 0);
  const receiving = transfer.status === 'Sent' && !viewOnly && canCount;
  const canRecall = transfer.status === 'Sent' && !viewOnly && (mine || isAdmin);
  const facts: { key: string; label: string; value: React.ReactNode }[] = [
    { key: 'from', label: t('form.fromWarehouse'), value: wh(transfer.fromWarehouseId) },
    { key: 'to', label: t('form.toWarehouse'), value: wh(transfer.toWarehouseId) },
    { key: 'sent', label: t('transfers.facts.sent'), value: <>{person(transfer.sentBy)} <span className="text-muted-foreground">· {when(transfer.sentAt)}</span></> },
    ...(transfer.toUserId ? [{ key: 'receiver', label: t('transfers.facts.receiver'), value: person(transfer.toUserId) }] : []),
    ...(transfer.receivedAt ? [{ key: 'received', label: t('transfers.facts.received'), value: <>{person(transfer.receivedBy)} <span className="text-muted-foreground">· {when(transfer.receivedAt)}</span></> }] : []),
    ...(transfer.cancelReason ? [{ key: 'recalled', label: t('transfers.facts.recalled'), value: transfer.cancelReason }] : []),
    ...(proofRow ? [{ key: 'proof', label: t('transfers.facts.proof'), value: proofRow.proofStatus === 'complete' ? t('proof.complete') : t('proof.outstandingMissing', { missing: proofRow.missing?.split(',').map((m) => t(`proof.rule.${m}`)).join(', ') }) }] : []),
  ];
  const lineColumns: Column<StockTransferLine>[] = [
    { key: 'item', header: t('transfers.col.item'), rowHeader: true, size: 280, cell: (l) => <span className="font-semibold text-foreground">{item(l)}</span> },
    { key: 'sent', header: t('transfers.col.sent'), align: 'num', size: 120, cell: (l) => qty(l.qtySent, l) },
    ...(receiving ? [
      { key: 'counted', header: t('transfers.counted'), align: 'num' as const, size: 136, cell: (l: StockTransferLine) => { const c = countOf(l); return <TextField id={`counted-${l.id}`} hideLabel label={t('transfers.counted')} inputMode="decimal" value={c.counted} onChange={(v) => setCount(l, { counted: v, accepted: c.accepted === c.counted ? v : c.accepted })} required wrapperClassName="ml-auto w-28" className="text-right tabular-nums" />; } },
      { key: 'accepted', header: t('transfers.accepted'), align: 'num' as const, size: 136, cell: (l: StockTransferLine) => { const c = countOf(l); return <TextField id={`accepted-${l.id}`} hideLabel label={t('transfers.accepted')} inputMode="decimal" value={c.accepted} onChange={(v) => setCount(l, { accepted: v })} required wrapperClassName="ml-auto w-28" className="text-right tabular-nums" />; } },
      { key: 'short', header: t('transfers.col.short'), align: 'num' as const, size: 112, cell: (l: StockTransferLine) => { const s = shortOf(l.qtySent, countOf(l).counted); return s > 0 ? qty(String(s), l) : null; } },
    ] : [
      { key: 'counted', header: t('transfers.counted'), align: 'num' as const, size: 120, cell: (l: StockTransferLine) => qty(l.qtyCounted, l) },
      { key: 'accepted', header: t('transfers.accepted'), align: 'num' as const, size: 120, cell: (l: StockTransferLine) => qty(l.qtyCounted === null ? null : l.qtyAccepted ?? '0', l) },
      { key: 'rejected', header: t('transfers.col.rejected'), align: 'num' as const, size: 160, cell: (l: StockTransferLine) => l.qtyRejected !== null && Number(l.qtyRejected) > 0 ? <span>{qty(l.qtyRejected, l)}{l.rejectReason && <span className="block text-control text-muted-foreground">{l.rejectReason}</span>}</span> : null },
      { key: 'outcome', header: t('transfers.col.outcome'), size: 220, cell: (l: StockTransferLine) => l.shortResolution ? <span>{t(`transfers.resolution.${l.shortResolution}`)}{l.shortReason && <span className="block text-control text-muted-foreground">{l.shortReason}</span>}</span> : null },
    ]),
  ];
  // Per-line fields that only some lines need (a rejection reason, a quality result, a shortfall's consequence) sit under the table, once per line that needs them.
  const checks = receiving ? transfer.lines.map((l) => { const c = countOf(l); const rejected = Number(normalizeDecimal(c.counted) || 0) - Number(normalizeDecimal(c.accepted) || 0); const f = l.needsQualityCheck ?? flagged(itemById.get(l.itemId)); const short = shortOf(l.qtySent, c.counted); return { l, c, rejected, f, short }; }).filter((x) => x.rejected > 0 || x.f || x.short > 0) : [];
  const shortColumns: Column<StockTransferLine>[] = [
    { key: 'item', header: t('transfers.col.item'), rowHeader: true, size: 280, cell: (l) => <span className="font-semibold text-foreground">{item(l)}</span> },
    { key: 'short', header: t('transfers.col.short'), align: 'num', size: 136, cell: (l) => <span className="tabular-nums">{t('transfers.shortQty', { qty: formatQuantity(String(Number(l.qtySent) - Number(l.qtyCounted)), loc) })}</span> },
    { key: 'decide', header: <span className="block text-right">{t('transfers.col.decide')}</span>, kind: 'actions', size: 320, cell: (l) => <div className="flex flex-wrap justify-end gap-2">{(['delivered', 'returned', ...(isAdmin ? ['written_off'] : [])] as ShortResolution[]).map((r) => (
      <Button key={r} size="sm" variant={r === 'written_off' ? 'ghost' : 'outline'} disabled={busy || (r === 'written_off' && !reason.trim())} onClick={() => void run(() => repo.resolveShortfall(l.id, r, reason), t('transfers.resolvedToast'))}>{t(`transfers.resolveAs.${r}`)}</Button>))}</div> },
  ];
  type Confirmation = NonNullable<typeof confirmations.data>[number];
  const handoverColumns: Column<Confirmation>[] = [
    { key: 'signer', header: t('transfers.col.signer'), rowHeader: true, size: 220, cell: (c) => <span className="font-semibold text-foreground">{c.signerName}{c.signerKind === 'guest' ? ` (${t('handover.guestBadge')})` : ''}</span> },
    { key: 'stage', header: t('transfers.col.stage'), size: 120, cell: (c) => t(`handover.stage.${c.stage}`) },
    { key: 'proof', header: t('transfers.col.proof'), size: 200, cell: (c) => <span>{t(c.proofType === 'paper' ? 'handover.proofPaper' : 'handover.proofInApp')}<HandoverPhotos confirmation={c} /></span> },
    { key: 'when', header: t('transfers.col.when'), size: 160, cell: (c) => <span className="whitespace-nowrap tabular-nums">{when(c.confirmedAt)}</span> },
    { key: 'by', header: t('transfers.col.recordedBy'), size: 180, cell: (c) => person(c.recordedBy) },
  ];
  const statusVariant = transfer.status === 'Closed' ? 'won' : transfer.status === 'Received' ? 'warn' : 'neutral';

  return (
    <div className="space-y-6 pb-24 md:pb-0">
      <RecordHeader
        name={`${t('transfers.detailTitle')} ${transfer.number}`}
        status={<StatusPill variant={statusVariant}>{t(`transfers.status.${transfer.status}`)}</StatusPill>}
        meta={<Link to="/stock/transfers" className="text-primary-text underline underline-offset-4">{t('transfers.back')}</Link>}
        actions={deliveryNotes.data?.enabled ? <Link to={`/stock/transfers/${transfer.id}/print`} className={buttonClasses('outline')}>{t('transfers.print.action')}</Link> : undefined}
        menuItems={canRecall ? [{ key: 'recall', label: t('transfers.recallAction'), danger: true, onSelect: () => { setReason(''); setRecalling(true); } }] : undefined}
      />
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 lg:grid-cols-4" aria-label={t('transfers.summary')}>
        {facts.map((f) => <div key={f.key} className="min-w-0"><dt className="text-control text-muted-foreground">{f.label}</dt><dd className="break-words text-control text-foreground">{f.value}</dd></div>)}
      </dl>
      {transfer.status === 'Sent' && waitingFailed && (
        <div data-testid="transfer-waiting" className="text-control text-muted-foreground">
          <button type="button" onClick={() => void waitingRoute.refetch()} className="font-medium text-primary-text hover:underline">{t('actions.retry')}</button>
        </div>
      )}
      {transfer.status === 'Sent' && waitingText && <div data-testid="transfer-waiting" className="text-control text-muted-foreground">{waitingText}</div>}
      {transfer.status === 'Sent' && !viewOnly && !canCount && <p className="rounded-lg border border-warning/40 bg-warning/12 px-3.5 py-3 text-control" role="status">{t('transfers.senderWaits')}</p>}
      <FormErrorStrip>{error || undefined}</FormErrorStrip>

      {receiving ? (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (canSubmit) void receive(); }} noValidate>
          <h2 className="text-base font-semibold">{t('transfers.receiveTitle')}</h2>
          {/* A plain table: its header cells are not field labels, so "Counted" and "Accepted" name only the inputs. */}
          {!wide ? <ul className="divide-y divide-border border-y border-border" aria-label={t('transfers.receiveTitle')}>{transfer.lines.map((l) => { const c = countOf(l); const short = shortOf(l.qtySent, c.counted); return (
            <li key={l.id} className="space-y-2 py-3">
              <div className="flex items-baseline justify-between gap-3"><span className="font-semibold">{item(l)}</span><span className="whitespace-nowrap text-control text-muted-foreground">{t('transfers.col.sent')} <span className="tabular-nums text-foreground">{formatQuantity(l.qtySent, loc)}</span></span></div>
              <div className="grid grid-cols-2 gap-3">
                <TextField id={`counted-${l.id}`} label={t('transfers.counted')} inputMode="decimal" value={c.counted} onChange={(v) => setCount(l, { counted: v, accepted: c.accepted === c.counted ? v : c.accepted })} required className="text-right tabular-nums" />
                <TextField id={`accepted-${l.id}`} label={t('transfers.accepted')} inputMode="decimal" value={c.accepted} onChange={(v) => setCount(l, { accepted: v })} required className="text-right tabular-nums" />
              </div>
              {short > 0 && <p className="text-right text-control"><span className="text-muted-foreground">{t('transfers.col.short')}</span> <span className="tabular-nums">{formatQuantity(String(short), loc)}</span></p>}
            </li>); })}</ul> : <div className="overflow-x-auto">
            <table className="w-full text-control" aria-label={t('transfers.receiveTitle')}>
              <thead><tr className="border-b border-border text-left">
                {lineColumns.map((col) => <th key={col.key} scope="col" className={`px-[var(--table-cell-inset)] py-3 font-semibold text-foreground ${col.align === 'num' ? 'text-right' : ''}`}>{col.header}</th>)}
              </tr></thead>
              <tbody>{transfer.lines.map((l) => (
                <tr key={l.id} className="border-b border-border/70">
                  {lineColumns.map((col, i) => i === 0
                    ? <th key={col.key} scope="row" className="px-[var(--table-cell-inset)] py-2 text-left font-normal">{col.cell(l)}</th>
                    : <td key={col.key} className={`px-[var(--table-cell-inset)] py-2 ${col.align === 'num' ? 'text-right' : ''}`}>{col.cell(l)}</td>)}
                </tr>))}</tbody>
            </table>
          </div>}
          {checks.length > 0 && <ul className="space-y-4" aria-label={t('transfers.lineChecks')}>{checks.map(({ l, c, rejected, f, short }) => (
            <li key={l.id} className="space-y-2">
              <h3 className="text-control font-semibold">{item(l)}</h3>
              {short > 0 && <p className="text-control">{t('transfers.shortNote', { qty: formatQuantity(String(short), loc) })}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                {rejected > 0 && <TextField id={`reason-${l.id}`} label={t('transfers.rejectReason')} value={c.reason} onChange={(v) => setCount(l, { reason: v })} required />}
                {f && <SelectField label={t('transfers.quality')} required value={c.quality} onChange={(v) => setCount(l, { quality: v as QualityResult, accepted: v === 'fail' ? '0' : c.accepted })} options={[{ value: 'pass', label: t('transfers.qualityPass') }, { value: 'fail', label: t('transfers.qualityFail') }]} placeholder={t('transfers.qualityChoose')} />}
              </div>
            </li>))}</ul>}
          {needsProof && <p className="text-control">{blocking ? t('proof.requiredNow', { rules: [...rules].map((r) => t(`proof.rule.${r}`)).join(', ') }) : t('proof.mayFollow')}</p>}
          <Checkbox label={t('handover.confirmNow')} checked={withHandover || blocking} disabled={blocking} onChange={(c) => setWithHandover(c === true)}>{t('handover.confirmNow')}</Checkbox>
          {(withHandover || blocking) && <HandoverCapture idPrefix="receive" value={handover} onChange={(v) => { setHandover(v); setWithHandover(true); }} signerName={me?.full_name ?? ''} proofs={['in_app', 'paper']} />}
          <MobileActionBar className="fixed inset-x-0 bottom-[var(--phone-nav-height)] z-20 flex justify-end border-t border-border bg-card p-3 md:static md:z-auto md:border-0 md:bg-transparent md:p-0">
            <Button variant="primary" type="submit" className="w-full md:w-auto" disabled={!canSubmit} loading={busy}>{t('transfers.receiveAction')}</Button>
          </MobileActionBar>
        </form>
      ) : (
        <section aria-label={t('transfers.lines')} className="space-y-3">
          <h2 className="text-base font-semibold">{t('transfers.lines')}</h2>
          <DataTable<StockTransferLine> rows={transfer.lines} columns={lineColumns} rowKey={(l) => l.id} tableId="transfer-lines" accessibleName={t('transfers.lines')} embedded cardValuesEnd />
        </section>
      )}

      {transfer.status === 'Received' && openShort.length > 0 && !viewOnly && (
        <section aria-label={t('transfers.shortfalls')} className="space-y-3">
          <h2 className="text-base font-semibold">{t('transfers.shortfalls')}</h2>
          <div className="max-w-md"><TextField id="short-reason" label={t('transfers.shortReason')} value={reason} onChange={setReason} /></div>
          <DataTable<StockTransferLine> rows={openShort} columns={shortColumns} rowKey={(l) => l.id} tableId="transfer-shortfalls" accessibleName={t('transfers.shortfalls')} embedded cardValuesEnd />
        </section>
      )}

      <section aria-label={t('handover.recorded')} className="space-y-3">
        <h2 className="text-base font-semibold">{t('handover.recorded')}</h2>
        {(confirmations.data ?? []).length === 0 ? <p className="text-control text-muted-foreground">{t('handover.none')}</p>
          : <DataTable<Confirmation> rows={confirmations.data ?? []} columns={handoverColumns} rowKey={(c) => c.id} tableId="transfer-handovers" accessibleName={t('handover.recorded')} embedded />}
        {proofRow?.proofStatus === 'outstanding' && transfer.status !== 'Cancelled' && !viewOnly && (
          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <h3 className="text-base font-semibold">{t('proof.addTitle')}</h3>
            <HandoverCapture idPrefix="late" value={late} onChange={setLate} signerName={me?.full_name ?? ''} />
            <Button variant="primary" disabled={busy || !isHandoverComplete(late)} onClick={() => void addProof()}>{t('proof.addAction')}</Button>
          </div>)}
      </section>

      <ConfirmDialog open={recalling} title={t('transfers.recallTitle')}
        description={<TextField id="recall-reason" label={t('transfers.recallReason')} value={reason} onChange={setReason} required />}
        confirmLabel={t('transfers.recallAction')} cancelLabel={t('actions.cancel')} confirmDisabled={!reason.trim() || busy} loading={busy}
        onCancel={() => setRecalling(false)} onConfirm={() => { setRecalling(false); void run(() => repo.recall(transfer.id, reason), t('transfers.recalledToast')); }} />
    </div>
  );
};
export default StockTransferDetail;
