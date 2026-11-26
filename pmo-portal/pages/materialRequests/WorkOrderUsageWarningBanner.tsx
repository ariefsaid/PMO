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
      <table className="mt-1 w-full max-w-xl text-control" aria-label={t('usage.cardTitle', 'Installed material past the usage warning')}>
        <thead><tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 pr-4 font-normal">{t('usage.cardItem', 'Item')}</th>
          <th scope="col" className="py-1 pl-4 text-right font-normal">{t('usage.cardInstalled', 'Installed')}</th>
          <th scope="col" className="py-1 pl-4 text-right font-normal">{t('usage.cardPlan', 'Planned')}</th>
          <th scope="col" className="py-1 pl-4 text-right font-normal">{t('usage.cardThreshold', 'Warning at')}</th>
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.itemId} className="border-t border-warning/30">
            <th scope="row" className="py-1 pr-4 text-left font-medium">{r.itemName}</th>
            <td className="py-1 pl-4 text-right tabular-nums whitespace-nowrap">{fmt(r.installedQty)} <span className="text-muted-foreground">{r.unit}</span></td>
            <td className="py-1 pl-4 text-right tabular-nums whitespace-nowrap">{fmt(r.planQty)} <span className="text-muted-foreground">{r.unit}</span></td>
            <td className="py-1 pl-4 text-right tabular-nums">{fmt(r.threshold)}%</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
};

export const WorkOrderUsageWarningBanner: React.FC<{ workOrderId: string }> = ({ workOrderId }) => {
  const auth = useContext(AuthContext);
  const queries = useContext(QueryClientContext);
  return Boolean(auth) && Boolean(queries) ? <Inner workOrderId={workOrderId} /> : null;
};
