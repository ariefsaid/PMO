import React from 'react';
import { useTranslation } from 'react-i18next';
import { lineUsageWarning } from '@/src/lib/repositories/materialRequests';

/**
 * Advisory line warning when INSTALLED material (validated site reports) reaches the organisation's usage warning share of plan.
 * Renders nothing while the threshold is unset. Never blocks.
 */
export const UsageWarning: React.FC<{ line: { planQty: number; installedQty: number }; threshold: number | null }> = ({ line, threshold }) => {
  const { t } = useTranslation('materialRequests');
  const w = lineUsageWarning(line, threshold);
  if (!w) return null;
  return (
    <p role="status" className="text-control text-warning-foreground" data-testid="mrq-usage-warning">
      {Number.isFinite(w.reachedPct)
        ? t('usage.reached', 'Installed {{installed}} of {{plan}} planned ({{reached}}%), past the {{threshold}}% warning. Check the site before more is requested.', { installed: line.installedQty, plan: line.planQty, reached: w.reachedPct, threshold: w.threshold })
        : t('usage.planZero', 'Installed {{installed}} with no plan set, past the {{threshold}}% warning. Check the site before more is requested.', { installed: line.installedQty, threshold: w.threshold })}
    </p>
  );
};
