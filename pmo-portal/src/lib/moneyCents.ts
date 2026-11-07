/** #1459 — the one cents helper for money arithmetic on JS numbers (rounded to whole cents). */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}
