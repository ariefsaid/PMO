import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ListState, SelectField, TextField } from '@/src/components/ui';
import { useRentalCheck } from '@/src/hooks/useEquipmentAvailability';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatExactMoney, formatIsoDay } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import type { EquipmentStatus } from '@/src/lib/equipmentMetrics';

type Asset = { id: string; code: string; name: string };
type Props = { assets: Asset[]; today: string; monthFrom: string; statusLabel: (status: EquipmentStatus) => string };

export default function RentalInvoiceCheck({ assets, today, monthFrom, statusLabel }: Props) {
  const { t } = useTranslation();
  const check = useRentalCheck();
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
    try { await check.mutateAsync({ assetId: asset, from, to, invoice, reason: includeReason ? reason : undefined }); }
    catch (error) { setProblem(classifyMutationError(error).headline); }
  };
  const proofLink = async (path: string) => {
    try { const url = await repositories.equipmentAvailability.proofUrl(path); setProofLinks((previous) => ({ ...previous, [path]: url })); }
    catch (error) { setProblem(classifyMutationError(error).headline); }
  };
  if (!assets.length) return <ListState variant="empty" title={t('equipment:availability.noRentedOnPage', 'No rented equipment on this page')} />;
  return <section aria-labelledby="eav-check-h">
    <h2 id="eav-check-h" className="text-base font-semibold mb-2">{t('equipment:availability.checkHeading', 'Rental invoice check')}</h2>
    {problem && <p role="alert">{problem}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <SelectField label={t('equipment:availability.rentedAsset', 'Rented machine')} value={asset} onChange={(v) => { clear(); setAsset(v); }} options={[{ value: '', label: t('equipment:availability.choose', 'Choose…') }, ...assets.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))]} />
      <TextField label={t('equipment:availability.from', 'Invoice period from')} type="date" value={from} onChange={(v) => { clear(); setStart(v); }} />
      <TextField label={t('equipment:availability.to', 'Invoice period to')} type="date" value={to} onChange={(v) => { clear(); setEnd(v); }} />
      <TextField label={t('equipment:availability.invoiceAmount', 'Vendor invoice amount')} inputMode="decimal" value={invoice} onChange={(v) => { clear(); setInvoice(v); }} />
    </div>
    <Button variant="primary" className="mt-3" disabled={!asset || !from || !to || check.isPending} onClick={() => void run(false)}>{t('equipment:availability.runCheck', 'Check invoice')}</Button>
    {check.data && <div className="mt-4" role="region" aria-label={t('equipment:availability.result', 'Check result')}>
      <dl className="grid grid-cols-2 gap-1 text-sm max-w-md">
        <dt>{t('equipment:availability.rentalAmount', 'Rental amount')}</dt><dd className="text-right tabular-nums">{money(check.data.rental_amount, check.data.currency)}</dd>
        <dt>{t('equipment:availability.deduction', 'Downtime deduction')}</dt><dd className="text-right tabular-nums">{money(check.data.deduction, check.data.currency)}</dd>
        <dt>{t('equipment:availability.expected', 'Expected invoice')}</dt><dd className="text-right tabular-nums">{money(check.data.expected_amount, check.data.currency)}</dd>
        {check.data.difference != null && <><dt>{t('equipment:availability.difference', 'Invoice minus expected')}</dt><dd className="text-right tabular-nums">{money(check.data.difference, check.data.currency)}</dd></>}
      </dl>
      <h3 className="mt-3 text-sm font-semibold">{t('equipment:availability.days', 'Down days')}</h3>
      <ul className="text-sm">{check.data.days.map((d) => <li key={d.date}>{formatIsoDay(d.date)} · {statusLabel(d.status)} · {d.proven ? t('equipment:availability.proven', 'Proven') : d.deducted ? t('equipment:availability.unprovenIncluded', 'Unproven — included with reason') : t('equipment:availability.unproven', 'Unproven — not deducted')}
        {d.proofs.map((proof) => proofLinks[proof.file_path]
          ? <a key={proof.id} href={proofLinks[proof.file_path]} target="_blank" rel="noreferrer" className="ml-2 underline">{proof.file_name}</a>
          : <Button key={proof.id} variant="ghost" size="sm" onClick={() => void proofLink(proof.file_path)}>{t('equipment:availability.openProof', 'Open {{name}}', { name: proof.file_name })}</Button>)}
      </li>)}</ul>
      {check.data.unproven_days.length > 0 && !check.data.included_unproven_reason && <div className="mt-3">
        <TextField label={t('equipment:availability.reason', 'Reason to include unproven days')} value={reason} onChange={setReason} />
        <Button variant="outline" className="mt-2" disabled={!reason.trim() || check.isPending} onClick={() => void run(true)}>{t('equipment:availability.include', 'Include unproven days')}</Button>
      </div>}
    </div>}
  </section>;
}
