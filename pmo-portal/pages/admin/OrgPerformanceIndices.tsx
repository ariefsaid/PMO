import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ListState, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { usePerformanceSettings, useSavePerformanceSettings } from '@/src/hooks/useWorkOrderPerformance';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/** Parses a band typed as 0.9 or 0,9; null when it is not a number. */
function parseBand(raw: string): number | null {
  const n = Number(raw.trim().replace(',', '.'));
  return raw.trim() !== '' && Number.isFinite(n) ? n : null;
}

/** The limits are valid when 0 < low < 1 < high (the database enforces the same rule). */
export function bandsValid(low: number | null, high: number | null): boolean {
  return low !== null && high !== null && low > 0 && low < 1 && high > 1;
}

/**
 * Admin control for the cost and schedule performance panels (#2597): the on/off switch (off by default, so every
 * existing screen is unchanged) and the two reading limits (OD-SCOPE-2: limits are settings, not code).
 */
const OrgPerformanceIndices: React.FC = () => {
  const { t } = useTranslation('administration');
  const may = usePermission();
  const canManage = may('manage', 'orgPerformanceIndices');
  const { toast } = useToast();
  const query = usePerformanceSettings();
  const save = useSavePerformanceSettings();
  const [enabled, setEnabled] = useState(false);
  const [low, setLow] = useState('0.90');
  const [high, setHigh] = useState('1.10');
  useEffect(() => {
    if (query.data) {
      setEnabled(query.data.enabled);
      setLow(query.data.bands.low);
      setHigh(query.data.bands.high);
    }
  }, [query.data]);

  const lowN = parseBand(low);
  const highN = parseBand(high);
  const valid = bandsValid(lowN, highN);
  const dirty = query.data !== undefined && (enabled !== query.data.enabled || lowN !== Number(query.data.bands.low) || highN !== Number(query.data.bands.high));

  const onSave = async () => {
    if (!valid || lowN === null || highN === null) return;
    try {
      await save.mutateAsync({ enabled, low: lowN, high: highN });
      toast(t('performanceIndices.saved', 'Performance settings saved'), t('performanceIndices.savedDetail', 'The panels follow the new settings.'), 'success');
    } catch (error) {
      const { headline, detail } = classifyMutationError(error);
      toast(headline, detail, 'warning');
    }
  };

  const title = t('performanceIndices.title', 'Cost and schedule performance');
  return (
    <section id="org-performance-indices" tabIndex={-1} className="scroll-mt-4" aria-label={title}>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('performanceIndices.description', 'Shows the cost and schedule performance indices on projects and work orders. Off until you turn it on.')}
      </p>
      <div className="mt-3 max-w-md">
        {query.isError && query.data === undefined ? (
          <ListState variant="error" title={t('performanceIndices.loadError', "Couldn't load the performance settings")} retryLabel={t('admin.retry', 'Retry')} onRetry={() => void query.refetch()} />
        ) : query.data === undefined ? (
          <ListState variant="loading" rows={1} testId="org-performance-indices-loading" />
        ) : canManage ? (
          <div className="space-y-3">
            <Checkbox checked={enabled} onChange={setEnabled} label={t('performanceIndices.enabled', 'Show performance indices')} disabled={save.isPending}>
              {t('performanceIndices.enabled', 'Show performance indices')}
            </Checkbox>
            <TextField id="org-performance-low" label={t('performanceIndices.low', 'Lower limit (below this reads as a problem)')} value={low} onChange={setLow} onBlur={() => undefined}
              error={lowN !== null && !(lowN > 0 && lowN < 1) ? t('performanceIndices.invalid', 'Lower limit must be between 0 and 1, and the upper limit above 1.') : undefined} disabled={save.isPending} />
            <TextField id="org-performance-high" label={t('performanceIndices.high', 'Upper limit (above this reads as ahead)')} value={high} onChange={setHigh} onBlur={() => undefined}
              error={highN !== null && !(highN > 1) ? t('performanceIndices.invalid', 'Lower limit must be between 0 and 1, and the upper limit above 1.') : undefined}
              helper={t('performanceIndices.helper', 'The lower limit must be above 0 and below 1; the upper limit above 1. Defaults are 0.90 and 1.10.')} disabled={save.isPending} />
            <Button type="button" onClick={() => void onSave()} disabled={!valid || !dirty} loading={save.isPending}>
              {save.isPending ? t('performanceIndices.saving', 'Saving…') : t('performanceIndices.save', 'Save')}
            </Button>
          </div>
        ) : (
          <p className="text-sm" data-testid="org-performance-indices-readonly">
            <span className="font-semibold">{query.data.enabled ? t('performanceIndices.on', 'On') : t('performanceIndices.off', 'Off')}</span>
            <span className="ml-2 text-muted-foreground">{t('performanceIndices.adminOnly', 'Only an Admin can change this.')}</span>
          </p>
        )}
      </div>
    </section>
  );
};

export default OrgPerformanceIndices;
