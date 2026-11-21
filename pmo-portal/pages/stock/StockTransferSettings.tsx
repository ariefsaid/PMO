import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, SelectField } from '@/src/components/ui';
import { useStockErrorText } from '@/src/components/stock/useStockErrorText';
import { useStockItems } from '@/src/hooks/useStock';
import { useStockTags } from '@/src/hooks/useStockSiteWork';
import { useTransferRefresh, useTransferSettings } from '@/src/hooks/useStockTransfers';
import { stockTransfersRepository as repo, type ProofRule, type ProofTiming, type TransferMode } from '@/src/lib/repositories/stockTransfers';
import { useQueryClient } from '@tanstack/react-query';

const ruleOf = (tag: { proof_required?: string; paper_required: boolean }): ProofRule => (tag.proof_required as ProofRule | undefined) ?? (tag.paper_required ? 'paper' : 'none');

/** Admin: turn two-step transfers on, choose when proof is demanded, which proof counts per tag, which items need a quality check (#2690). Off by default. */
export const StockTransferSettings: React.FC = () => {
  const { t } = useTranslation('stock');
  const settings = useTransferSettings();
  const twoStep = settings.data?.mode === 'two_step';
  const tags = useStockTags(false, twoStep);
  const items = useStockItems(false);
  const errorText = useStockErrorText();
  const refresh = useTransferRefresh();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const change = useMutation({
    mutationFn: (fn: () => Promise<void>) => fn(),
    onSuccess: async () => { setError(''); await refresh(); await qc.invalidateQueries({ queryKey: ['stock-tags'] }); await qc.invalidateQueries({ queryKey: ['stock-items'] }); },
    onError: (err) => setError(errorText(err)),
  });
  if (!settings.data) return null;
  const rules: ProofRule[] = twoStep ? ['none', 'paper', 'confirmation', 'either'] : ['none', 'paper'];
  return (
    <div className="my-3">
      <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>{t('transferSettings.manage')}</Button>
      {open && (
        <section className="mt-2 space-y-4 rounded-lg border border-border p-4" aria-label={t('transferSettings.manage')}>
          <SelectField label={t('transferSettings.mode')} value={settings.data.mode} onChange={(v) => change.mutate(() => repo.settings.setMode(v as TransferMode))}
            options={[{ value: 'one_step', label: t('transferSettings.oneStep') }, { value: 'two_step', label: t('transferSettings.twoStep') }]} helper={t('transferSettings.modeHelp')} />
          <SelectField label={t('transferSettings.timing')} value={settings.data.proofTiming} onChange={(v) => change.mutate(() => repo.settings.setTiming(v as ProofTiming))}
            options={[{ value: 'before_posting', label: t('transferSettings.beforePosting') }, { value: 'may_follow', label: t('transferSettings.mayFollow') }]} helper={t('transferSettings.timingHelp')} />
          {(tags.data ?? []).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t('transferSettings.proofPerTag')}</h3>
              <ul className="space-y-2">{(tags.data ?? []).map((tag) => (
                <li key={tag.id}>
                  <SelectField label={tag.name} value={ruleOf(tag as never)} onChange={(v) => change.mutate(() => repo.settings.setTagProof(tag.id, v as ProofRule))}
                    options={rules.filter((r) => r !== 'paper' || tag.zero_cost).map((r) => ({ value: r, label: t(`proof.rule.${r}`) }))} />
                </li>))}</ul>
            </div>)}
          {twoStep && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t('transferSettings.qualityItems')}</h3>
              <ul className="max-h-64 space-y-1 overflow-y-auto">{(items.data ?? []).map((i) => (
                <li key={i.id}>
                  <Checkbox label={`${i.code} - ${i.name}`} checked={(i as { needs_quality_check?: boolean }).needs_quality_check === true}
                    onChange={(c) => change.mutate(() => repo.settings.setItemQuality(i.id, c === true))}>{`${i.code} - ${i.name}`}</Checkbox>
                </li>))}</ul>
            </div>)}
          {error && <p role="alert">{error}</p>}
        </section>)}
    </div>
  );
};
