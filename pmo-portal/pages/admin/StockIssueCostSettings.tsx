import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, DateField, ListState, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useStockIssueCostSettings, useSetStockIssueCostSettings } from '@/src/hooks/useStockIssueCostSettings';

export default function StockIssueCostSettings() {
  const { t } = useTranslation('administration');
  const may = usePermission();
  const q = useStockIssueCostSettings();
  const m = useSetStockIssueCostSettings();
  const { toast } = useToast();
  const [draft, setDraft] = useState<{ enabled: boolean; date: string } | null>(null);
  const [error, setError] = useState<string>();
  if (!may('manage', 'stockIssueCostSettings')) return null;
  const current = draft ?? { enabled: !!q.data?.effectiveOn, date: q.data?.effectiveOn ?? '' };
  const save = async () => {
    setError(undefined);
    try {
      await m.mutateAsync(current.enabled ? current.date : null);
      setDraft(null);
      toast(t('stockIssueCost.saved', 'Stock costing saved'), undefined, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('stock-cost migration first')) setError(t('stockIssueCost.migration', 'Migrate existing stock costs before enabling this setting.'));
      else if (message.includes('PMO-paid basis')) setError(t('stockIssueCost.erp', 'This setting is available for organisations using PMO-paid costs.'));
      else { const classified = classifyMutationError(err); setError(classified.detail || classified.headline); }
    }
  };
  return <section aria-labelledby="stock-issue-cost-heading">
    <h2 id="stock-issue-cost-heading" className="text-group font-semibold tracking-[-0.01em]">{t('stockIssueCost.title', 'Stock issue costing')}</h2>
    {q.isError ? <ListState variant="error" title={t('stockIssueCost.loadError', "Couldn't load stock costing")} onRetry={() => void q.refetch()} />
      : q.isLoading ? <ListState variant="loading" rows={2} />
        : <div className="mt-4 flex max-w-md flex-col items-start gap-4">
          <Checkbox label={t('stockIssueCost.enabled', 'Count stock issues as cost')} checked={current.enabled} disabled={m.isPending}
            onChange={(enabled) => setDraft({ ...current, enabled })} className="min-h-11">
            {t('stockIssueCost.enabled', 'Count stock issues as cost')}
          </Checkbox>
          {current.enabled && <DateField label={t('stockIssueCost.date', 'Effective date')} value={current.date} disabled={m.isPending}
            onChange={(date) => setDraft({ ...current, date })} />}
          {error && <p role="alert" className="text-control text-destructive">{error}</p>}
          <Button variant="primary" loading={m.isPending} disabled={!draft || (current.enabled && !current.date)} onClick={() => void save()}>{t('stockIssueCost.save', 'Save')}</Button>
        </div>}
  </section>;
}
