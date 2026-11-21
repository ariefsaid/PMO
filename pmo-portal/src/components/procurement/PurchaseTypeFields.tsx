import React, { useContext, useEffect } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DateField, SelectField } from '@/src/components/ui';
import { AuthContext } from '@/src/auth/AuthContext';
import { usePurchaseTypes, usePurchaseTypesEnabled } from '@/src/hooks/usePurchaseTypes';
import type { PurchaseTypeValue } from './purchaseTypeValue';
import { purchaseTypePeriodErrors } from './purchaseTypeValue';

interface Props { value: PurchaseTypeValue; onChange: (v: PurchaseTypeValue) => void; showErrors: boolean; disabled?: boolean }

const Fields: React.FC<Props> = ({ value, onChange, showErrors, disabled }) => {
  const { t, i18n } = useTranslation('purchaseTypes');
  const enabled = usePurchaseTypesEnabled().data === true;
  const types = usePurchaseTypes();
  const active = enabled ? (types.data ?? []).filter((x) => x.active) : [];
  const chosen = active.find((x) => x.id === value.id);
  // The parent needs to know whether the chosen type is a rental; the flag comes from the type row, never its name.
  useEffect(() => {
    const isRental = Boolean(chosen?.isRental);
    if (isRental !== value.isRental) onChange({ ...value, isRental });
  }, [chosen?.isRental, value, onChange]);
  if (active.length === 0) return null;
  const errors = showErrors ? purchaseTypePeriodErrors(value, t) : {};
  return (
    <>
      <SelectField id="procurement-create-purchase-type" label={t('create.type', 'Purchase type')} value={value.id} disabled={disabled}
        onChange={(v) => onChange({ id: v, isRental: false, from: '', to: '' })}
        options={[{ value: '', label: t('create.noType', 'No type') },
          ...active.map((x) => ({ value: x.id, label: i18n.language.startsWith('id') && x.nameId ? x.nameId : x.name }))]} />
      {chosen?.isRental && (
        <>
          <DateField label={t('create.rentalFrom', 'Rental from')} required value={value.from} onChange={(from) => onChange({ ...value, from })} error={errors.from} disabled={disabled} fullWidth />
          <DateField label={t('create.rentalTo', 'Rental to')} required value={value.to} min={value.from || undefined} onChange={(to) => onChange({ ...value, to })} error={errors.to} disabled={disabled} fullWidth />
        </>
      )}
    </>
  );
};

/**
 * Purchase type and rental period on the new-purchase form (#2697). Renders nothing unless the organisation turned purchase types on
 * and the form runs inside a signed-in session with a query client; so an organisation without them sees the form exactly as before.
 */
const PurchaseTypeFields: React.FC<Props> = (props) => {
  const client = useContext(QueryClientContext);
  const auth = useContext(AuthContext);
  if (!client || !auth) return null;
  return <Fields {...props} />;
};
export default PurchaseTypeFields;
