import type { ManpowerToFillRow } from '@/src/lib/db/manpowerNeeds';

/**
 * The needs-you pointer for manpower needs with places still to fill (docs/specs/manpower-request.spec.md FR-MPN-009). Pure: the rows
 * come from `my_manpower_to_fill`, which derives them on read, so a need that is met, cancelled or fully linked is simply absent next time.
 * Nothing is stored and nothing is cleared here.
 */
export interface WaitingManpowerFact {
  /** Needs with places still to fill. */
  count: number;
  /** Places still to fill, summed over those needs. */
  openPlaces: number;
  /** The earliest needed-by date among them (YYYY-MM-DD). */
  earliestNeededBy: string;
  /** The Manpower tab of the Crews page. */
  href: string;
}

export function summariseManpowerToFill(rows: ReadonlyArray<ManpowerToFillRow>): WaitingManpowerFact | null {
  if (rows.length === 0) return null;
  return {
    count: rows.length,
    openPlaces: rows.reduce((sum, r) => sum + r.open_count, 0),
    earliestNeededBy: rows.reduce((min, r) => (r.needed_by < min ? r.needed_by : min), rows[0].needed_by),
    href: '/crews?view=manpower',
  };
}
