import { useCallback, useEffect, useState } from 'react';
import { materialRequestRepository as repo } from '@/src/lib/repositories/materialRequests';
import type { UsageThresholds } from '@/src/lib/repositories/materialRequests';

/**
 * #2686: the organisation's two usage thresholds. A failed read is treated as "off": the warning is advisory, so it must never
 * stand between a person and their request. `reload` refreshes after the Admin saves.
 */
export function useUsageThresholds(): { thresholds: UsageThresholds | null; reload: () => void } {
  const [thresholds, setThresholds] = useState<UsageThresholds | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    repo.usageThresholds().then((t) => { if (live) setThresholds(t); }, () => { if (live) setThresholds(null); });
    return () => { live = false; };
  }, [tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { thresholds, reload };
}
