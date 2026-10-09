import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, ConfirmDialog, EntityFormModal, StatusPill, TextField } from '@/src/components/ui';
import { RecordHistory } from '@/src/components/history/RecordHistory';
import { useVendorWithholdingSlip, useVendorWithholdingSlipMutations } from '@/src/hooks/useVendorWithholdingSlips';
import { bupotRefusal, type CorrectSlipInput, type VoidSlipInput } from '@/src/lib/vendorWithholdingSlip';
import { formatCurrencyCents, formatDateOnly } from '@/src/lib/format';

interface Header { id: string; slip_number: string; slip_date: string; tax_period: string; pph_type: string; currency: string; tax_base: string; withheld_amount: string; status: string; validation_state: string; revision: number; void_reason?: string | null; linked_withheld_at_record?: string | null; linked_withheld_current?: string | null; difference?: string | null; }
interface Bill { invoice_id: string; procurement_id: string; vi_number?: string | null; withheld_at_record: string; withheld_current?: string | null; difference?: string | null; currency: string; released_at?: string | null; coverage_state?: string; }
export interface VendorWithholdingSlipDetailsProps { slipId: string; canWrite: boolean; onClose: () => void; onOpenProcurement?: (procurementId: string, slipId: string, invoiceId: string) => void; suppressArrivalFocus?: boolean; onReload?: () => void; }

