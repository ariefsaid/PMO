import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, ConfirmDialog, EntityFormModal, TextField } from '@/src/components/ui';
import { RecordHistory } from '@/src/components/history/RecordHistory';
import { useVendorWithholdingSlip, useVendorWithholdingSlipMutations } from '@/src/hooks/useVendorWithholdingSlips';
import { bupotRefusal, type CorrectSlipInput, type VoidSlipInput } from '@/src/lib/vendorWithholdingSlip';
import { formatDateOnly } from '@/src/lib/format';

interface Header { id: string; slip_number: string; slip_date: string; tax_period: string; pph_type: string; currency: string; tax_base: string; withheld_amount: string; status: string; validation_state: string; revision: number; void_reason?: string | null; }
interface Bill { invoice_id: string; procurement_id: string; vi_number?: string | null; withheld_at_record: string; currency: string; released_at?: string | null; coverage_state?: string; }
export interface VendorWithholdingSlipDetailsProps { slipId: string; canWrite: boolean; onClose: () => void; onOpenProcurement?: (procurementId: string, slipId: string) => void; onReload?: () => void; }

export function VendorWithholdingSlipDetails({ slipId, canWrite, onClose, onOpenProcurement, onReload }: VendorWithholdingSlipDetailsProps) {
  const { t } = useTranslation();
  const query = useVendorWithholdingSlip(slipId);
  const mutations = useVendorWithholdingSlipMutations();
  const [showCorrection, setShowCorrection] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [number, setNumber] = useState('');
  const [date, setDate] = useState('');
  const [period, setPeriod] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<{ headline: string; detail?: string; action?: React.ReactNode } | null>(null);
  if (query.isLoading) return <Card><CardPad><p role="status">{t('bupot.loading', 'Loading bukti potong…')}</p></CardPad></Card>;
  if (query.isError || !query.data) return <Card><CardPad><p role="alert">{t('bupot.loadError', 'Bukti potong unavailable')}</p><Button onClick={() => void query.refetch()}>{t('bupot.reload', 'Reload')}</Button><Button variant="outline" onClick={onClose}>{t('bupot.close', 'Close')}</Button></CardPad></Card>;
  const header = query.data.header as unknown as Header;
  const bills = query.data.bills as unknown as Bill[];
  const correct = async (event: React.FormEvent) => {
    event.preventDefault(); setError(null); setCorrectionError(null);
    try { await mutations.correct.mutateAsync({ slipId, expectedRevision: header.revision, slipNumber: number, slipDate: date, taxPeriod: period, reason } satisfies CorrectSlipInput); setShowCorrection(false); }
    catch (e) {
      const refusal = bupotRefusal(e);
      setCorrectionError({ headline: t('bupot.refusal.stale', 'This slip changed. Reload it before saving.'), detail: t('bupot.remedy.reload', 'Reload and review the latest slip facts.'), ...(refusal.remedy === 'reload' ? { action: <Button variant="outline" onClick={() => { void query.refetch(); setShowCorrection(false); }}>{t('bupot.reload', 'Reload')}</Button> } : {}) });
    }
  };
  const voidEntry = async () => {
    setError(null);
    try { await mutations.void.mutateAsync({ slipId, expectedRevision: header.revision, reason } satisfies VoidSlipInput); setShowVoid(false); setReason(''); }
    catch (e) { setError(t(`bupot.refusal.${bupotRefusal(e).key}`, 'Unable to void this PMO entry')); }
  };
  return <Card className="mt-3" aria-label={t('bupot.detailTitle', 'Bukti potong details')}>
    <CardHead><div className="flex items-center justify-between gap-2"><span>{t('bupot.detailTitle', 'Bukti potong details')}</span><Button variant="outline" onClick={onClose}>{t('bupot.close', 'Close')}</Button></div></CardHead>
    <CardPad>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact label={t('bupot.slipNumber', 'Issued slip number')} value={header.slip_number} />
        <Fact label={t('bupot.slipDate', 'Slip date')} value={formatDateOnly(header.slip_date)} />
        <Fact label={t('bupot.taxPeriod', 'Tax period')} value={formatDateOnly(header.tax_period)} />
        <Fact label={t('bupot.type', 'PPh type')} value={header.pph_type} />
        <Fact label={t('bupot.taxBase', 'Tax base')} value={`${header.currency} ${header.tax_base}`} />
        <Fact label={t('bupot.withheldAmount', 'Issued withheld amount')} value={`${header.currency} ${header.withheld_amount}`} />
        <Fact label={t('bupot.state.needsReview', 'Validation state')} value={header.validation_state} />
        <Fact label={t('bupot.status', 'Status')} value={header.status} />
      </dl>
      <h3 className="mt-5 font-semibold">{t('bupot.bill', 'Linked bills')} ({bills.length})</h3>
      <ul className="mt-2 divide-y divide-border">{bills.map((bill) => <li key={bill.invoice_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <span className="break-all">{bill.vi_number ?? bill.invoice_id}</span><span className="tabular-nums">{bill.currency} {bill.withheld_at_record}</span>
        <Button variant="outline" onClick={() => onOpenProcurement?.(bill.procurement_id, slipId)}>{t('bupot.openCase', 'Open case')}</Button>
      </li>)}</ul>
      {header.status === 'void' && <p className="mt-3 text-sm">{t('bupot.voidReason', 'Void reason')}: {header.void_reason}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}<Button variant="outline" onClick={() => { void query.refetch(); onReload?.(); }}>{t('bupot.reload', 'Reload')}</Button></p>}
      {canWrite && header.status === 'active' && <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => { setNumber(header.slip_number); setDate(header.slip_date); setPeriod(header.tax_period); setReason(''); setShowCorrection(true); }}>{t('bupot.correct', 'Correct metadata')}</Button>
        <Button variant="destructive" onClick={() => { setReason(''); setShowVoid(true); }}>{t('bupot.void', 'Void PMO entry')}</Button>
      </div>}
      <div className="mt-5"><RecordHistory entityType="vendor_withholding_slip" entityId={slipId} includeChildren /></div>
    </CardPad>
    <EntityFormModal open={showCorrection} title={t('bupot.correct', 'Correct metadata')} submitLabel={t('bupot.save', 'Save changes')} onSubmit={correct} onClose={() => setShowCorrection(false)} loading={mutations.correct.isPending} dirty submitError={correctionError}>
      <TextField label={t('bupot.slipNumber', 'Issued slip number')} value={number} onChange={setNumber} required />
      <TextField label={t('bupot.slipDate', 'Slip date')} type="date" value={date} onChange={setDate} required />
      <TextField label={t('bupot.taxPeriod', 'Tax period')} type="date" value={period} onChange={setPeriod} required />
      <TextField label={t('bupot.correctionReason', 'Correction reason')} value={reason} onChange={setReason} required />
    </EntityFormModal>
    <ConfirmDialog open={showVoid} title={t('bupot.confirmVoid', 'Void this PMO entry?')} description={<div className="space-y-3"><p>{t('bupot.voidWarning', 'This only removes PMO coverage. It does not cancel a DJP document.')}</p>{error && <p role="alert" className="text-destructive">{error}<Button variant="outline" onClick={() => { void query.refetch(); setShowVoid(false); }}>{t('bupot.reload', 'Reload')}</Button></p>}<TextField label={t('bupot.reason', 'Reason')} value={reason} onChange={setReason} required /></div>} confirmLabel={t('bupot.void', 'Void PMO entry')} cancelLabel={t('common.cancel', 'Cancel')} tone="destructive" loading={mutations.void.isPending} confirmDisabled={!reason.trim()} onConfirm={() => voidEntry()} onCancel={() => setShowVoid(false)} />
  </Card>;
}
function Fact({ label, value }: { label: string; value?: string | null }) { return <div className="min-w-0"><dt className="text-xs text-foreground">{label}</dt><dd className="break-words text-sm tabular-nums">{value || '—'}</dd></div>; }
