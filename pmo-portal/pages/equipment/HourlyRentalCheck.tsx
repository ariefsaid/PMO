import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, NumberField, SelectField, TextField } from '@/src/components/ui';
import { useRentalInvoiceChoices, useRefreshRentalChecks } from '@/src/hooks/useEquipmentAvailability';
import RentalCheckHistory from './RentalCheckHistory';
import { DateField } from '@/src/components/ui/DateField';
import { repositories } from '@/src/lib/repositories';
import type { HourlyRentalResult } from '@/src/lib/db/equipmentAvailability';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { normalizeLocalizedDecimal, formatExactMoney } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';

export default function HourlyRentalCheck({ assetId, from, to }: { assetId: string; from: string; to: string }) {
  const { t } = useTranslation('equipment');
  const [contracted, setContracted] = useState('');
  const [invoice, setInvoice] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [note, setNote] = useState('');
  const invoices = useRentalInvoiceChoices(assetId);
  const refreshChecks = useRefreshRentalChecks();
  const [broken, setBroken] = useState<{ date: string; hours: string }[]>([]);
  const [result, setResult] = useState<HourlyRentalResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  const clear = () => { setResult(null); setProblem(null); };
  const run = async (state: 'checked' | 'disputed' | null) => {
    clear(); setBusy(true);
    try {
      const contractedHours = normalizeLocalizedDecimal(contracted, 2);
      const invoiceHours = normalizeLocalizedDecimal(invoice, 2);
      const days = broken.map((d) => ({ date: d.date, hours: normalizeLocalizedDecimal(d.hours, 2) }));
      if (contractedHours === null || invoiceHours === null || days.some((d) => d.hours === null)) {
        setProblem(t('availability.amountInvalid', 'Enter the amount as a number with at most 2 decimals')); return;
      }
      setResult(await repositories.equipmentAvailability.hourlyRentalCheck({ assetId, from, to, contractedHours, invoiceHours,
        broken: days as { date: string; hours: string }[], state, invoiceId: invoiceId || undefined, note }));
      if (state) await refreshChecks();
    } catch (error) { setProblem(classifyMutationError(error).headline); }
    finally { setBusy(false); }
  };
  const money = (v: string) => formatExactMoney(v, result!.currency, getNumberLocale(), { trimZeroFraction: true }) ?? '—';
  return <section className="mt-3" aria-label={t('availability.hourly', 'Hourly rental')}>
    <RentalCheckHistory assetId={assetId} />
    {problem && <p role="alert">{problem}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <NumberField localeAware label={t('hourly.contracted', 'Contracted hours')} value={contracted} disabled={busy} onChange={(v) => { clear(); setContracted(v); }} />
      <NumberField localeAware label={t('hourly.invoice', 'Invoice hours')} value={invoice} disabled={busy} onChange={(v) => { clear(); setInvoice(v); }} />
    </div>
    <div className="grid gap-3 sm:grid-cols-2 mt-3">
      <SelectField label={t('hourly.supplierInvoice', 'Supplier invoice')} value={invoiceId} disabled={busy || invoices.isPending} onChange={(v) => { clear(); setInvoiceId(v); }}
        options={[{ value: '', label: t('availability.choose', 'Choose…') }, ...(invoices.data ?? []).map((i) => ({ value: i.id, label: i.label }))]} />
      <TextField label={t('hourly.note', 'Officer note')} value={note} disabled={busy} onChange={(v) => { clear(); setNote(v); }} />
    </div>
    {invoices.isError && <p role="alert">{t('hourly.invoicesFailed', 'Supplier invoices could not be loaded.')}</p>}
    <p className="mt-2 text-sm text-muted-foreground">{t('hourly.evidence', 'Attach dated evidence in Availability before checking. Only proven broken hours are deducted.')}</p>
    {broken.map((day, i) => <div key={i} className="grid gap-3 sm:grid-cols-3 mt-2">
      <DateField label={t('hourly.date', 'Breakdown date')} value={day.date} disabled={busy} onChange={(v) => { clear(); setBroken(broken.map((d, n) => n === i ? { ...d, date: v ?? '' } : d)); }} />
      <NumberField localeAware label={t('hourly.hours', 'Broken hours')} value={day.hours} disabled={busy} onChange={(v) => { clear(); setBroken(broken.map((d, n) => n === i ? { ...d, hours: v } : d)); }} />
      <Button variant="ghost" disabled={busy} onClick={() => { clear(); setBroken(broken.filter((_, n) => n !== i)); }}>{t('hourly.remove', 'Remove breakdown')}</Button>
    </div>)}
    <div className="flex flex-wrap gap-2 mt-3">
      <Button variant="outline" disabled={busy || broken.length >= 400} onClick={() => { clear(); setBroken([...broken, { date: from, hours: '' }]); }}>{t('hourly.add', 'Add broken hours')}</Button>
      <Button variant="outline" disabled={busy || !assetId || !contracted || !invoice} onClick={() => void run(null)}>{t('hourly.compare', 'Compare hours')}</Button>
      <Button variant="primary" disabled={busy || !assetId || !contracted || !invoice || !invoiceId} onClick={() => void run('checked')}>{t('hourly.checkedAction', 'Mark checked')}</Button>
      <Button variant="outline" disabled={busy || !assetId || !contracted || !invoice || !invoiceId || !note.trim()} onClick={() => void run('disputed')}>{t('hourly.disputedAction', 'Mark disputed')}</Button>
    </div>
    {result && <div className="mt-3">
      {result.state && <p role="status">{result.state === 'checked' ? t('hourly.checked', 'Checked') : t('hourly.disputed', 'Disputed')}</p>}
      <dl className="grid grid-cols-2 gap-2 max-w-md text-sm">
        <dt>{t('hourly.contracted', 'Contracted hours')}</dt><dd>{result.contracted_hours}</dd>
        <dt>{t('hourly.proven', 'Proven broken hours')}</dt><dd>{result.broken_hours}</dd>
        <dt>{t('hourly.billable', 'Billable hours')}</dt><dd>{result.billable_hours}</dd>
        <dt>{t('hourly.invoice', 'Invoice hours')}</dt><dd>{result.invoice_hours}</dd>
        <dt>{t('hourly.rate', 'Hourly rate')}</dt><dd>{money(result.rate)}</dd>
        <dt>{t('availability.deduction', 'Downtime deduction')}</dt><dd>{money(result.deduction)}</dd>
        <dt>{t('availability.expected', 'Expected invoice')}</dt><dd>{money(result.expected_amount)}</dd>
      </dl>
      <ul className="mt-2 text-sm">{result.days.map((day) => <li key={day.date}>{day.date} · {day.hours} · {day.proven ? t('availability.proven', 'Proven') : t('availability.unproven', 'Unproven — not deducted')}
        {day.proofs.map((proof) => links[proof.file_path] ? <a key={proof.id} className="ml-2 underline" href={links[proof.file_path]} target="_blank" rel="noreferrer">{proof.file_name}</a>
          : <Button key={proof.id} variant="ghost" disabled={busy} onClick={() => void repositories.equipmentAvailability.proofUrl(proof.file_path).then((url) => setLinks({ ...links, [proof.file_path]: url })).catch((error: unknown) => setProblem(classifyMutationError(error).headline))}>{t('availability.openProof', 'Open {{name}}', { name: proof.file_name })}</Button>)}
      </li>)}</ul>
    </div>}
  </section>;
}