export function VendorWithholdingSlipDetails({ slipId, canWrite, onClose, onOpenProcurement, suppressArrivalFocus = false, onReload }: VendorWithholdingSlipDetailsProps) {
  const { t } = useTranslation();
  const query = useVendorWithholdingSlip(slipId);
  const mutations = useVendorWithholdingSlipMutations();
  const [showCorrection, setShowCorrection] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [number, setNumber] = useState('');
  const [date, setDate] = useState('');
  const [period, setPeriod] = useState('');
  const [reason, setReason] = useState('');
  const [correctionDatesTouched, setCorrectionDatesTouched] = useState(false);
  const isCorrectionDateValid = Boolean(date && date <= new Date().toISOString().slice(0, 10));
  const isCorrectionPeriodValid = Boolean(/^\d{4}-\d{2}-01$/.test(period) && period <= `${new Date().toISOString().slice(0, 7)}-01`);
  const [error, setError] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<{ headline: string; detail?: string; action?: React.ReactNode } | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    if (!suppressArrivalFocus && query.data && titleRef.current) { titleRef.current.focus(); titleRef.current.scrollIntoView({ block: 'nearest' }); }
  }, [query.data, suppressArrivalFocus]);
  const close = () => { onClose(); requestAnimationFrame(() => returnFocus.current?.focus()); };
  if (query.isLoading) return <Card className="mt-3"><CardHead><div className="flex items-center justify-between"><h2 tabIndex={-1} ref={titleRef} className="font-semibold">{t('bupot.detailTitle', 'Bukti potong details')}</h2><Button variant="outline" onClick={close}>{t('bupot.close', 'Close')}</Button></div></CardHead><CardPad><div role="status" className="space-y-3"><div className="h-4 w-2/3 animate-pulse rounded bg-muted" /><div className="h-4 w-1/2 animate-pulse rounded bg-muted" />{t('bupot.loading', 'Loading bukti potong…')}</div></CardPad></Card>;
  if (query.isError || !query.data) return <Card className="mt-3"><CardHead><div className="flex items-center justify-between"><h2 tabIndex={-1} ref={titleRef} className="font-semibold">{t('bupot.detailTitle', 'Bukti potong details')}</h2><Button variant="outline" onClick={close}>{t('bupot.close', 'Close')}</Button></div></CardHead><CardPad><p role="alert">{t('bupot.loadError', 'Bukti potong unavailable')}</p><Button onClick={() => void query.refetch()}>{t('bupot.reload', 'Reload')}</Button></CardPad></Card>;
  const header = query.data.header as unknown as Header;
  const bills = query.data.bills as unknown as Bill[];
  const correct = async (event: React.FormEvent) => {
    event.preventDefault(); setError(null); setCorrectionError(null); setCorrectionDatesTouched(true);
    if (!isCorrectionDateValid || !isCorrectionPeriodValid) return;
    try { await mutations.correct.mutateAsync({ slipId, expectedRevision: header.revision, slipNumber: number, slipDate: date, taxPeriod: period, reason } satisfies CorrectSlipInput); setShowCorrection(false); }
    catch (e) {
      const refusal = bupotRefusal(e);
      setCorrectionError({ headline: refusal.key === 'invalidFacts' ? t('bupot.invalidFactsCopy', 'Review the entered facts and try again.') : refusal.key === 'stale' ? t('bupot.refusal.stale', 'This slip changed. Reload it before saving.') : t(`bupot.refusal.${refusal.key}`, 'Unable to save these changes.'), detail: refusal.remedy === 'reload' ? t('bupot.remedy.reload', 'Reload and review the latest slip facts.') : t('bupot.remedy.edit', 'Review the entered facts and try again.'), ...(refusal.remedy === 'reload' ? { action: <Button variant="outline" onClick={() => { void query.refetch(); setShowCorrection(false); }}>{t('bupot.reload', 'Reload')}</Button> } : {}) });
    }
  };
  const voidEntry = async () => {
    setError(null);
    try { await mutations.void.mutateAsync({ slipId, expectedRevision: header.revision, reason } satisfies VoidSlipInput); setShowVoid(false); setReason(''); }
    catch (e) { setError(t(`bupot.refusal.${bupotRefusal(e).key}`, 'Unable to void this PMO entry')); }
  };
  return <Card className="mt-3" aria-label={t('bupot.detailTitle', 'Bukti potong details')}>
    <CardHead><div className="flex items-center justify-between gap-2"><h2 ref={titleRef} tabIndex={-1} className="font-semibold text-foreground">{t('bupot.detailTitle', 'Bukti potong details')}</h2><Button variant="outline" onClick={close}>{t('bupot.close', 'Close')}</Button></div></CardHead>
    <CardPad>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact label={t('bupot.slipNumber', 'Issued slip number')} value={header.slip_number} />
        <Fact label={t('bupot.slipDate', 'Slip date')} value={formatDateOnly(header.slip_date)} />
        <Fact label={t('bupot.taxPeriod', 'Tax period')} value={formatDateOnly(header.tax_period)} />
        <Fact label={t('bupot.type', 'PPh type')} value={header.pph_type === 'pph23' ? 'PPh 23' : header.pph_type === 'pph4_2' ? 'PPh 4(2)' : '—'} />
        <Fact label={t('bupot.taxBase', 'Tax base')} value={formatCurrencyCents(Number(header.tax_base), header.currency)} />
        <Fact label={t('bupot.withheldAmount', 'Issued withheld amount')} value={formatCurrencyCents(Number(header.withheld_amount), header.currency)} />
        <StatusFact label={t('bupot.validationState', 'Validation state')} variant={header.validation_state === 'reconciled' ? 'won' : header.validation_state === 'needs-review' || header.validation_state === 'unavailable' ? 'warn' : 'neutral'} value={header.validation_state === 'reconciled' ? t('bupot.reconciled', 'Reconciled') : header.validation_state === 'needs-review' ? t('bupot.state.needsReview', 'Needs review') : header.validation_state === 'unavailable' ? t('bupot.sourceUnavailableShort', 'Source data unavailable') : t('bupot.voidedStatus', 'Voided in PMO')} />
        <StatusFact label={t('bupot.status', 'Status')} variant={header.status === 'active' ? 'progress' : 'neutral'} value={header.status === 'active' ? t('bupot.active', 'Active') : t('bupot.voidedStatus', 'Voided in PMO')} />
        {header.validation_state === 'needs-review' && <p className="sm:col-span-2 rounded border border-warning/30 bg-warning/10 p-3 text-sm text-warning-foreground">{t('bupot.reviewReason', 'Bill withholding changed. Verify the source; void and record a replacement if needed.')}</p>}
        {header.validation_state === 'unavailable' && <p className="sm:col-span-2 rounded border border-warning/30 bg-warning/10 p-3 text-sm text-warning-foreground">{t('bupot.sourceUnavailable', 'Source data is unavailable. Coverage cannot be verified.')}</p>}
        {header.validation_state !== 'unavailable' && <>
          <Fact label={t('bupot.recordedTotal', 'Recorded')} value={header.linked_withheld_at_record != null ? formatCurrencyCents(Number(header.linked_withheld_at_record), header.currency) : '—'} />
          <Fact label={t('bupot.currentTotal', 'Current')} value={header.linked_withheld_current != null ? formatCurrencyCents(Number(header.linked_withheld_current), header.currency) : '—'} />
          <Fact label={t('bupot.difference', 'Difference')} value={header.difference != null ? formatCurrencyCents(Number(header.difference), header.currency) : '—'} />
        </>}
      </dl>
      <h3 className="mt-5 font-semibold">{t('bupot.bill', 'Linked bills')} ({bills.length})</h3>
      <ul className="mt-2 divide-y divide-border">{bills.map((bill) => <li key={bill.invoice_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <div className="min-w-0"><span className="break-all">{bill.vi_number ?? bill.invoice_id}</span><span className="block text-xs text-muted-foreground">{t('bupot.recordedTotal', 'Recorded')}: {formatCurrencyCents(Number(bill.withheld_at_record), bill.currency)} · {t('bupot.currentTotal', 'Current')}: {bill.withheld_current == null ? '—' : formatCurrencyCents(Number(bill.withheld_current), bill.currency)} · {t('bupot.difference', 'Difference')}: {bill.difference == null ? '—' : formatCurrencyCents(Number(bill.difference), bill.currency)}</span></div>
        <Button variant="outline" className="touch-target max-[767px]:min-h-11" aria-label={t('bupot.openBillCase', 'Open bill {{bill}} in case {{case}}', { bill: bill.vi_number ?? bill.invoice_id, case: bill.procurement_id })} onClick={() => onOpenProcurement?.(bill.procurement_id, slipId, bill.invoice_id)}>{t('bupot.openBill', 'Open bill in case')}</Button>
      </li>)}</ul>
      {header.status === 'void' && <p className="mt-3 text-sm text-foreground">{t('bupot.voidReason', 'Void reason')}: {header.void_reason || '—'}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}<Button variant="outline" onClick={() => { void query.refetch(); onReload?.(); }}>{t('bupot.reload', 'Reload')}</Button></p>}
      {canWrite && header.status === 'active' && <div className="mt-4 flex flex-wrap gap-2">
        {header.validation_state !== 'needs-review' && header.validation_state !== 'unavailable' && <Button variant="outline" onClick={() => { setNumber(header.slip_number); setDate(header.slip_date); setPeriod(header.tax_period); setReason(''); setShowCorrection(true); }}>{t('bupot.correct', 'Correct metadata')}</Button>}
        <Button variant="destructive" onClick={() => { setReason(''); setShowVoid(true); }}>{t('bupot.void', 'Void PMO entry')}</Button>
      </div>}
      <div className="mt-5"><RecordHistory entityType="vendor_withholding_slip" entityId={slipId} includeChildren /></div>
    </CardPad>
    <EntityFormModal open={showCorrection} title={t('bupot.correct', 'Correct metadata')} submitLabel={t('bupot.save', 'Save changes')} onSubmit={correct} onClose={() => setShowCorrection(false)} loading={mutations.correct.isPending} dirty submitDisabled={correctionDatesTouched && (!isCorrectionDateValid || !isCorrectionPeriodValid)} submitError={correctionError}>
      <TextField label={t('bupot.slipNumber', 'Issued slip number')} value={number} onChange={setNumber} required />
      <TextField label={t('bupot.slipDate', 'Slip date')} type="date" max={new Date().toISOString().slice(0, 10)} value={date} onChange={setDate} onBlur={() => setCorrectionDatesTouched(true)} error={correctionDatesTouched && !isCorrectionDateValid ? t('bupot.invalidSlipDate', 'Choose a slip date no later than today.') : undefined} required />
      <TextField label={t('bupot.taxPeriodMonth', 'Tax period (month)')} type="month" value={period.slice(0, 7)} onChange={(value) => setPeriod(`${value}-01`)} onBlur={() => setCorrectionDatesTouched(true)} error={correctionDatesTouched && !isCorrectionPeriodValid ? t('bupot.invalidTaxPeriod', 'Choose a tax month no later than the current month.') : undefined} required />
      <TextField label={t('bupot.correctionReason', 'Correction reason')} value={reason} onChange={setReason} required />
    </EntityFormModal>
    <ConfirmDialog open={showVoid} title={t('bupot.confirmVoid', 'Void this PMO entry?')} description={<div className="space-y-3"><p>{t('bupot.voidWarning', 'This only removes PMO coverage. It does not cancel a DJP document.')}</p>{error && <p role="alert" className="text-destructive">{error}<Button variant="outline" onClick={() => { void query.refetch(); setShowVoid(false); }}>{t('bupot.reload', 'Reload')}</Button></p>}<TextField label={t('bupot.reason', 'Reason')} value={reason} onChange={setReason} required /></div>} confirmLabel={t('bupot.void', 'Void PMO entry')}  tone="destructive" loading={mutations.void.isPending} confirmDisabled={!reason.trim()} onConfirm={() => voidEntry()} onCancel={() => setShowVoid(false)} />
  </Card>;
}
function Fact({ label, value }: { label: string; value?: string | null }) { return <div className="min-w-0"><dt className="text-xs text-foreground">{label}</dt><dd className="break-words text-sm tabular-nums">{value || '—'}</dd></div>; }
function StatusFact({ label, value, variant }: { label: string; value: string; variant: 'won' | 'warn' | 'progress' | 'neutral' }) { return <div className="min-w-0"><dt className="text-xs text-foreground">{label}</dt><dd><StatusPill variant={variant}>{value}</StatusPill></dd></div>; }
