/**
 * Project-manager display/label semantics (FR-PRJUX-004 / FR-PRJUX-005).
 *
 * The Projects list must never conflate two "assigned but unnameable" states:
 *   - a project with NO manager (`project_manager_id == null`) → `unassignedLabel`;
 *   - a project whose manager profile exists but has an empty/whitespace/missing
 *     `full_name` (historical blank-name profiles) → `unnamedUserLabel · <short ID>`.
 *
 * The call site supplies both labels (normally via `t(...)`) so this stays a pure,
 * translation-agnostic helper. The short ID is the first eight stable characters of
 * the profile ID so an unnamed profile remains distinguishable without exposing PII.
 *
 * `UNASSIGNED_PROJECT_MANAGER` is the filter sentinel for "no manager assigned". It is
 * deliberately NOT a profile ID and NOT the cleared "All" value, so its filter predicate
 * can match ONLY `project_manager_id == null` (FR-PRJUX-005) and an unnamed-but-assigned
 * manager is never treated as unassigned.
 */

/** Sentinel value for the "Unassigned" PM filter option — never a real profile ID. */
export const UNASSIGNED_PROJECT_MANAGER = '__unassigned__';

export interface ProjectManagerLabelInput {
  /** The project's `project_manager_id` (real DB value; may be null/undefined). */
  managerId: string | null | undefined;
  /** The joined profile `full_name` (may be blank/missing for an assigned profile). */
  fullName: string | null | undefined;
  /** Visible label for a genuinely unassigned project (e.g. t('…unassigned', 'Unassigned')). */
  unassignedLabel: string;
  /** Visible label for an unnamed-but-assigned profile (e.g. t('…unnamedUser', 'Unnamed user')). */
  unnamedUserLabel: string;
}

/**
 * Resolve the human-readable label for a project manager cell/option.
 *
 * - `managerId == null` (or undefined) → `unassignedLabel` (genuinely unassigned).
 * - otherwise → the trimmed `fullName`, or `${unnamedUserLabel} · <first 8 ID chars>`
 *   when that name is blank/whitespace/missing. An assigned profile NEVER resolves to
 *   `unassignedLabel`, so it can never read as unassigned, and never to an empty string.
 */
export function projectManagerLabel({
  managerId,
  fullName,
  unassignedLabel,
  unnamedUserLabel,
}: ProjectManagerLabelInput): string {
  if (managerId == null) {
    return unassignedLabel;
  }
  const trimmed = (fullName ?? '').trim();
  if (trimmed !== '') {
    return trimmed;
  }
  return `${unnamedUserLabel} · ${managerId.slice(0, 8)}`;
}