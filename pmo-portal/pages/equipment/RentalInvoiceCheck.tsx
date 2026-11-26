import HourlyRentalCheck from './HourlyRentalCheck';
import React, { useEffect, useState } from 'react';
import { DateField } from '@/src/components/ui/DateField';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, DataTable, ListState, NumberField, RecordSection, SelectField, TextField, type Column } from '@/src/components/ui';
import { useRentalCheck } from '@/src/hooks/useEquipmentAvailability';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatExactMoney, formatIsoDay, normalizeLocalizedDecimal } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import type { EquipmentStatus } from '@/src/lib/equipmentMetrics';
import type { RentalCheckDay } from '@/src/lib/db/equipmentAvailability';

type Asset = { id: string; code: string; name: string };
type Props = { assets: Asset[]; today: string; monthFrom: string; statusLabel: (status: EquipmentStatus) => string; canIncludeUnproven?: boolean };

export default function RentalInvoiceCheck({ assets, today, monthFrom, statusLabel, canIncludeUnproven = true }: Props) {
  const { t } = useTranslation();
  const check = useRentalCheck();
  const [hourly, setHourly] = useState(false);
  const [asset, setAsset] = useState('');
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [invoice, setInvoice] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [proofLinks, setProofLinks] = useState<Record<string, string>>({});
  const money = (value: string, currency: string | null) => currency ? (formatExactMoney(String(value), currency, getNumberLocale(), { trimZeroFraction: true }) ?? '—') : '—';
  const from = start ?? monthFrom; const to = end ?? today;
  const resetCheck = check.reset;
  useEffect(() => {
    if (asset && !assets.some((a) => a.id === asset)) {
      setAsset(''); setProofLinks({}); setProblem(null); setReason(''); resetCheck();
    }
  }, [asset, assets, resetCheck]);
  const clear = () => { check.reset(); setProofLinks({}); setProblem(null); setReason(''); };
  const run = async (includeReason: boolean) => {
    setProblem(null); setProofLinks({});
    // The typed amount is read in the viewer's number convention and sent as a canonical decimal (#2618).
    const amount = invoice.trim() === '' ? '' : normalizeLocalizedDecimal(invoice, 2);
    if (amount === null) { setProblem(t('equipment:availability.amountInvalid', 'Enter the amount as a number with at most 2 decimals')); return; }
    try { await check.mutateAsync({ assetId: asset, from, to, invoice: amount, reason: includeReason ? reason : undefined }); }
    catch (error) { setProblem(classifyMutationError(error).headline); }
  };
  const proofLink = async (path: string) => {
    try { const url = await repositories.equipmentAvailability.proofUrl(path); setProofLinks((previous) => ({ ...previous, [path]: url })); }
    catch (error) { setProblem(classifyMutationError(error).headline); }
  };
  if (!assets.length) return <ListState variant="empty" title={t('equipment:availability.noRentedOnPage', 'No rented equipment on this page')} />;
  return <RecordSection headingId="eav-check-h" title={t('equipment:availability.checkHeading', 'Rental invoice check')}>
    {problem && <p role="alert" className="mb-3 text-destructive-text">{problem}</p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SelectField label={t('equipment:availability.rentedAsset', 'Rented machine')} value={asset} onChange={(v) => { clear(); setAsset(v); }} options={[{ value: '', label: t('equipment:availability.choose', 'Choose…') }, ...assets.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))]} />
      <DateField label={t('equipment:availability.from', 'Invoice period from')} value={from} onChange={(v) => { clear(); setStart(v); }} />
      <DateField label={t('equipment:availability.to', 'Invoice period to')} value={to} onChange={(v) => { clear(); setEnd(v); }} />
      {!hourly && <NumberField localeAware label={t('equipment:availability.invoiceAmount', 'Vendor invoice amount')} value={invoice} onChange={(v) => { clear(); setInvoice(v); }} />}
    </div>
    <div className="mt-3"><Checkbox label={t('equipment:availability.hourly', 'Hourly rental')} checked={hourly} onChange={(v) => { clear(); setHourly(v); }}>{t('equipment:availability.hourly', 'Hourly rental')}</Checkbox></div>
    {hourly ? <HourlyRentalCheck key={`${asset}:${from}:${to}`} assetId={asset} from={from} to={to} /> : <>
    <Button variant="primary" className="mt-3" disabled={!asset || !from || !to || check.isPending} onClick={() => void run(false)}>{t('equipment:availability.runCheck', 'Check invoice')}</Button>
    {check.data && <div className="mt-4" role="region" aria-label={t('equipment:availability.result', 'Check result')}>
      <dl className="grid max-w-md grid-cols-2 gap-x-6 gap-y-1">
        <dt>{t('equipment:availability.rentalAmount', 'Rental amount')}</dt><dd className="text-right tabular-nums">{money(check.data.rental_amount, check.data.currency)}</dd>
        <dt>{t('equipment:availability.deduction', 'Downtime deduction')}</dt><dd className="text-right tabular-nums">{money(check.data.deduction, check.data.currency)}</dd>
        <dt>{t('equipment:availability.expected', 'Expected invoice')}</dt><dd className="text-right tabular-nums">{money(check.data.expected_amount, check.data.currency)}</dd>
      </dl>
      {check.data.difference != null && (() => {
        const diff = Number(check.data.difference);
        const amount = money(check.data.difference.replace(/^-/, ''), check.data.currency);
        return <p role="status" className="mt-3 text-group font-semibold">{diff > 0
          ? t('equipment:availability.overBilled', 'Over-billed by {{amount}}', { amount })
          : diff < 0 ? t('equipment:availability.underBilled', 'Under-billed by {{amount}}', { amount })
            : t('equipment:availability.invoiceMatches', 'The invoice matches the expected amount')}</p>;
      })()}
      <p className="mt-1 text-muted-foreground">{t('equipment:availability.unrecordedRented', 'Days with no status recorded are counted as rented; only recorded down days are deducted.')}</p>
      <h3 className="mt-6 mb-2 font-semibold">{t('equipment:availability.days', 'Down days')}</h3>
      <DataTable<RentalCheckDay> embedded rows={check.data.days} columns={[
        { key: 'date', header: t('equipment:availability.day', 'Day'), kind: 'primary', rowHeader: true, cell: (d) => <span className="whitespace-nowrap">{formatIsoDay(d.date)}</span> },
        { key: 'status', header: t('equipment:availability.statusCol', 'Status'), cell: (d) => statusLabel(d.status) },
        { key: 'proof', header: t('equipment:availability.proof', 'Proof'), cell: (d) => d.proven ? t('equipment:availability.proven', 'Proven') : d.deducted ? t('equipment:availability.unprovenIncluded', 'Unproven — included with reason') : t('equipment:availability.unproven', 'Unproven — not deducted') },
        { key: 'files', header: t('equipment:availability.files', 'Files'), cell: (d) => d.proofs.length === 0 ? null : <span className="flex flex-wrap gap-1">{d.proofs.map((proof) => proofLinks[proof.file_path]
          ? <a key={proof.id} href={proofLinks[proof.file_path]} target="_blank" rel="noreferrer" className="text-primary-text underline">{proof.file_name}</a>
          : <Button key={proof.id} variant="ghost" size="sm" onClick={() => void proofLink(proof.file_path)}>{t('equipment:availability.openProof', 'Open {{name}}', { name: proof.file_name })}</Button>)}</span> },
      ] satisfies Column<RentalCheckDay>[]} rowKey={(d) => d.date} tableId="rental-check-days" accessibleName={t('equipment:availability.days', 'Down days')}
        state={check.data.days.length === 0 ? 'empty' : undefined} emptyTitle={t('equipment:availability.noDownDays', 'No down days in this period')} />
      {check.data.unproven_days.length > 0 && !check.data.included_unproven_reason && !canIncludeUnproven && <p className="mt-3 text-sm text-muted-foreground">{t('equipment:availability.onlyFinanceIncludes', 'Unproven down days are not deducted. Only an Admin or Finance user can include them, with a reason.')}</p>}
      {check.data.unproven_days.length > 0 && !check.data.included_unproven_reason && canIncludeUnproven && <div className="mt-3">
        <TextField label={t('equipment:availability.reason', 'Reason to include unproven days')} value={reason} onChange={setReason} />
        <Button variant="outline" className="mt-2" disabled={!reason.trim() || check.isPending} onClick={() => void run(true)}>{t('equipment:availability.include', 'Include unproven days')}</Button>
      </div>}
    </div>}
    </>}
  </RecordSection>;
}
