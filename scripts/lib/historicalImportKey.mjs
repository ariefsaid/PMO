/**
 * historicalImportKey.mjs — copy-inline mirror of
 * pmo-portal/src/lib/import/procurementCycle/importKey.ts's computeRecordImportKey /
 * computeCaseImportKey (FR-IDEM-002), for scripts/import-historical.mjs (Deliverable 3).
 *
 * This is a DELIBERATE COPY, not a TS import — no scripts/*.mjs in this repo imports a .ts
 * file (same rationale as historicalImportGroup.mjs / historicalImportValidate.mjs). The two
 * copies MUST stay byte-identical in OUTPUT: import-historical.mjs writes import_key with these
 * fingerprints and commit.ts (the in-app path) writes them with the .ts version — a divergence
 * would make a case imported by one path invisible to the other's skip lookup.
 *
 * Parity is enforced by historicalImportKey.parity.test.ts (Vitest), which imports BOTH this
 * .mjs and the .ts source and asserts identical output across a table of inputs. If importKey.ts
 * changes, this file must change in lockstep and that test keeps them honest.
 *
 * Pure, synchronous, deterministic.
 */

/** Case key = case_ref (the stable grouping key). */
export function computeCaseImportKey(caseRef) {
  return caseRef;
}

/**
 * Record key = reference_number (externalRef) when present, else a deterministic fingerprint of
 * type+date+amount+vendor. Byte-identical to importKey.ts: the fallback coalesces date/amount/
 * vendor with `?? ''` before joining on '|'.
 *
 * @param row - { type, externalRef, date, amount, vendor }
 */
export function computeRecordImportKey(row) {
  if (row.externalRef?.trim()) return row.externalRef.trim();
  const parts = [row.type, row.date ?? '', row.amount ?? '', row.vendor ?? ''];
  return `fp:${parts.join('|')}`;
}
