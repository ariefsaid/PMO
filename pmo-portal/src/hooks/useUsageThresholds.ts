import { useCallback, useEffect, useState } from 'react';
import { materialRequestRepository as repo } from '@/src/lib/repositories/materialRequests';
import type { UsageThresholds } from '@/src/lib/repositories/materialRequests';

/**
 * The organisation's two usage thresholds. Request entry remains advisory; settings editors also read the load state.
 */
export function useUsageThresholds(): { thresholds: UsageThresholds | null; isPending: boolean; isError: boolean; reload: () => void } {
  const [thresholds, setThresholds] = useState<UsageThresholds | null>(null);
  const [tick, setTick] = useState(0);
  const [isPending, setPending] = useState(true);
  const [isError, setError] = useState(false);
  useEffect(() => {
    let live = true;
    repo.usageThresholds().then((t) => {
      if (live) { setThresholds(t); setError(false); setPending(false); }
    }, () => {
      if (live) { setError(true); setPending(false); }
    });
    return () => { live = false; };
  }, [tick]);
  const reload = useCallback(() => { setPending(true); setError(false); setTick((n) => n + 1); }, []);
  return { thresholds, isPending, isError, reload };
}
