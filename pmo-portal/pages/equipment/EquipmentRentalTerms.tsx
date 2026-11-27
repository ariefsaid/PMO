import React, { useState } from 'react';
import { DateField } from '@/src/components/ui/DateField';
import { useTranslation } from 'react-i18next';
import {
  Button, ConfirmDialog, DataTable, EntityFormModal, FormGrid, NumberField, RecordMenu, RecordSection, SelectField, TextField, useToast, type Column,
} from '@/src/components/ui';
import { useCompanies } from '@/src/hooks/useCompanies';
import { useRentalTerms, useRentalTermHistory, useEquipmentOwnership, useChangeRentalRate, useEndRentalTerm } from '@/src/hooks/useEquipmentAvailability';
import type { RentalTermRow } from '@/src/lib/db/equipmentAvailability';
import { formatExactMoney, formatIsoDay, normalizeLocalizedDecimal } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

type Asset = { id: string; ownership?: string | null; in_service_on?: string | null };
type Basis = 'hour' | 'day' | 'month';
type Dialog = 'terms' | 'rate' | 'inService' | 'owned' | null;

/**
 * A machine's rental terms: what we pay, to whom, from when (one row per term), with the four writes behind the
 * section's actions — add terms, change the rate from a date, the in-service date, mark owned. Each opens its own
 * dialog, so the page reads as a record and not as an open form. The RPCs decide who may write.
 */
