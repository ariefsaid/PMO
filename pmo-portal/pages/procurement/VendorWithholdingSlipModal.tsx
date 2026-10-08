import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, DataTable, EntityFormModal, FieldError, ListState, SelectField, TextField, type Column } from '@/src/components/ui';
import type { ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';
import type { BillRow } from '@/src/lib/db/vendorWithholdingSlips';
import type { PphType } from '@/src/lib/vendorWithholding';
import { formatSlipCents, parsePositiveSlipMoney, parseDecimalCents, sumSlipMoney, bupotRefusal, type RecordSlipInput } from '@/src/lib/vendorWithholdingSlip';
import { formatCurrencyCents, parseMoneyInputAtScale } from '@/src/lib/format';
import { useVendorWithholdingCandidates } from '@/src/hooks/useVendorWithholdingSlips';

export interface VendorWithholdingSlipModalProps {
  invoice: ProcurementInvoiceRow;
  vendorId: string;
  vendorName?: string;
  open: boolean;
  loading?: boolean;
  onClose: () => void;
  onSave: (input: RecordSlipInput) => Promise<unknown>;
}
type Selected = { bill: BillRow; declared: boolean };
const today = () => new Date().toISOString().slice(0, 10);
const parseMonth = (value: string) => /^\d{4}-\d{2}-01$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;

export function VendorWithholdingSlipModal({ invoice, vendorId, vendorName, open, loading = false, onClose, onSave }: VendorWithholdingSlipModalProps) {
  const { t } = useTranslation();
  const [number, setNumber] = useState('');
  const [slipDate, setSlipDate] = useState(today());
  const [period, setPeriod] = useState(`${today().slice(0, 7)}-01`);
  const [pphType, setPphType] = useState<PphType>((invoice.withheld_pph_type as PphType) || 'pph23');
  const [base, setBase] = useState('');
  const [amount, setAmount] = useState('');
  const [selected, setSelected] = useState<Record<string, Selected>>({});
  const initialized = useRef(false);
  const [baseTouched, setBaseTouched] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);
  const [submitError, setSubmitError] = useState<{ headline: string; detail?: string } | null>(null);
  const [intentId] = useState(() => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const candidateQuery = useVendorWithholdingCandidates({ vendorId, pphType, currency: invoice.currency, enabled: open });
  const candidates = useMemo(() => (candidateQuery.data?.pages ?? []).flatMap((page) => page.rows), [candidateQuery.data]);
  const starting = selected[invoice.id];
  useEffect(() => {
    const candidate = candidates.find((bill) => bill.invoice_id === invoice.id);
    if (!initialized.current && candidate) {
      initialized.current = true;
      setSelected((old) => ({ ...old, [invoice.id]: { bill: candidate, declared: false } }));
    }
  }, [candidates, invoice.id]);
  const selectedBills = Object.values(selected);
  const sum = sumSlipMoney(selectedBills.map(({ bill }) => bill.withheld_amount));
  const localizedCents = (raw: string) => {
    const parsed = parseMoneyInputAtScale(raw, 2);
    return parsed !== null && parsed > 0 ? parsePositiveSlipMoney(parsed.toFixed(2)) : null;
  };
  const entered = localizedCents(amount);
  const parsedBase = localizedCents(base);
  const selectedAmount = sum === null ? null : formatSlipCents(sum);
  const exactMatch = sum !== null && entered !== null && sum === (parseDecimalCents(entered) ?? -1);
  const canSubmit = Boolean(number.trim() && slipDate && slipDate <= today() && parsedBase && entered && exactMatch && selectedBills.length > 0 && selectedBills.length <= 100 && selectedBills.every(({ bill, declared }) => bill.withheld_pph_type === pphType && (bill.withheld_pph_type !== null || declared)) && parseMonth(period) && period <= `${today().slice(0, 7)}-01` && (parseDecimalCents(entered) ?? -1) <= (parseDecimalCents(parsedBase) ?? -1));

  // The initiating bill is retained even if the candidate page changes or it has already moved out of the page.
  const toggle = (bill: BillRow, checked: boolean) => setSelected((old) => {
    if (!checked) { const copy = { ...old }; delete copy[bill.invoice_id]; return copy; }
    if (Object.keys(old).length >= 100) return old;
    return { ...old, [bill.invoice_id]: { bill, declared: bill.withheld_pph_type !== null } };
  });
  const columns: Column<BillRow>[] = [
    { key: 'select', header: t('bupot.select', 'Select'), cell: (bill) => <Checkbox className="max-[767px]:!size-11" checked={Boolean(selected[bill.invoice_id])} onChange={(checked) => toggle(bill, checked)} label={t('bupot.selectBill', 'Select bill {{bill}}', { bill: bill.vi_number ?? bill.invoice_id })} /> },
    { key: 'bill', header: t('bupot.bill', 'Bill'), cell: (bill) => <span className="break-all">{bill.vi_number ?? bill.reference_number ?? bill.invoice_id}<span className="block break-words text-xs text-muted-foreground">{t('bupot.case', 'Case')}: {bill.procurement_id} · {t('bupot.billDate', 'Bill date')}: {bill.invoice_date ?? '—'}</span></span> },
    { key: 'withheld', header: t('bupot.withheld', 'Withheld'), align: 'num', cell: (bill) => <span className="tabular-nums">{formatCurrencyCents(Number(bill.withheld_amount), bill.currency)}</span> },
    { key: 'type', header: t('bupot.type', 'PPh type'), cell: (bill) => bill.withheld_pph_type ? (bill.withheld_pph_type === 'pph23' ? 'PPh 23' : 'PPh 4(2)') : <span className="flex items-center gap-2"><Checkbox className="max-[767px]:!size-11" disabled={!selected[bill.invoice_id]} checked={selected[bill.invoice_id]?.declared ?? false} onChange={(checked) => selected[bill.invoice_id] && setSelected((old) => ({ ...old, [bill.invoice_id]: { bill, declared: checked } }))} label={t('bupot.confirmUnknown', 'Confirm as {{type}} from issued slip', { type: pphType === 'pph23' ? 'PPh 23' : 'PPh 4(2)' })} /><span className="cursor-pointer" onClick={(event) => { if ((event.target as HTMLElement).closest('[role=checkbox]')) return; if (selected[bill.invoice_id]) setSelected((old) => ({ ...old, [bill.invoice_id]: { bill, declared: !old[bill.invoice_id].declared } })); }} onKeyDown={(event) => { if ((event.key === ' ' || event.key === 'Enter') && selected[bill.invoice_id]) { event.preventDefault(); setSelected((old) => ({ ...old, [bill.invoice_id]: { bill, declared: !old[bill.invoice_id].declared } })); } }} role="button" tabIndex={selected[bill.invoice_id] ? 0 : -1}>{selected[bill.invoice_id] ? t('bupot.confirmUnknown', 'Confirm as {{type}} from issued slip', { type: pphType === 'pph23' ? 'PPh 23' : 'PPh 4(2)' }) : t('bupot.selectFirst', 'Select this bill first.')}</span></span> },
  ];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSubmitError(null); setBaseTouched(true); setAmountTouched(true);
    if (!canSubmit) return;
    try {
      await onSave({ slipId: intentId, vendorId, slipNumber: number.trim(), slipDate, taxPeriod: period, pphType,
        taxBase: parsedBase!, withheldAmount: entered!, invoiceIds: Object.keys(selected).sort(),
        declaredInvoiceIds: Object.entries(selected).filter(([, v]) => v.bill.withheld_pph_type === null && v.declared).map(([id]) => id).sort() });
      onClose();
    } catch (error) {
      const refusal = bupotRefusal(error);
      const headlines = { stale: t('bupot.refusal.stale', 'This slip changed. Reload it before saving.'), conflict: t('bupot.refusal.conflict', 'A slip number or bill is already covered.'), invalidFacts: t('bupot.refusal.invalidFacts', 'Review the entered facts.'), ineligibleBill: t('bupot.refusal.ineligibleBill', 'One or more bills are no longer eligible.'), amountMismatch: t('bupot.refusal.amountMismatch', 'The issued amount does not match selected bills.'), typeConfirmation: t('bupot.refusal.typeConfirmation', 'Confirm the unknown bill types.'), billLimit: t('bupot.refusal.billLimit', 'A slip can cover at most 100 bills.'), notPermitted: t('bupot.refusal.notPermitted', 'You do not have permission to record this slip.'), notFound: t('bupot.refusal.notFound', 'The slip or bill is no longer available.'), voided: t('bupot.refusal.voided', 'This slip has already been voided.'), retrySameIntent: t('bupot.refusal.retrySameIntent', 'Retry with this same slip intent.') };
      const remedies = { reload: t('bupot.remedy.reload', 'Reload the latest facts.'), inspect: t('bupot.remedy.inspect', 'Inspect existing coverage.'), edit: t('bupot.remedy.edit', 'Edit the facts.'), retry: t('bupot.remedy.retry', 'Retry this same request.') };
      setSubmitError({ headline: headlines[refusal.key as keyof typeof headlines], detail: remedies[refusal.remedy] });
    }
  };

  return <EntityFormModal open={open} title={t('bupot.recordTitle', 'Record bukti potong')} submitLabel={t('bupot.record', 'Record bukti potong')} onSubmit={submit} onClose={onClose} loading={loading} dirty submitDisabled={!canSubmit} submitError={submitError} width="lg">
    <div className="[&_dt]:!text-foreground">
    <p className="mb-3 text-sm text-foreground">{t('bupot.vendor', 'Vendor')}: {vendorName || t('bupot.vendorUnavailable', 'Vendor details unavailable')} · {invoice.currency}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField label={t('bupot.slipNumber', 'Issued slip number')} value={number} onChange={setNumber} required maxLength={100} />
      <TextField label={t('bupot.slipDate', 'Slip date')} type="date" value={slipDate} onChange={setSlipDate} required />
      <TextField label={t('bupot.taxPeriodMonth', 'Tax period (month)')} type="month" value={period.slice(0, 7)} onChange={(value) => setPeriod(`${value}-01`)} required />
      <SelectField label={t('bupot.type', 'PPh type')} value={pphType} onChange={(value) => {
        const next = value as PphType; setPphType(next);
        setSelected((old) => Object.fromEntries(Object.entries(old).flatMap(([id, entry]) => entry.bill.withheld_pph_type && entry.bill.withheld_pph_type !== next ? [] : [[id, { ...entry, declared: entry.bill.withheld_pph_type === null ? false : entry.declared }]])));
      }} options={[{ value: 'pph23', label: 'PPh 23' }, { value: 'pph4_2', label: 'PPh 4(2)' }]} />
      <TextField label={`${t('bupot.taxBase', 'Tax base')} (${invoice.currency})`} value={base} onChange={setBase} onBlur={() => setBaseTouched(true)} error={baseTouched && !parsedBase ? t('bupot.invalidAmount', 'Enter a positive amount with at most two decimal places.') : undefined} inputMode="decimal" required />
      <TextField label={`${t('bupot.withheldAmount', 'Issued withheld amount')} (${invoice.currency})`} value={amount} onChange={setAmount} onBlur={() => setAmountTouched(true)} error={amountTouched && !entered ? t('bupot.invalidAmount', 'Enter a positive amount with at most two decimal places.') : amountTouched && parsedBase && entered && (parseDecimalCents(entered) ?? -1) > (parseDecimalCents(parsedBase) ?? -1) ? t('bupot.amountExceedsBase', 'Issued withholding cannot exceed the tax base.') : undefined} inputMode="decimal" required />
      {!canSubmit && (period > `${today().slice(0, 7)}-01` || !parseMonth(period)) && <FieldError>{t('bupot.invalidTaxPeriod', 'Choose a tax month no later than the current month.')}</FieldError>}
    </div>
    <p className="mt-2 text-xs text-foreground">{t('bupot.typeWarning', 'Confirm the PPh type from the issued external slip. PMO does not issue or cancel tax documents.')}</p>
    <div className="mt-4 flex items-center justify-between gap-3"><h3 className="font-semibold">{t('bupot.candidates', 'Eligible bills')}</h3><span className="text-sm tabular-nums">{t('bupot.selectedTotal', 'Selected total: {{currency}} {{amount}}', { currency: invoice.currency, amount: selectedAmount ?? '—' })}</span></div>
    {candidateQuery.isError ? <p role="alert" className="text-sm text-destructive-text">{t('bupot.candidateError', 'Unable to load eligible bills. Your entries are kept. Retry loading.')} <Button variant="outline" onClick={() => void candidateQuery.refetch()}>{t('bupot.retry', 'Retry')}</Button></p> : candidates.length === 0 && !candidateQuery.isLoading ? <ListState variant="empty" title={t('bupot.candidateEmpty', 'No eligible bills for this vendor, currency and PPh type.')} /> : <DataTable rows={candidates} columns={columns} rowKey={(bill) => bill.invoice_id} state={candidateQuery.isLoading ? 'loading' : undefined} />}
    {candidateQuery.hasNextPage && <Button type="button" variant="outline" onClick={() => void candidateQuery.fetchNextPage()} disabled={candidateQuery.isFetchingNextPage}>{t('bupot.loadMore', 'Load more bills')}</Button>}
    <div className="sticky bottom-0 z-10 mt-3 border-t border-border bg-popover p-3"><p className="text-sm font-medium text-foreground">{t('bupot.selectedBills', 'Selected bills ({{count}})', { count: selectedBills.length })}</p><p className="text-sm tabular-nums" aria-live="polite">{t('bupot.reconciliation', 'Selection {{sum}} · Slip {{amount}} · Difference {{difference}}', { sum: selectedAmount ? formatCurrencyCents(Number(selectedAmount), invoice.currency) : '—', amount: entered ? formatCurrencyCents(Number(entered), invoice.currency) : '—', difference: sum !== null && entered ? formatCurrencyCents(Number(formatSlipCents(sum - (parseDecimalCents(entered) ?? 0n))), invoice.currency) : '—' })}</p></div>
    {!exactMatch && amount && <FieldError>{t('bupot.amountMismatch', 'The slip amount must exactly equal selected bill withholding.')}</FieldError>}
    {starting && <p className="sr-only">{t('bupot.startingBillSelected', 'Starting bill selected')}</p>}
    </div>
  </EntityFormModal>;
}
