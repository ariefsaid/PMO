import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, RecordSection, TextField, useToast } from '@/src/components/ui';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { materialRequestRepository as repo, parseUsageThreshold } from '@/src/lib/repositories/materialRequests';
import { useUsageThreshold } from '@/src/hooks/useUsageThreshold';
import { useRefusalText } from './useMaterialRequestText';

const text = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** The Admin sets the one usage warning (percent of plan, measured on installed material). Empty = off, which is every organisation's default. */
export const UsageThresholdsEditor: React.FC = () => {
  const { t } = useTranslation('materialRequests');
  const { toast } = useToast();
  const refusal = useRefusalText();
  const { threshold, reload } = useUsageThreshold();
  const [edited, setEdited] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setEdited(null); }, [threshold]);
  const value = edited ?? text(threshold);
  const parsed = parseUsageThreshold(value);
  const dirty = edited !== null;
  const save = async () => {
    if (!parsed.ok) return;
    setError(null); setSaving(true);
    try { await repo.setUsageThreshold(parsed.value); reload(); toast(t('usage.saved', 'Usage warning saved'), undefined, 'success'); }
    catch (err) { setError(refusal(err)); }
    finally { setSaving(false); }
  };
  const rangeError = dirty && !parsed.ok ? t('usage.invalidRange', 'Enter a percentage from 1 to 1000, or leave it empty to turn the warning off.') : undefined;
  return (
    <RecordSection title={t('usage.title', 'Usage warning')} subline={t('usage.sub', "Tell the site engineer when the material installed on a work order, from validated site reports, reaches this percentage of plan. Leave it empty to switch the warning off. The warning never blocks a request.")}>
      {error && <FormErrorStrip>{error}</FormErrorStrip>}
      <div className="flex flex-wrap items-end gap-2">
        <TextField label={t('usage.field', 'Warn at (% of plan)')} inputMode="decimal" value={value} onChange={setEdited} error={rangeError} />
        <Button variant="primary" disabled={!dirty || !parsed.ok} loading={saving} onClick={() => void save()}>{t('usage.save', 'Save warning')}</Button>
      </div>
    </RecordSection>
  );
};