export function EquipmentRentalTerms({ asset }: { asset: Asset }) {
  const { t } = useTranslation(); const { toast } = useToast();
  const termAsset = asset.id;
  const vendors = useCompanies('Vendor', { enabled: true });
  const saveTerm = useRentalTerms(); const saveOwnership = useEquipmentOwnership(); const changeRate = useChangeRentalRate();
  const terms = useRentalTermHistory(termAsset, true);
  const endTerm = useEndRentalTerm();
  const [endingTermId, setEndingTermId] = useState<string | null>(null);
  const [lastRentalDay, setLastRentalDay] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [inService, setInService] = useState(asset.in_service_on ?? '');
  const [vendor, setVendor] = useState(''); const [rate, setRate] = useState('');
  const [basis, setBasis] = useState<Basis>('day'); const [currency, setCurrency] = useState('IDR');
  const [rentedFrom, setRentedFrom] = useState(''); const [rentedTo, setRentedTo] = useState('');
  const basisName = (b: string) => b === 'hour' ? t('equipment:availability.hour', 'Hour') : b === 'day' ? t('equipment:availability.day', 'Day') : t('equipment:availability.month', 'Month');
  const vendorName = (id: string) => vendors.data?.find((v) => v.id === id)?.name ?? id;
  const open = (next: Dialog) => { setProblem(null); setDialog(next); };
  const close = () => { setProblem(null); setDialog(null); };
  // The typed rate is read in the viewer's number convention and sent as a canonical decimal (#2618).
  const canonicalRate = () => {
    const value = normalizeLocalizedDecimal(rate, 2);
    if (value === null) setProblem(t('equipment:availability.amountInvalid', 'Enter the amount as a number with at most 2 decimals'));
    return value;
  };
  const done = (message: string) => { toast(message, undefined, 'success'); setRate(''); close(); };
  const submitTerm = async () => {
    setProblem(null);
    const canonical = canonicalRate(); if (canonical === null) return;
    try {
      await saveTerm.mutateAsync({ asset_id: termAsset, vendor_id: vendor, rate: canonical, basis, currency, rented_from: rentedFrom, rented_to: rentedTo || null });
      setVendor(''); setRentedFrom(''); setRentedTo('');
      done(t('equipment:availability.termsSaved', 'Rental terms saved'));
    } catch (err) { setProblem(classifyMutationError(err).headline); }
  };
  const submitRate = async () => {
    setProblem(null);
    const canonical = canonicalRate(); if (canonical === null) return;
    try { await changeRate.mutateAsync({ assetId: termAsset, date: rentedFrom, rate: canonical }); setRentedFrom(''); done(t('equipment:availability.rateChanged', 'Rate changed')); }
    catch (err) { setProblem(classifyMutationError(err).headline); }
  };
  const submitOwnership = async (ownership: 'owned' | 'rented', message: string) => {
    setProblem(null);
    try { await saveOwnership.mutateAsync({ assetId: termAsset, ownership, inServiceOn: inService || null }); done(message); }
    catch (err) { setProblem(classifyMutationError(err).headline); }
  };

  const submitEnd = async (termId: string) => {
    setProblem(null);
    try {
      await endTerm.mutateAsync({ termId, date: lastRentalDay });
      setEndingTermId(null);
      toast(t('equipment:availability.periodEnded', 'Rental period ended'), undefined, 'success');
    } catch (err) { setProblem(classifyMutationError(err).headline); }
  };

  const rows = terms.data ?? [];
  const columns: Column<RentalTermRow>[] = [
    { key: 'from', header: t('equipment:availability.rentedFrom', 'Rental start'), kind: 'primary', rowHeader: true, cell: (term) => <span className="whitespace-nowrap">{formatIsoDay(term.rented_from)}</span> },
    { key: 'to', header: t('equipment:availability.rentedToShort', 'Rental end'), cell: (term) => <span className="whitespace-nowrap">{term.rented_to ? formatIsoDay(term.rented_to) : t('equipment:availability.openEnded', 'Open')}</span> },
    { key: 'vendor', header: t('equipment:availability.vendor', 'Vendor'), cell: (term) => vendorName(term.vendor_id) },
    { key: 'rate', header: t('equipment:availability.rate', 'Rate'), align: 'num', kind: 'money',
      cell: (term) => <span className="whitespace-nowrap tabular-nums">{formatExactMoney(String(term.rate), term.currency, getNumberLocale(), { trimZeroFraction: true }) ?? '—'}</span> },
    { key: 'basis', header: t('equipment:availability.per', 'Per'), cell: (term) => basisName(term.basis) },
    { key: 'actions', kind: 'actions', header: <span className="sr-only">{t('equipment:expiryEdit.actions', 'Actions')}</span>, cell: (term) => term.rented_to === null ? <Button variant="outline" onClick={() => { setEndingTermId(term.id); setLastRentalDay(''); setProblem(null); }}>{t('equipment:availability.endPeriod', 'End rental period')}</Button> : null },
  ];
  const menu = [
    { key: 'rate', label: t('equipment:availability.changeRate', 'Change rate from date'), onSelect: () => open('rate') },
    { key: 'inService', label: t('equipment:availability.saveInService', 'Save in-service date'), onSelect: () => open('inService') },
    { key: 'owned', label: t('equipment:availability.markOwned', 'Mark owned'), onSelect: () => open('owned') },
  ];
  const rateField = <NumberField localeAware label={t('equipment:availability.rate', 'Rate')} value={rate} onChange={setRate} />;

  return (
    <RecordSection title={t('equipment:availability.terms', 'Rental terms')} flush={rows.length > 0 ? 'table' : true}
      actions={<>
        <Button variant="outline" size="sm" onClick={() => open('terms')}>{t('equipment:availability.addTerms', 'Add rental terms')}</Button>
        <RecordMenu items={menu} ariaLabel={t('equipment:availability.otherAssetActions', 'Other asset actions')} />
      </>}>
      {problem && dialog === null && !endingTermId && <p role="alert" className="px-[var(--panel-inset)] pb-3 text-sm text-destructive-text">{problem}</p>}
      <DataTable<RentalTermRow> embedded rows={rows} columns={columns} rowKey={(term) => term.id} tableId="equipment-rental-terms"
        accessibleName={t('equipment:availability.terms', 'Rental terms')}
        state={terms.isError ? 'error' : terms.isPending ? 'loading' : rows.length === 0 ? 'empty' : undefined}
        errorTitle={t('equipment:availability.termsError', 'Could not load rental terms')} onRetry={() => void terms.refetch()}
        emptyTitle={t('equipment:availability.noTerms', 'No rental terms')} />

      {endingTermId && <EntityFormModal open title={t('equipment:availability.endPeriod', 'End rental period')} submitLabel={t('equipment:availability.confirmEnd', 'Confirm end date')}
        onSubmit={(e) => { e.preventDefault(); void submitEnd(endingTermId); }} onClose={() => { setEndingTermId(null); setProblem(null); }}
        submitDisabled={!lastRentalDay || lastRentalDay < (rows.find((term) => term.id === endingTermId)?.rented_from ?? '') || endTerm.isPending}
        loading={endTerm.isPending} submitError={problem ? { headline: problem } : null}>
        <DateField label={t('equipment:availability.lastRentalDay', 'Last rental day')} value={lastRentalDay} onChange={setLastRentalDay} min={rows.find((term) => term.id === endingTermId)?.rented_from} disabled={endTerm.isPending} />
      </EntityFormModal>}
      {dialog === 'terms' && (
        <EntityFormModal open title={t('equipment:availability.terms', 'Rental terms')} submitLabel={t('equipment:availability.saveTerms', 'Save rental terms')}
          onSubmit={(e) => { e.preventDefault(); void submitTerm(); }} onClose={close} dirty={Boolean(vendor || rate || rentedFrom)}
          submitDisabled={!termAsset || !vendor || !rate || !rentedFrom || saveTerm.isPending} loading={saveTerm.isPending}
          submitError={problem ? { headline: problem } : null}>
          <FormGrid>
            <SelectField label={t('equipment:availability.vendor', 'Vendor')} value={vendor} onChange={setVendor} options={[{ value: '', label: t('equipment:availability.choose', 'Choose…') }, ...(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))]} />
            {rateField}
            <SelectField label={t('equipment:availability.basis', 'Rate basis')} value={basis} onChange={(v) => setBasis(v as Basis)} options={(['hour', 'day', 'month'] as const).map((b) => ({ value: b, label: basisName(b) }))} />
            <TextField label={t('equipment:availability.currency', 'Currency')} value={currency} onChange={setCurrency} />
            <DateField label={t('equipment:availability.rentedFrom', 'Rental start')} value={rentedFrom} onChange={setRentedFrom} />
            <DateField label={t('equipment:availability.rentedTo', 'Rental end (optional)')} value={rentedTo} onChange={setRentedTo} />
          </FormGrid>
        </EntityFormModal>
      )}
      {dialog === 'rate' && (
        <EntityFormModal open title={t('equipment:availability.changeRate', 'Change rate from date')} submitLabel={t('equipment:availability.changeRate', 'Change rate from date')}
          onSubmit={(e) => { e.preventDefault(); void submitRate(); }} onClose={close} dirty={Boolean(rate || rentedFrom)}
          submitDisabled={!termAsset || !rate || !rentedFrom || changeRate.isPending} loading={changeRate.isPending}
          submitError={problem ? { headline: problem } : null}>
          <FormGrid>
            <DateField label={t('equipment:availability.rateFrom', 'New rate from')} value={rentedFrom} onChange={setRentedFrom} />
            {rateField}
          </FormGrid>
        </EntityFormModal>
      )}
      {dialog === 'inService' && (
        <EntityFormModal open title={t('equipment:availability.saveInService', 'Save in-service date')} submitLabel={t('equipment:availability.saveInService', 'Save in-service date')}
          onSubmit={(e) => { e.preventDefault(); void submitOwnership(asset.ownership === 'rented' ? 'rented' : 'owned', t('equipment:availability.inServiceSaved', 'In-service date saved')); }}
          onClose={close} submitDisabled={saveOwnership.isPending} loading={saveOwnership.isPending} submitError={problem ? { headline: problem } : null}>
          <DateField label={t('equipment:availability.inService', 'In service from (optional)')} value={inService} onChange={setInService} />
        </EntityFormModal>
      )}
      <ConfirmDialog open={dialog === 'owned'} title={t('equipment:availability.markOwnedTitle', 'Mark this machine owned?')}
        description={t('equipment:availability.markOwnedBody', 'It leaves the rental invoice check.')}
        confirmLabel={t('equipment:availability.markOwned', 'Mark owned')} loading={saveOwnership.isPending} error={problem}
        onCancel={close} onConfirm={() => void submitOwnership('owned', t('equipment:availability.ownershipSaved', 'Ownership saved'))} />
    </RecordSection>
  );
}
