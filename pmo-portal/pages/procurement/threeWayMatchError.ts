import type { TFunction } from 'i18next';

/**
 * #2622 (FR-TWM-007): the database refuses a payment, a payment moving to Paid, a bill marked Paid or a purchase moved to
 * Paid while any bill on the purchase is held by the three-way match (SQLSTATE MH001, detail `three-way-match-held`). Name
 * the hold and the way forward instead of a generic "Update failed"; null for any other error.
 */
export function threeWayMatchHeldMessage(err: unknown, t: TFunction): { headline: string; detail: string } | null {
  const e = err as { code?: unknown; details?: unknown } | null;
  const held = e?.code === 'MH001' || e?.code === 'three-way-match-held' || e?.details === 'three-way-match-held';
  if (!held) return null;
  return {
    headline: t('procurement:threeWayMatch.paymentHeld.title', 'Payment held by the three-way match'),
    detail: t('procurement:threeWayMatch.paymentHeld.detail', "A bill on this purchase does not match its order and receipts. Open the bill's three-way match to see why, record the missing receipt, or ask Finance to approve an exception."),
  };
}
