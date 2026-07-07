/**
 * historicalImportGroup.mjs — copy-inline mirror of
 * pmo-portal/src/lib/import/procurementCycle/group.ts's groupRows (ADR-0035 M1), for
 * scripts/import-historical.mjs (Deliverable 3, FR-HIST-008: "reuse the pure parse/group/
 * validate layer"). This is a DELIBERATE COPY, not a TS import — no scripts/*.mjs in this
 * repo imports a .ts file (confirmed by grep before writing this), and adding a tsx/ts-node
 * toolchain dependency just for this one script would be disproportionate. If group.ts's
 * grouping rule ever changes, this file must be updated in lockstep (flagged, mirrored by
 * historicalImportGroup.test.mjs carrying the SAME test coverage as group.test.ts).
 *
 * Pure, synchronous, zero writes. Groups by caseRef (trim+case-insensitive key, original
 * display value preserved from first occurrence). Case attrs = first non-empty value per
 * attr across the group (first-row-wins).
 */

/** Normalize a caseRef for grouping: trim + lowercase. */
function normalizeKey(raw) {
  return raw.trim().toLowerCase();
}

/** Pick first non-undefined/non-empty value seen for each attrs field. */
function mergeAttrs(existing, row) {
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
 * @returns { groups, rowErrors } — groups (one per unique caseRef) and rowErrors (blank caseRef rows).
 */
export function groupRows(rows) {
  const rowErrors = [];
  // Ordered map: insertion order = first-seen caseRef order (stable for display).
  const groupMap = new Map();

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
      const attrs = {
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
