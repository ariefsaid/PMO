import { useEffect, useState } from 'react';
import { getPoNeededByRequired, getProcurementNeededBy } from '@/src/lib/db/procurementNeededBy';

/** 1124d — whether this organisation needs a needed-by date before an order is sent (default off). Plain effect: pending or failed reads mean OFF, so no purchase screen changes unless an Admin turned it on. */
export function usePoNeededByRequired(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    getPoNeededByRequired().then((v) => { if (live) setOn(v); }, () => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}

/** The order's header date; `reload` after a save. Reads only while `enabled`. */
export function useProcurementNeededBy(id: string, enabled: boolean): { value: string | null; reload: () => void } {
  const [value, setValue] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    getProcurementNeededBy(id).then((v) => { if (live) setValue(v); }, () => { if (live) setValue(null); });
    return () => { live = false; };
  }, [id, enabled, tick]);
  return { value, reload: () => setTick((n) => n + 1) };
}
