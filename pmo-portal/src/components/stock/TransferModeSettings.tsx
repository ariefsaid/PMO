import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SelectField } from '@/src/components/ui';
import { useStockErrorText } from '@/src/components/stock/useStockErrorText';
import { useStockTransfers, useTransferRefresh, useTransferSettings } from '@/src/hooks/useStockTransfers';
import { stockTransfersRepository as repo, type ProofTiming, type TransferMode } from '@/src/lib/repositories/stockTransfers';

/**
 * Admin: one-step or two-step stock transfers, and when proof is demanded (#2690). One-step stays the default: two-step adds a receive
 * step, quality checks and proof before a transfer posts. It sits inside the Stock module card in Administration (#2746); the setter still
 * refuses while transfers are in flight or an ERP owns the stock.
 */
export const TransferModeSettings: React.FC = () => {
  const { t } = useTranslation('stock');
  const settings = useTransferSettings();
  const errorText = useStockErrorText();
  const refresh = useTransferRefresh();
  const sent = useStockTransfers('Sent', settings.data?.mode === 'two_step');   // a refused switch says how many transfers are in transit
  const [error, setError] = useState('');
  const change = useMutation({
    mutationFn: (fn: () => Promise<void>) => fn(),
    onSuccess: async () => { setError(''); await refresh(); },
    onError: (err) => setError(errorText(err)),
  });
  if (!settings.data) return null;
  return (
    <div className="space-y-4">
      <SelectField label={t('transferSettings.mode')} value={settings.data.mode} onChange={(v) => {
          const inTransit = (sent.data ?? []).length;
          if (v === 'one_step' && inTransit > 0) { setError(t('transferSettings.inTransit', { count: inTransit })); return; }
          change.mutate(() => repo.settings.setMode(v as TransferMode));
        }}
        options={[{ value: 'one_step', label: t('transferSettings.oneStep') }, { value: 'two_step', label: t('transferSettings.twoStep') }]} helper={t('transferSettings.modeHelp')} />
      <SelectField label={t('transferSettings.timing')} value={settings.data.proofTiming} onChange={(v) => change.mutate(() => repo.settings.setTiming(v as ProofTiming))}
        options={[{ value: 'before_posting', label: t('transferSettings.beforePosting') }, { value: 'may_follow', label: t('transferSettings.mayFollow') }]} helper={t('transferSettings.timingHelp')} />
      {error && <p role="alert">{error}</p>}
    </div>
  );
};
