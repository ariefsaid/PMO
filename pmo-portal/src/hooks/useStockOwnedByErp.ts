import { useSyncExternalStore } from 'react';
import { isOwnershipCacheSynced, routeDomainWrite, subscribeOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';

/**
 * True while a connected ERP owns the stock (#2746). Work-order transfers and reservations are on for every organisation now, but
 * the database refuses them where an ERP owns stock (`stock_assert_standalone`), so their screens stay hidden there. Unknown (the
 * ownership read has not landed) counts as not owned: the screens show and the database still decides.
 */
export function useStockOwnedByErp(): boolean {
  return useSyncExternalStore(subscribeOwnershipCache, () => (isOwnershipCacheSynced() ? routeDomainWrite('inventory') : 'unknown')) === 'external';
}
