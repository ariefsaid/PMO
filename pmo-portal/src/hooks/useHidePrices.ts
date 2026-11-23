import { useEffect, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hidePricesRepository } from '@/src/lib/repositories/hidePrices';
import { useAuth } from '@/src/auth/useAuth';
import { arePricesHidden, isHidePricesActive, setHidePricesActive, setPricesHidden, subscribeHidePrices } from '@/src/lib/priceReadPath';

/** #2699: the organisation setting. Off until an Admin turns it on; unreadable reads as off. */
export const HIDE_PRICES_ENABLED_KEY = 'org-hide-prices-enabled';
export const MAY_SEE_PRICES_KEY = 'may-see-prices';

export function useHidePricesEnabled() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: [HIDE_PRICES_ENABLED_KEY, orgId],
    queryFn: () => hidePricesRepository.getEnabled(),
    enabled: Boolean(orgId),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * Mounted once in the app shell. Reads the setting and the caller's own answer from the database, and points the price-bearing
 * reads at the masked views while the organisation hides prices. Drops cached lists when the read path changes.
 */
export function usePriceVisibilitySync(): void {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const enabled = useHidePricesEnabled();
  const may = useQuery({
    queryKey: [MAY_SEE_PRICES_KEY, orgId],
    queryFn: () => hidePricesRepository.getMaySee(),
    enabled: Boolean(orgId) && enabled.data === true,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const active = enabled.data === true;
  useEffect(() => {
    if (!orgId) return;
    if (isHidePricesActive() !== active) { setHidePricesActive(active);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== HIDE_PRICES_ENABLED_KEY && q.queryKey[0] !== MAY_SEE_PRICES_KEY });
    }
  }, [orgId, active, qc]);
  useEffect(() => { setPricesHidden(active && may.data === false); }, [active, may.data]);
}

/** Should price columns, fields and totals be drawn? True while the setting is off or still unknown; false only when the server says no.
 *  Reads a store set by `usePriceVisibilitySync`, so it needs no provider (screens and their tests render without one). */
export function useMaySeePrices(): boolean {
  return !useSyncExternalStore(subscribeHidePrices, arePricesHidden, () => false);
}
