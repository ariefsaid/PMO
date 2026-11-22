import React from 'react';
import { useTranslation } from 'react-i18next';
import { lineUsageWarning, type UsageThresholds } from '@/src/lib/repositories/materialRequests';

/** #2686: advisory line warning when use of an item reaches a usage threshold. Renders nothing while thresholds are unset. Never blocks. */
export const UsageWarning: React.FC<{ line: { planQty: number; priorQty: number; quantity: number }; thresholds: UsageThresholds | null }> = ({ line, thresholds }) => {
  const { t } = useTranslation('materialRequests');
  const w = lineUsageWarning(line, thresholds);
  if (!w) return null;
  return (
    <p role="status" className="text-control text-warning-foreground" data-testid="mrq-usage-warning">
      {Number.isFinite(w.reachedPct)
        ? t('usage.reached', 'Use reaches {{reached}}% of plan, past the {{threshold}}% warning.', { reached: w.reachedPct, threshold: w.threshold })
        : t('usage.planZero', 'No plan is set, so any use is past the {{threshold}}% warning.', { threshold: w.threshold })}
    </p>
  );
};
