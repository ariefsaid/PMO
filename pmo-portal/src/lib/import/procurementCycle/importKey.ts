/**
 * FR-IDEM-002 — stable per-row import-key derivation (Deliverable 2, ADR-0027/0035).
 * Pure, synchronous, deterministic. Case key = case_ref (already the stable grouping key
 * per group.ts). Record key = reference_number (externalRef) when present, else a
 * deterministic fingerprint of type+date+amount+vendor (OD-ONB-1: reference_number is the
 * PREFERRED stable source; the fingerprint is the documented fallback, never persisted as a
 * reference_number itself).
 */
import type { CaseGroup, CycleRow } from './types';

export function computeCaseImportKey(group: CaseGroup): string {
  return group.caseRef;
}

export function computeRecordImportKey(row: CycleRow): string {
  if (row.externalRef?.trim()) return row.externalRef.trim();
  const parts = [row.type, row.date ?? '', row.amount ?? '', row.vendor ?? ''];
  return `fp:${parts.join('|')}`;
}
