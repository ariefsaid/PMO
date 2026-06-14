/**
 * ADR-0029 — Single status→variant authority.
 *
 * `pillVariantForProjectStatus` re-exports `workflowVariant` from the CW-2
 * registry (`src/lib/status/statusVariants.ts`), which is the SOLE authority
 * for every status tint across all modules. The previous local `VARIANT_BY_STATUS`
 * map was retired so the two project-status helpers (`components/projects.ts` and
 * `components/salesPipeline.ts`) can never drift from each other.
 *
 * Visible tint change from the old local map:
 *  • `On Hold`: local `overdue` (amber) → registry `warn` (amber) — same family,
 *    corrected to the registry's canonical amber token.
 *
 * Presentation only — `LEGAL_PROJECT_TRANSITIONS` stays the authority for
 * what may actually move (never re-derived here).
 */
export { workflowVariant as pillVariantForProjectStatus } from '@/src/lib/status/statusVariants';

/**
 * The project icon-tile / avatar accent color. DESIGN.md names exactly one
 * categorical token (`violet`); the carried program OQ-7 reserves chart/avatar
 * tokens for later. Until then the project icon tile uses `violet` — a
 * non-interactive categorical accent, never an action color (One Blue Rule).
 */
export function projectIconColor(): string {
  return 'hsl(var(--violet))';
}
