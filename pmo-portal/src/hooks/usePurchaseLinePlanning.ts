import { useEffect, useState } from 'react';
import { getPurchaseLinePlanning, listPurchaseLineCategories, type PurchaseLineCategory } from '@/src/lib/db/procurementLinePlanning';
import { useModuleOn } from '@/src/hooks/useOrgSwitch';

/** Query keys the Administration section uses for its own cached reads. */
export const LINE_PLANNING_KEY = 'org-purchase-line-planning';
export const LINE_CATEGORIES_KEY = 'org-purchase-line-categories';

/**
 * #2696 — whether this organisation shows a category and a needed-by date on request lines (default off). Plain effect, no
 * query client: a pending, failed or refused read means OFF, so a purchase screen never changes unless the setting is on.
 */
export function useLinePlanningEnabled(): boolean {
  const moduleOn = useModuleOn('modulePurchasingExtras');
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    getPurchaseLinePlanning().then((on) => { if (live) setEnabled(on); }, () => { if (live) setEnabled(false); });
    return () => { live = false; };
  }, []);
  return enabled && moduleOn;
}

/** The organisation's categories, retired ones included (a line may still carry one). Reads only while `enabled`. */
export function useLineCategories(enabled: boolean): { data: PurchaseLineCategory[] } {
  const [data, setData] = useState<PurchaseLineCategory[]>([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    listPurchaseLineCategories().then((rows) => { if (live) setData(rows); }, () => { if (live) setData([]); });
    return () => { live = false; };
  }, [enabled]);
  return { data };
}
