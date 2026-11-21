import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, TextField } from '@/src/components/ui';
import { useStockErrorText } from '@/src/components/stock/useStockErrorText';
import { parseThreshold } from '@/src/lib/workOrderIssueThreshold';
import { workOrderMaterialProgressRepository } from '@/src/lib/repositories/workOrderMaterialProgress';

/** Admin sets or clears the issued-versus-progress warning threshold (#2674, FR-MIP-023). Empty = off. The database refuses non-Admins. */
export function WorkOrderIssueThresholdPanel() {
  const { t } = useTranslation('stock');
  const errorText = useStockErrorText();
  const qc = useQueryClient();
  const current = useQuery({
    queryKey: ['wo-issue-threshold'],
    queryFn: async () => { const v = await workOrderMaterialProgressRepository.threshold(); return v === null ? '' : String(v); },
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const value = draft ?? current.data ?? '';
  const parsed = parseThreshold(value);
  const save = useMutation({
    mutationFn: async () => {
      if (!parsed.ok) throw new Error('range');
      return workOrderMaterialProgressRepository.setThreshold(parsed.value);
    },
    onSuccess: async () => { setError(''); setSaved(true); setDraft(null); await qc.invalidateQueries({ queryKey: ['wo-issue-threshold'] }); await qc.invalidateQueries({ queryKey: ['wo-material-progress'] }); },
    onError: (err) => { setSaved(false); setError(errorText(err) || t('siteWork.materialProgress.setting.saveError')); },
  });
  return (
    <section className="space-y-3 rounded-lg border border-border p-4" aria-label={t('siteWork.materialProgress.setting.manage')}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setSaved(false); if (!parsed.ok) { setError(t('siteWork.materialProgress.setting.range')); return; } save.mutate(); }}>
        <TextField id="wo-issue-threshold" label={t('siteWork.materialProgress.setting.label')} helper={t('siteWork.materialProgress.setting.help')}
          inputMode="decimal" value={value} onChange={(v) => { setDraft(v); setSaved(false); setError(''); }}
          error={error || (!parsed.ok ? t('siteWork.materialProgress.setting.range') : undefined)} disabled={current.isPending} />
        {saved && <p role="status" className="text-sm text-muted-foreground">{t('siteWork.materialProgress.setting.saved')}</p>}
        <Button variant="primary" type="submit" disabled={!parsed.ok || save.isPending || current.isPending}>{t('siteWork.materialProgress.setting.save')}</Button>
      </form>
    </section>
  );
}
