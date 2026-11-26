import { useSettingsSaveEntry } from '@/src/components/admin/settingsSaveContext';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, RecordSection, TextField, useToast } from '@/src/components/ui';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { materialRequestRepository as repo, parseUsageThresholds } from '@/src/lib/repositories/materialRequests';
import { useUsageThresholds } from '@/src/hooks/useUsageThresholds';
import { useRefusalText } from './useMaterialRequestText';

const text = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** #2686: the Admin sets two usage thresholds (percent of plan). Empty = off, which is every organisation's default. */
export const UsageThresholdsEditor: React.FC = () => {
  const { t } = useTranslation('materialRequests');
  const { toast } = useToast();
  const refusal = useRefusalText();
  const { thresholds, reload } = useUsageThresholds();
  const [first, setFirst] = useState<string | null>(null);
  const [second, setSecond] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setFirst(null); setSecond(null); }, [thresholds]);
  const a = first ?? text(thresholds?.pct1);
  const b = second ?? text(thresholds?.pct2);
  const parsed = parseUsageThresholds(a, b);
  const dirty = first !== null || second !== null;
  const save = async () => {
    if (!parsed.ok) return;
    setError(null); setSaving(true);
    try { await repo.setUsageThresholds(parsed.value); reload(); toast(t('usage.saved', 'Usage warnings saved'), undefined, 'success'); }
    catch (err) { setError(refusal(err)); }
    finally { setSaving(false); }
  };
  const rangeError = dirty && !parsed.ok && parsed.error === 'range' ? t('usage.invalidRange', 'Enter a percentage from 1 to 1000.') : undefined;
  const orderError = dirty && !parsed.ok && parsed.error === 'order' ? t('usage.invalidOrder', 'The second warning must be higher than the first.') : undefined;
  const pageSave = useSettingsSaveEntry({ dirty, invalid: !parsed.ok, busy: saving, save });
  return (
    <RecordSection title={t('usage.title', 'Usage warnings')} subline={t('usage.sub', "Warn when a work order's material use reaches these percentages of plan. Leave a field empty to switch that warning off. Warnings never block a request. The first warning also tells the work order's site engineer when installed material reaches it.")}>
      {error && <FormErrorStrip>{error}</FormErrorStrip>}
      <div className="flex flex-wrap items-end gap-2">
        <TextField label={t('usage.first', 'First warning (% of plan)')} inputMode="decimal" value={a} onChange={setFirst} error={rangeError} />
        <TextField label={t('usage.second', 'Second warning (% of plan)')} inputMode="decimal" value={b} onChange={setSecond} error={rangeError ?? orderError} />
        {!pageSave && <Button variant="primary" disabled={!dirty || !parsed.ok} loading={saving} onClick={() => void save()}>{t('usage.save', 'Save warnings')}</Button>}
      </div>
    </RecordSection>
  );
};
