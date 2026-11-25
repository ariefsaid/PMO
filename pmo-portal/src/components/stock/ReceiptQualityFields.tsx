import React from 'react';
import { useTranslation } from 'react-i18next';
import { FormGrid, TextField } from '@/src/components/ui';
import { thousandths, type QualityProblem, type QualityValue } from '@/src/lib/receiptQuality';

/** The passed and rejected fields for one received line of an item flagged for a quality check; the same on the Receive form and on order receiving. */
export function ReceiptQualityFields({ idPrefix, suffix = '', value, onChange, problem }: {
  idPrefix: string; suffix?: string; value: QualityValue; onChange: (next: QualityValue) => void; problem?: QualityProblem | null;
}) {
  const { t } = useTranslation('stock');
  const set = (patch: Partial<QualityValue>) => onChange({ ...value, ...patch });
  const number = t('quality.errors.number');
  return (
    <div className="space-y-3" data-testid={`${idPrefix}-quality`}>
      <p className="text-control text-muted-foreground">{t('quality.hint')}</p>
      <FormGrid>
        <TextField id={`${idPrefix}-passed`} label={`${t('quality.passed')}${suffix}`} required inputMode="decimal" autoComplete="off"
          value={value.passed} onChange={(v) => set({ passed: v })} error={problem === 'passed' ? number : undefined} />
        <TextField id={`${idPrefix}-rejected`} label={`${t('quality.rejected')}${suffix}`} required inputMode="decimal" autoComplete="off"
          value={value.rejected} onChange={(v) => set({ rejected: v })}
          error={problem === 'rejected' ? number : problem === 'add' ? t('quality.errors.add') : undefined} />
        {(thousandths(value.rejected) ?? 0) > 0 && (
          <TextField id={`${idPrefix}-reason`} label={`${t('quality.reason')}${suffix}`} required value={value.reason}
            onChange={(v) => set({ reason: v })} error={problem === 'reason' ? t('quality.errors.reason') : undefined} />
        )}
      </FormGrid>
    </div>
  );
}
