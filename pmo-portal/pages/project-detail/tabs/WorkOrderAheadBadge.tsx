import React, { useContext, useSyncExternalStore } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/src/auth/AuthContext';
import { StatusPill } from '@/src/components/ui';
import { useWorkOrderMaterialAlertCount } from '@/src/hooks/useWorkOrderMaterialAlerts';
import { isOwnershipCacheSynced, routeDomainWrite, subscribeOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';

/**
 * Work-order card header: how many items have material issued ahead of progress (material-vs-progress FR-MVP-008). Read from the
 * recorded alerts, so it shows without opening the stock section; pressing it opens that section. Renders nothing when nothing is open,
 * the read fails, inventory is connected to another system, or there are no app providers (information only, it blocks nothing).
 */
const Inner: React.FC<{ workOrderId: string; onOpen: () => void }> = ({ workOrderId, onOpen }) => {
  const { t } = useTranslation('stock');
  const ownership = useSyncExternalStore(subscribeOwnershipCache, () => isOwnershipCacheSynced() ? routeDomainWrite('inventory') : 'unknown');
  const q = useWorkOrderMaterialAlertCount(workOrderId, ownership === 'pmo');
  const count = q.data?.itemCount ?? 0;
  if (ownership !== 'pmo' || count === 0) return null;
  return (
    <button type="button" data-testid={`wo-ahead-badge-${workOrderId}`} onClick={onOpen} title={t('siteWork.materialProgress.alert.badgeHint')}
      aria-label={`${t('siteWork.materialProgress.alert.badge', { count })}. ${t('siteWork.materialProgress.alert.badgeHint')}`}
      className="touch-target rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
      <StatusPill variant="warn">{t('siteWork.materialProgress.alert.badge', { count })}</StatusPill>
    </button>
  );
};

export const WorkOrderAheadBadge: React.FC<{ workOrderId: string; onOpen: () => void }> = ({ workOrderId, onOpen }) => {
  const auth = useContext(AuthContext);
  const queries = useContext(QueryClientContext);
  return Boolean(auth) && Boolean(queries) ? <Inner workOrderId={workOrderId} onOpen={onOpen} /> : null;
};
