import React, { useState } from 'react';
import { DateField } from '@/src/components/ui/DateField';
import { useTranslation } from 'react-i18next';
import { Button, NumberField, SelectField, TextField, useToast } from '@/src/components/ui';
import { useCompanies } from '@/src/hooks/useCompanies';
import { useRentalTerms, useRentalTermHistory, useEquipmentOwnership, useChangeRentalRate, useEndRentalTerm } from '@/src/hooks/useEquipmentAvailability';
import { formatExactMoney, formatIsoDay, normalizeLocalizedDecimal } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

type Asset = { id: string; ownership?: string | null; in_service_on?: string | null };
export function EquipmentRentalTerms({ asset }: { asset: Asset }) {
  const { t } = useTranslation(); const { toast } = useToast();
  const termAsset = asset.id;
  const vendors = useCompanies('Vendor', { enabled: true });
  const saveTerm = useRentalTerms(); const saveOwnership = useEquipmentOwnership(); const changeRate = useChangeRentalRate();
  const terms = useRentalTermHistory(termAsset, true);
  const endTerm = useEndRentalTerm();
  const [endingTermId, setEndingTermId] = useState<string | null>(null);
  const [lastRentalDay, setLastRentalDay] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [inService, setInService] = useState(asset.in_service_on ?? '');
  const [vendor, setVendor] = useState(''); const [rate, setRate] = useState('');
  const [basis, setBasis] = useState<'hour' | 'day' | 'month'>('day'); const [currency, setCurrency] = useState('IDR');
  const [rentedFrom, setRentedFrom] = useState(''); const [rentedTo, setRentedTo] = useState('');
  // The typed rate is read in the viewer's number convention and sent as a canonical decimal (#2618).
  const canonicalRate = () => {
    const value = normalizeLocalizedDecimal(rate, 2);
    if (value === null) setProblem(t('equipment:availability.amountInvalid', 'Enter the amount as a number with at most 2 decimals'));
    return value;
  };
  const submitTerm = async () => {
    setProblem(null);
    const canonical = canonicalRate(); if (canonical === null) return;
    try { await saveTerm.mutateAsync({ asset_id: termAsset, vendor_id: vendor, rate: canonical, basis, currency, rented_from: rentedFrom, rented_to: rentedTo || null }); toast(t('equipment:availability.saved', 'Status saved'), undefined, 'success'); }
    catch (err) { setProblem(classifyMutationError(err).headline); }
  };
  const submitEnd = async (termId: string) => {
    setProblem(null);
    try {
      await endTerm.mutateAsync({ termId, date: lastRentalDay });
      setEndingTermId(null);
      toast(t('equipment:availability.periodEnded', 'Rental period ended'), undefined, 'success');
    } catch (err) {
      setProblem(classifyMutationError(err).headline);
    }
  };
  return <>{problem && <p role="alert" className="mb-3 text-sm text-destructive-text">{problem}</p>}
        <section aria-labelledby="eav-terms-h" className="mb-6">
          <h2 id="eav-terms-h" className="text-base font-semibold mb-2">{t('equipment:availability.terms', 'Rental terms')}</h2>
          {terms.isError && <p role="alert">{t('equipment:availability.termsError', 'Could not load rental terms')}</p>}
          {(terms.data?.length ?? 0) > 0 && <ul className="mb-3">
            {terms.data?.map((term) => <li key={term.id}>{formatIsoDay(term.rented_from)} – {term.rented_to ? formatIsoDay(term.rented_to) : '…'} · {vendors.data?.find((v) => v.id === term.vendor_id)?.name ?? term.vendor_id} · {formatExactMoney(String(term.rate), term.currency, getNumberLocale(), { trimZeroFraction: true }) ?? '—'} / {term.basis === 'hour' ? t('equipment:availability.hour', 'Hour') : term.basis === 'day' ? t('equipment:availability.day', 'Day') : t('equipment:availability.month', 'Month')}
              {term.rented_to === null && (
                endingTermId === term.id ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <DateField label={t('equipment:availability.lastRentalDay', 'Last rental day')} value={lastRentalDay} onChange={setLastRentalDay} min={term.rented_from} disabled={endTerm.isPending} />
                    <Button variant="primary" disabled={!lastRentalDay || lastRentalDay < term.rented_from || endTerm.isPending} onClick={() => void submitEnd(term.id)}>
                      {t('equipment:availability.confirmEnd', 'Confirm end date')}
                    </Button>
                    <Button variant="outline" disabled={endTerm.isPending} onClick={() => { setEndingTermId(null); setProblem(null); }}>
                      {t('cancel', 'Cancel')}
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" className="ml-2" disabled={endTerm.isPending} onClick={() => { setEndingTermId(term.id); setLastRentalDay(''); setProblem(null); }}>
                    {t('equipment:availability.endPeriod', 'End rental period')}
                  </Button>
                )
              )}
            </li>)}
          </ul>}
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label={t('equipment:availability.vendor', 'Vendor')} value={vendor} onChange={setVendor} options={[{ value: '', label: t('equipment:availability.choose', 'Choose…') }, ...(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))]} />
            <NumberField localeAware label={t('equipment:availability.rate', 'Rate')} value={rate} onChange={setRate} />
            <SelectField label={t('equipment:availability.basis', 'Rate basis')} value={basis} onChange={(v) => setBasis(v as 'hour' | 'day' | 'month')} options={[{ value: 'hour', label: t('equipment:availability.hour', 'Hour') }, { value: 'day', label: t('equipment:availability.day', 'Day') }, { value: 'month', label: t('equipment:availability.month', 'Month') }]} />
            <TextField label={t('equipment:availability.currency', 'Currency')} value={currency} onChange={setCurrency} />
            <DateField label={t('equipment:availability.rentedFrom', 'Rental start')} value={rentedFrom} onChange={setRentedFrom} />
            <DateField label={t('equipment:availability.inService', 'In service from (optional)')} value={inService} onChange={setInService} />
            <DateField label={t('equipment:availability.rentedTo', 'Rental end (optional)')} value={rentedTo} onChange={setRentedTo} />
          </div>
          <Button variant="primary" className="mt-3" disabled={!termAsset || !vendor || !rate || !rentedFrom || saveTerm.isPending} onClick={() => void submitTerm()}>{t('equipment:availability.saveTerms', 'Save rental terms')}</Button>
          <details className="mt-3"><summary>{t('equipment:availability.otherAssetActions', 'Other asset actions')}</summary>
          <Button variant="outline" className="mt-3 ml-2" disabled={!termAsset || saveOwnership.isPending} onClick={() => { const a = asset; void saveOwnership.mutateAsync({ assetId: termAsset, ownership: a?.ownership === 'rented' ? 'rented' : 'owned', inServiceOn: inService || null }).then(() => toast(t('equipment:availability.inServiceSaved', 'In-service date saved'), undefined, 'success')).catch((err: unknown) => setProblem(classifyMutationError(err).headline)); }}>{t('equipment:availability.saveInService', 'Save in-service date')}</Button>
          <Button variant="outline" className="mt-3 ml-2" disabled={!termAsset || saveOwnership.isPending} onClick={() => { setProblem(null); void saveOwnership.mutateAsync({ assetId: termAsset, ownership: 'owned', inServiceOn: inService || null }).then(() => toast(t('equipment:availability.ownershipSaved', 'Ownership saved'), undefined, 'success')).catch((err: unknown) => setProblem(classifyMutationError(err).headline)); }}>{t('equipment:availability.markOwned', 'Mark owned')}</Button>
          <Button variant="outline" className="mt-3 ml-2" disabled={!termAsset || !rate || !rentedFrom || changeRate.isPending} onClick={() => { setProblem(null); const canonical = canonicalRate(); if (canonical === null) return; void changeRate.mutateAsync({ assetId: termAsset, date: rentedFrom, rate: canonical }).then(() => toast(t('equipment:availability.rateChanged', 'Rate changed'), undefined, 'success')).catch((err: unknown) => setProblem(classifyMutationError(err).headline)); }}>{t('equipment:availability.changeRate', 'Change rate from date')}</Button>
          </details>
        </section>
  </>;
}
