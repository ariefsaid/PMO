import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, DataTable, EntityFormModal, FieldError, SelectField, TextField, type Column } from '@/src/components/ui';
import type { ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';
import type { BillRow } from '@/src/lib/db/vendorWithholdingSlips';
import type { PphType } from '@/src/lib/vendorWithholding';
import { formatSlipCents, parsePositiveSlipMoney, parseDecimalCents, sumSlipMoney, bupotRefusal, type RecordSlipInput } from '@/src/lib/vendorWithholdingSlip';
import { useVendorWithholdingCandidates } from '@/src/hooks/useVendorWithholdingSlips';

export interface VendorWithholdingSlipModalProps {
  invoice: ProcurementInvoiceRow;
  vendorId: string;
  open: boolean;
  loading?: boolean;
  onClose: () => void;
  onSave: (input: RecordSlipInput) => Promise<unknown>;
}
type Selected = { bill: BillRow; declared: boolean };
const today = () => new Date().toISOString().slice(0, 10);

export function VendorWithholdingSlipModal({ invoice, vendorId, open, loading = false, onClose, onSave }: VendorWithholdingSlipModalProps) {
  const { t } = useTranslation();
  const [number, setNumber] = useState('');
  const [slipDate, setSlipDate] = useState(today());
  const [period, setPeriod] = useState(`${today().slice(0, 7)}-01`);
  const [pphType, setPphType] = useState<PphType>((invoice.withheld_pph_type as PphType) || 'pph23');
  const [base, setBase] = useState('');
  const [amount, setAmount] = useState('');
  const [selected, setSelected] = useState<Record<string, Selected>>({});
  const [submitError, setSubmitError] = useState<{ headline: string; detail?: string } | null>(null);
  const [intentId] = useState(() => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const candidateQuery = useVendorWithholdingCandidates({ vendorId, pphType, currency: invoice.currency, enabled: open });
  const candidates = useMemo(() => (candidateQuery.data?.pages ?? []).flatMap((page) => page.rows), [candidateQuery.data]);
  const starting = selected[invoice.id];
  useEffect(() => {
    const candidate = candidates.find((bill) => bill.invoice_id === invoice.id);
    if (candidate && !selected[invoice.id]) setSelected((old) => ({ ...old, [invoice.id]: { bill: candidate, declared: false } }));
  }, [candidates, invoice.id, selected]);
  const selectedBills = Object.values(selected);
  const sum = sumSlipMoney(selectedBills.map(({ bill }) => bill.withheld_amount));
  const entered = parsePositiveSlipMoney(amount);
  const selectedAmount = sum === null ? null : formatSlipCents(sum);
  const exactMatch = sum !== null && entered !== null && sum === parseDecimalCents(entered);
  const canSubmit = Boolean(number.trim() && parsePositiveSlipMoney(base) && entered && exactMatch && selectedBills.length > 0 && selectedBills.length <= 100 && selectedBills.every(({ bill, declared }) => bill.withheld_pph_type !== null || declared));

  // The initiating bill is retained even if the candidate page changes or it has already moved out of the page.
  const toggle = (bill: BillRow, checked: boolean) => setSelected((old) => {
    if (!checked) { const copy = { ...old }; delete copy[bill.invoice_id]; return copy; }
    if (Object.keys(old).length >= 100) return old;
    return { ...old, [bill.invoice_id]: { bill, declared: bill.withheld_pph_type !== null } };
  });
  const columns: Column<BillRow>[] = [
    { key: 'select', header: t('bupot.select', 'Select'), cell: (bill) => <Checkbox checked={Boolean(selected[bill.invoice_id])} onChange={(checked) => toggle(bill, checked)} label={t('bupot.selectBill', 'Select bill {{bill}}', { bill: bill.vi_number ?? bill.invoice_id })} /> },
    { key: 'bill', header: t('bupot.bill', 'Bill'), cell: (bill) => <span className="break-all">{bill.vi_number ?? bill.reference_number ?? bill.invoice_id}</span> },
    { key: 'withheld', header: t('bupot.withheld', 'Withheld'), align: 'num', cell: (bill) => <span className="tabular-nums">{bill.currency} {bill.withheld_amount}</span> },
    { key: 'type', header: t('bupot.type', 'PPh type'), cell: (bill) => bill.withheld_pph_type ?? <span className="inline-flex items-center gap-2"><Checkbox checked={selected[bill.invoice_id]?.declared ?? false} onChange={(checked) => selected[bill.invoice_id] && setSelected((old) => ({ ...old, [bill.invoice_id]: { bill, declared: checked } }))} label={t('bupot.confirmUnknown', 'Confirm {{bill}} as {{type}}', { bill: bill.vi_number ?? bill.invoice_id, type: pphType })} /><button type="button" className="text-left underline" onClick={() => selected[bill.invoice_id] && setSelected((old) => ({ ...old, [bill.invoice_id]: { bill, declared: !old[bill.invoice_id].declared } }))}>{t('bupot.unknownType', 'Unknown — confirm from slip')}</button></span> },
  ];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSubmitError(null);
    if (!canSubmit) return;
    try {
      await onSave({ slipId: intentId, vendorId, slipNumber: number.trim(), slipDate, taxPeriod: period, pphType,
        taxBase: parsePositiveSlipMoney(base)!, withheldAmount: entered!, invoiceIds: Object.keys(selected).sort(),
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
    <p className="mb-3 text-sm text-foreground">{t('bupot.vendor', 'Vendor')}: {vendorId} · {invoice.currency}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField label={t('bupot.slipNumber', 'Issued slip number')} value={number} onChange={setNumber} required maxLength={100} />
      <TextField label={t('bupot.slipDate', 'Slip date')} type="date" value={slipDate} onChange={setSlipDate} required />
      <TextField label={t('bupot.taxPeriod', 'Tax period')} type="date" value={period} onChange={setPeriod} required />
      <SelectField label={t('bupot.type', 'PPh type')} value={pphType} onChange={(value) => setPphType(value as PphType)} options={[{ value: 'pph23', label: 'PPh 23' }, { value: 'pph4_2', label: 'PPh 4(2)' }]} />
      <TextField label={`${t('bupot.taxBase', 'Tax base')} (${invoice.currency})`} value={base} onChange={setBase} onBlur={() => setBase((v) => parsePositiveSlipMoney(v) ?? v)} inputMode="decimal" required />
      <TextField label={`${t('bupot.withheldAmount', 'Issued withheld amount')} (${invoice.currency})`} value={amount} onChange={setAmount} inputMode="decimal" required />
    </div>
    <p className="mt-2 text-xs text-foreground">{t('bupot.typeWarning', 'Confirm the PPh type from the issued external slip. PMO does not issue or cancel tax documents.')}</p>
    <div className="mt-4 flex items-center justify-between gap-3"><h3 className="font-semibold">{t('bupot.candidates', 'Eligible bills')}</h3><span className="text-sm tabular-nums">{t('bupot.selectedTotal', 'Selected total: {{currency}} {{amount}}', { currency: invoice.currency, amount: selectedAmount ?? '—' })}</span></div>
    {candidateQuery.isError ? <p role="alert" className="text-sm text-destructive">{t('bupot.loadError', 'Unable to load eligible bills')} <Button variant="outline" onClick={() => void candidateQuery.refetch()}>{t('admin.retry', 'Retry')}</Button></p> : <DataTable rows={candidates} columns={columns} rowKey={(bill) => bill.invoice_id} state={candidateQuery.isLoading ? 'loading' : candidates.length ? undefined : 'empty'} />}
    {candidateQuery.hasNextPage && <Button type="button" variant="outline" onClick={() => void candidateQuery.fetchNextPage()} disabled={candidateQuery.isFetchingNextPage}>{t('bupot.loadMore', 'Load more bills')}</Button>}
    <p className="mt-3 text-sm" aria-live="polite">{t('bupot.reconciliation', 'Selection {{sum}} · Slip {{amount}} · Difference {{difference}}', { sum: selectedAmount ?? '—', amount: entered ?? '—', difference: sum !== null && entered ? formatSlipCents(sum - parseDecimalCents(entered)!) : '—' })}</p>
    {!exactMatch && amount && <FieldError>{t('bupot.amountMismatch', 'The slip amount must exactly equal selected bill withholding.')}</FieldError>}
    {starting && <p className="sr-only">{t('bupot.startingBillSelected', 'Starting bill selected')}</p>}
    </div>
  </EntityFormModal>;
}
