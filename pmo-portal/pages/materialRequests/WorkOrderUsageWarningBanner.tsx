import React, { useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/src/auth/AuthContext';
import { useInstalledUsageWarnings } from '@/src/hooks/useMaterialRequests';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { formatQuantity } from '@/src/lib/stockFormat';

/**
 * Items on a work order whose INSTALLED material has reached the usage warning share of plan (usage-warning spec FR-UW-006).
 * Information only: renders nothing while no warning is recorded (every work order while the threshold is unset) or the read fails.
 * Outside the app's providers there is nothing to read, so it renders nothing.
 */
const Inner: React.FC<{ workOrderId: string }> = ({ workOrderId }) => {
  const { t } = useTranslation('materialRequests');
  const rows = useInstalledUsageWarnings(workOrderId).data ?? [];
  if (rows.length === 0) return null;
  const fmt = (n: number) => formatQuantity(String(n), getNumberLocale());
  return (
    <div role="status" className="mb-2 text-control text-warning-foreground" data-testid="wo-usage-warning">
      <p className="font-semibold">{t('usage.cardTitle', 'Installed material past the usage warning')}</p>
      <ul className="mt-1 space-y-1">
        {rows.map((r) => (
          <li key={r.itemId}>{t('usage.cardLine', '{{item}}: {{installed}} of {{plan}} {{unit}} planned installed, past the {{threshold}}% warning.', { item: r.itemName, installed: fmt(r.installedQty), plan: fmt(r.planQty), unit: r.unit, threshold: fmt(r.threshold) })}</li>
        ))}
      </ul>
    </div>
  );
};

export const WorkOrderUsageWarningBanner: React.FC<{ workOrderId: string }> = ({ workOrderId }) => {
  const auth = useContext(AuthContext);
  const queries = useContext(QueryClientContext);
  return Boolean(auth) && Boolean(queries) ? <Inner workOrderId={workOrderId} /> : null;
};
