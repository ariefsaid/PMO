import React from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from './FormFields';
import { parseMoneyInputAtScale } from '@/src/lib/format';
import { parseTaxBaseFraction } from '@/src/lib/taxTreatment';
import type { useStandaloneTaxFields } from '@/src/hooks/useStandaloneTaxFields';

export function TaxRateFields({ fields }: { fields: ReturnType<typeof useStandaloneTaxFields> }) {
  const { t } = useTranslation();
  const rate = fields.hasRate ? parseMoneyInputAtScale(fields.rateRaw, 3) : null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <TextField
        label={t('tax.fields.nominalRate', 'Nominal tax rate (%)')}
        value={fields.rateRaw}
        onChange={fields.setRateRaw}
        inputMode="decimal"
        helper={t('tax.fields.rateHint', 'Leave blank when the rate is not recorded; enter the tax amount instead.')}
        error={fields.hasRate && (rate === null || rate < 0 || rate > 100)
          ? t('tax.fields.rateError', 'Enter a rate from 0 to 100 with no more than 3 decimal places.') : undefined}
      />
      <TextField
        label={t('tax.fields.base', 'Tax base (DPP)')}
        value={fields.baseRaw}
        onChange={fields.setBaseRaw}
        helper={t('tax.fields.baseHint', '1 means the full price. For a reduced base, enter a fraction such as 11/12.')}
        error={!parseTaxBaseFraction(fields.baseRaw)
          ? t('tax.fields.baseError', 'Use a positive fraction no greater than 1, such as 11/12.') : undefined}
      />
    </div>
  );
}
