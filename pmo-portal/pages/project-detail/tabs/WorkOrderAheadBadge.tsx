import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/src/auth/AuthContext';
import { StatusPill } from '@/src/components/ui';
import { useWorkOrderMaterialAlertCount, useWorkOrderMaterialAlertCounts } from '@/src/hooks/useWorkOrderMaterialAlerts';
import { isOwnershipCacheSynced, routeDomainWrite, subscribeOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';

/**
 * How many items have material issued ahead of progress (material-vs-progress FR-MVP-008), read from the recorded alerts so it shows without
 * opening the stock section. On the project's work-order card pressing it opens that section (`onOpen`); on the work-order page it links to
 * the card's tab (`href`). Renders nothing when nothing is open,
 * the read fails, inventory is connected to another system, or there are no app providers (information only, it blocks nothing).
 */
/** Counts read once for a whole list of work-order cards; a badge inside reads its number here instead of making its own request. */
const AlertCountsContext = createContext<Record<string, number> | null>(null);

const ProviderInner: React.FC<{ workOrderIds: string[]; children: React.ReactNode }> = ({ workOrderIds, children }) => {
  const ownership = useSyncExternalStore(subscribeOwnershipCache, () => isOwnershipCacheSynced() ? routeDomainWrite('inventory') : 'unknown');
  const q = useWorkOrderMaterialAlertCounts(workOrderIds, ownership === 'pmo');
  // Until the batch has answered (or if it fails) every badge shows nothing, as a badge whose own read had not answered did.
  return <AlertCountsContext.Provider value={q.data ?? {}}>{children}</AlertCountsContext.Provider>;
};
export const WorkOrderAlertCountsProvider: React.FC<{ workOrderIds: string[]; children: React.ReactNode }> = ({ workOrderIds, children }) => {
  const auth = useContext(AuthContext);
  const queries = useContext(QueryClientContext);
  return Boolean(auth) && Boolean(queries) ? <ProviderInner workOrderIds={workOrderIds}>{children}</ProviderInner> : <>{children}</>;
};

interface Props { workOrderId: string; onOpen?: () => void; href?: string }
const Inner: React.FC<Props> = ({ workOrderId, onOpen, href }) => {
  const { t } = useTranslation('stock');
  const ownership = useSyncExternalStore(subscribeOwnershipCache, () => isOwnershipCacheSynced() ? routeDomainWrite('inventory') : 'unknown');
  const batched = useContext(AlertCountsContext);
  const q = useWorkOrderMaterialAlertCount(workOrderId, ownership === 'pmo' && batched === null);
  const count = batched ? batched[workOrderId] ?? 0 : q.data?.itemCount ?? 0;
  if (ownership !== 'pmo' || count === 0) return null;
  const label = `${t('siteWork.materialProgress.alert.badge', { count })}. ${t('siteWork.materialProgress.alert.badgeHint')}`;
  const pill = <StatusPill variant="warn">{t('siteWork.materialProgress.alert.badge', { count })}</StatusPill>;
  const cls = 'touch-target rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring';
  return href
    ? <Link to={href} data-testid={`wo-ahead-badge-${workOrderId}`} aria-label={label} title={t('siteWork.materialProgress.alert.badgeHint')} className={cls}>{pill}</Link>
    : <button type="button" data-testid={`wo-ahead-badge-${workOrderId}`} onClick={onOpen} aria-label={label} title={t('siteWork.materialProgress.alert.badgeHint')} className={cls}>{pill}</button>;
};

export const WorkOrderAheadBadge: React.FC<Props> = ({ workOrderId, onOpen, href }) => {
  const auth = useContext(AuthContext);
  const queries = useContext(QueryClientContext);
  return Boolean(auth) && Boolean(queries) ? <Inner workOrderId={workOrderId} onOpen={onOpen} href={href} /> : null;
};
