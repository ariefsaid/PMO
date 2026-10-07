import { useEffect, useRef } from 'react';
import { formatMoneyInputValue } from '@/src/lib/format';

/**
 * #876 slice 2 (DD-VWH-17) — keeps a money draft equal to a SUGGESTED amount until the user edits that field, then
 * never writes it again: "never over a choice", the OD-TAX-1 rule (`useTaxTreatmentPreselect`). The field's own
 * onChange calls `markTouched`. A null suggestion or `enabled: false` writes nothing — unknown is never guessed.
 * `isTouched` lets a caller tell a suggested value (still replaceable) from an edited one (never touched again),
 * e.g. so switching the withholding type can drop a stale suggestion without discarding the user's own figure.
 */
export function useSuggestedMoney(
  suggested: number | null,
  current: string,
  apply: (raw: string) => void,
  enabled = true,
): { markTouched: () => void; isTouched: () => boolean } {
  const touched = useRef(false);
  const currentRef = useRef(current);
  currentRef.current = current;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const next = enabled && suggested !== null ? formatMoneyInputValue(suggested) : null;
  useEffect(() => {
    if (touched.current || next === null || next === currentRef.current) return;
    applyRef.current(next);
  }, [next]);
  return { markTouched: () => { touched.current = true; }, isTouched: () => touched.current };
}
