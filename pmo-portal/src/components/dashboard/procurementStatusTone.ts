import type { Tables } from '@/src/lib/supabase/database.types';
import { chartTheme } from '@/src/components/ui/chartTheme';

type ProcurementStatus = Tables<'procurements'>['status'];

/** A resolvable `hsl(var(--…))` chart-series color string (never a raw hex). */
type SeriesColor = (typeof chartTheme.series)[keyof typeof chartTheme.series];

/**
 * Maps a procurement status to a DESIGN.md `chartTheme.series` token so the
 * procurement-by-status bars are status-toned (fixes the all-green bug — color
 * now carries the status meaning, satisfying color-not-only alongside the axis
 * labels + aria summary).
 *
 * EXHAUSTIVE over the real `procurement_status` enum: the `never` default makes
 * a newly-added status a compile-time error, so a new status can never silently
 * fall through to green.
 */
export function procurementStatusTone(status: ProcurementStatus): SeriesColor {
  switch (status) {
    // terminal-good — order fulfilled / paid
    case 'Received':
    case 'Paid':
      return chartTheme.series.success;
    // in-flight — not-yet-started + committed / progressing through the order.
    // C1 de-rainbow: Draft moved here (was the categorical violet). Draft is
    // "not-yet-started", not a category — blue is the in-flight default; the
    // categorical violet is reserved for non-status use, and a 5th hue on a
    // status chart is the rainbow. Net: at most 4 status-meaning hues.
    case 'Draft':
    case 'Approved':
    case 'Quote Selected':
    case 'Ordered':
      return chartTheme.series.primary;
    // awaiting / caution — needs an action or payment
    case 'Requested':
    case 'Vendor Quoted':
    case 'Vendor Invoiced':
      return chartTheme.series.warning;
    // rejected / cancelled — dead branch
    case 'Rejected':
    case 'Cancelled':
      return chartTheme.series.destructive;
    default: {
      // Exhaustiveness guard: a new enum value will fail to compile here.
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
