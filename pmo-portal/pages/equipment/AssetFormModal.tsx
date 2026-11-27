import React, { useState } from 'react';
import { DateField } from '@/src/components/ui/DateField';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  EntityFormModal, FormGrid, NumberField, SelectField, TextField, useEntityForm, useToast, type SubmitError,
} from '@/src/components/ui';
import { useCompanyOptions } from '@/src/hooks/useCompanies';
import { useCreateAsset, useCreateRentedAsset, useUpdateAsset } from '@/src/hooks/useEquipment';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { normalizeLocalizedDecimal } from '@/src/lib/format';
import type { EquipmentAssetRow } from '@/src/lib/db/equipment';

/**
 * One form for a new or an edited machine. A rented machine carries its first rental period on the same form (vendor, rate,
 * start, end) and is saved in one step; the rental history and later rate changes live on the machine's own page.
 * UX only: `create_rented_equipment_asset` and the asset column grants decide who may save.
 */
export const AssetFormModal: React.FC<{ asset?: EquipmentAssetRow; onClose: () => void; onSaved?: () => void }> = ({ asset, onClose, onSaved }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const create = useCreateAsset();
  const createRented = useCreateRentedAsset();
  const update = useUpdateAsset();
  const vendors = useCompanyOptions({ enabled: !asset }, 'Vendor');
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const editing = Boolean(asset);
  const form = useEntityForm({
    initialValues: {
      code: asset?.code ?? '', name: asset?.name ?? '', unit: asset?.default_unit ?? 'hours',
      ownership: 'owned', vendor: '', rate: '', basis: 'day', currency: 'IDR', rentedFrom: '', rentedTo: '',
    },
    idPrefix: 'equipment-asset',
    requiredFields: ['code', 'name'],
    validate: (v) => {
      const errors: Record<string, string> = {};
      if (!editing && v.ownership === 'rented') {
        if (!v.vendor) errors.vendor = t('equipment:assets.errors.vendor', 'Choose the vendor the machine is rented from.');
        if (!v.rate.trim()) errors.rate = t('equipment:assets.errors.rate', 'Enter the rental rate.');
        else if (normalizeLocalizedDecimal(v.rate, 2) === null) errors.rate = t('equipment:availability.amountInvalid', 'Enter the amount as a number with at most 2 decimals');
        if (!v.rentedFrom) errors.rentedFrom = t('equipment:assets.errors.rentedFrom', 'Enter the day the rental starts.');
        else if (v.rentedTo && v.rentedTo < v.rentedFrom) errors.rentedTo = t('equipment:assets.errors.rentedTo', 'The rental cannot end before it starts.');
      }
      return errors;
    },
  });
  const f = (key: 'code' | 'name' | 'vendor' | 'rate' | 'rentedFrom' | 'rentedTo') => form.fieldProps(key);
  const rented = !editing && form.values.ownership === 'rented';
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    void form.handleSubmit(async (v) => {
      try {
        if (asset) {
          await update.mutateAsync({ id: asset.id, patch: { code: v.code.trim(), name: v.name.trim(), default_unit: v.unit as 'hours' | 'days' } });
          toast(t('equipment:assets.updated', 'Equipment saved'), undefined, 'success');
        } else if (v.ownership === 'rented') {
          await createRented.mutateAsync({
            code: v.code.trim(), name: v.name.trim(), default_unit: v.unit as 'hours' | 'days', vendor_id: v.vendor,
            rate: normalizeLocalizedDecimal(v.rate, 2) ?? v.rate, basis: v.basis as 'hour' | 'day' | 'month', currency: v.currency.trim().toUpperCase(),
            rented_from: v.rentedFrom, rented_to: v.rentedTo || null,
          });
          toast(t('equipment:assets.createdRented', 'Rented equipment added'), undefined, 'success');
        } else {
          await create.mutateAsync({ code: v.code.trim(), name: v.name.trim(), default_unit: v.unit as 'hours' | 'days' });
          toast(t('equipment:assets.created', 'Asset created'), undefined, 'success');
        }
        onSaved?.();
        onClose();
      } catch (err) {
        const c = classifyMutationError(err);
        setSubmitError({ headline: c.headline, detail: c.detail });
      }
    });
  };
  return (
    <EntityFormModal open title={editing ? t('equipment:assets.editTitle', 'Edit equipment') : t('equipment:assets.newTitle', 'New equipment asset')}
      submitLabel={editing ? t('equipment:assets.save', 'Save') : t('equipment:assets.create', 'Create asset')} onSubmit={submit} onClose={onClose}
      loading={form.isSubmitting} dirty={form.isDirty} submitDisabled={!form.isComplete} submitError={submitError}>
      <FormGrid>
        <TextField label={t('equipment:assets.code', 'Code')} required code {...f('code')} />
        <TextField label={t('equipment:assets.name', 'Name')} required {...f('name')} />
        <SelectField label={t('equipment:assets.unit', 'Default unit')} value={form.values.unit} onChange={(v) => form.setValue('unit', v)}
          options={[{ value: 'hours', label: t('equipment:unit.hours', 'hours') }, { value: 'days', label: t('equipment:unit.days', 'days') }]} />
        {!editing && <SelectField label={t('equipment:assets.ownership', 'Owned or rented')} value={form.values.ownership} onChange={(v) => form.setValue('ownership', v)}
          options={[{ value: 'owned', label: t('equipment:assets.owned', 'Owned') }, { value: 'rented', label: t('equipment:assets.rented', 'Rented') }]} />}
        {rented && <>
          <SelectField label={t('equipment:availability.vendor', 'Vendor')} required value={form.values.vendor} error={f('vendor').error} onChange={(v) => form.setValue('vendor', v)}
            options={[{ value: '', label: t('equipment:availability.choose', 'Choose…') }, ...(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))]} />
          <NumberField localeAware required label={t('equipment:availability.rate', 'Rate')} {...f('rate')} />
          <SelectField label={t('equipment:availability.basis', 'Rate basis')} value={form.values.basis} onChange={(v) => form.setValue('basis', v)}
            options={[{ value: 'hour', label: t('equipment:availability.hour', 'Hour') }, { value: 'day', label: t('equipment:assets.perDay', 'Per day') }, { value: 'month', label: t('equipment:assets.perMonth', 'Per month') }]} />
          <TextField label={t('equipment:availability.currency', 'Currency')} value={form.values.currency} onChange={(v) => form.setValue('currency', v)} />
          <DateField label={t('equipment:availability.rentedFrom', 'Rental start')} required {...f('rentedFrom')} />
          <DateField label={t('equipment:availability.rentedTo', 'Rental end (optional)')} {...f('rentedTo')} />
        </>}
      </FormGrid>
      {editing && asset && <p className="mt-3 text-sm text-muted-foreground">
        {t('equipment:assets.termsElsewhere', 'Rental periods and rate changes are on the equipment\'s own page.')}{' '}
        <Link className="text-primary-text underline" to={`/equipment/assets/${asset.id}`}>{t('equipment:assets.openRecord', 'Open the equipment page')}</Link>
      </p>}
    </EntityFormModal>
  );
};
