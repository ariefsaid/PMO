/**
 * M1 — Group raw CycleRows by caseRef into CaseGroups (ADR-0035).
 *
 * Pure, synchronous, zero writes. Groups by caseRef (trim+case-insensitive key,
 * original display value preserved from first occurrence). Case attrs = first
 * non-empty value per attr across the group (first-row-wins). Rows with a blank
 * caseRef are rejected to rowErrors and excluded from groups.
 */
import type { CycleRow, CaseGroup, CaseAttrs } from './types';

export interface GroupRowsResult {
  groups: CaseGroup[];
  rowErrors: { rowNumber: number; message: string }[];
}

/** Normalize a caseRef for grouping: trim + lowercase. */
function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Pick first non-undefined/non-empty value seen for each CaseAttrs field. */
function mergeAttrs(existing: CaseAttrs, row: CycleRow): CaseAttrs {
  return {
    project: existing.project ?? (row.project?.trim() || undefined),
    title: existing.title ?? (row.title?.trim() || undefined),
    caseStatus: existing.caseStatus ?? (row.caseStatus?.trim() || undefined),
  };
}

/**
 * Groups CycleRows by caseRef.
 *
 * @param rows - Raw parsed rows from the import sheet.
 * @returns Groups (one per unique caseRef) and rowErrors (blank caseRef rows).
 */
export function groupRows(rows: CycleRow[]): GroupRowsResult {
  const rowErrors: { rowNumber: number; message: string }[] = [];
  // Ordered map: insertion order = first-seen caseRef order (stable for display).
  const groupMap = new Map<string, CaseGroup>();

  for (const row of rows) {
    const rawRef = row.caseRef ?? '';
    if (!rawRef.trim()) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        message: 'Row is missing a case_ref and cannot be assigned to a case.',
      });
      continue;
    }

    const key = normalizeKey(rawRef);
    const existing = groupMap.get(key);
    if (!existing) {
      const attrs: CaseAttrs = {
        project: row.project?.trim() || undefined,
        title: row.title?.trim() || undefined,
        caseStatus: row.caseStatus?.trim() || undefined,
      };
      groupMap.set(key, {
        caseRef: rawRef.trim(),
        attrs,
        rows: [row],
        errors: [],
      });
    } else {
      existing.attrs = mergeAttrs(existing.attrs, row);
      existing.rows.push(row);
    }
  }

  return { groups: Array.from(groupMap.values()), rowErrors };
}
