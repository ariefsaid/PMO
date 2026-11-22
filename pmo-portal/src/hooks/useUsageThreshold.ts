import { useCallback, useEffect, useState } from 'react';
import { materialRequestRepository as repo } from '@/src/lib/repositories/materialRequests';

/**
 * The organisation's usage warning threshold (percent of plan, null = off). A failed read is treated as "off": the warning is advisory, so it
 * must never stand between a person and their request. `reload` refreshes after the Admin saves.
 */
export function useUsageThreshold(): { threshold: number | null; reload: () => void } {
  const [threshold, setThreshold] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    repo.usageThreshold().then((t) => { if (live) setThreshold(t); }, () => { if (live) setThreshold(null); });
    return () => { live = false; };
  }, [tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { threshold, reload };
}
