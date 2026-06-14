/**
 * RecordActionZone — the ONE canonical home for a record's advance/approve/decide verb.
 *
 * DESIGN.md §7 (RecordActionZone molecule): the advance/approve verbs (Advance / Mark won /
 * Approve / Reject) live in ONE consistently-placed, never-below-the-fold zone:
 *   - **Desktop (≥920px):** sticky-bottom with a backdrop-blur so it stays visible
 *     as the user scrolls the evidence/detail sections above it.
 *   - **Mobile (< 920px):** normal flow (the mobile sticky-action bar inside each
 *     record page mirrors the primary CTA at `position: fixed` bottom; that is
 *     per-record, not a role of this wrapper).
 *
 * Enforcement rule: every record page's advance/approve action MUST render inside
 * this component. Tests assert `data-testid="record-action-zone"` presence so a
 * future record cannot re-fork the verb into an ad-hoc placement.
 */
import React from 'react';
import { cn } from './cn';

export interface RecordActionZoneProps {
  children: React.ReactNode;
  className?: string;
  /** Optional accessible label for the zone (passes through to the wrapper element). */
  'aria-label'?: string;
}

export const RecordActionZone: React.FC<RecordActionZoneProps> = ({
  children,
  className,
  'aria-label': ariaLabel,
}) => (
  <div
    data-testid="record-action-zone"
    aria-label={ariaLabel}
    className={cn(
      // Desktop: sticky bottom so advance actions never scroll below the fold.
      'min-[920px]:sticky min-[920px]:bottom-0 min-[920px]:z-10',
      'min-[920px]:bg-background/95 min-[920px]:backdrop-blur-sm',
      className,
    )}
  >
    {children}
  </div>
);
