import type { StatusVariant } from '@/src/components/ui';

/**
 * Maps a `projects.status` enum value to a StatusPill variant (the Tinted-Status
 * Rule — dot + darkened text, never a solid fill). Mirrors the IA-3 status
 * grouping: on-hand execution → blue `open`; won/positive-terminal → green
 * `won`; on-hold/at-risk → amber `overdue`; lost → red `lost`; pipeline leads
 * → neutral `draft`. Presentation only — `LEGAL_PROJECT_TRANSITIONS` stays the
 * authority for what may actually move (never re-derived here).
 */
const VARIANT_BY_STATUS: Record<string, StatusVariant> = {
  // On-hand execution (active work) → the one interactive blue tint.
  'Ongoing Project': 'open',
  // Positive states → green.
  'Won, Pending KoM': 'won',
  'Close Out': 'won',
  // At-risk / paused → amber.
  'On Hold': 'overdue',
  // Lost → red.
  'Loss Tender': 'lost',
  // Pipeline leads + internal → neutral grey (not yet won work).
  Leads: 'draft',
  'PQ Submitted': 'draft',
  'Quotation Submitted': 'draft',
  'Tender Submitted': 'draft',
  Negotiation: 'draft',
  'Internal Project': 'draft',
};

export function pillVariantForProjectStatus(status: string): StatusVariant {
  return VARIANT_BY_STATUS[status] ?? 'neutral';
}

/**
 * The project icon-tile / avatar accent color. DESIGN.md names exactly one
 * categorical token (`violet`); the carried program OQ-7 reserves chart/avatar
 * tokens for later. Until then the project icon tile uses `violet` — a
 * non-interactive categorical accent, never an action color (One Blue Rule).
 */
export function projectIconColor(): string {
  return 'hsl(var(--violet))';
}
