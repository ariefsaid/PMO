/**
 * FR-IDEM-007 — dry-run conflict report (Deliverable 2). Zero writes: reuses the SAME
 * ImportSkipLookup read-only existence-check contract commit.ts uses at commit time
 * (D-ONB-4 — one lookup implementation, two call sites, no logic duplication).
 */
import type { RefLookup } from '@/src/lib/import/refLookup';
import type { ImportSkipLookup, RecordTableName } from '@/src/lib/db/procurementImportSkip';
import { computeCaseImportKey, computeRecordImportKey } from './importKey';
import type { CycleType, ValidatedGroup } from './types';

export interface DryRunConflictReport {
  wouldCreate: number;
  wouldSkip: number;
  wouldCollide: number;
}

export interface DryRunConflictOptions {
  importBatchId: string;
  skipLookup: ImportSkipLookup;
  projectLookup: RefLookup;
  vendorLookup: RefLookup;
}

const TYPE_TO_TABLE: Record<CycleType, RecordTableName> = {
  PR: 'purchase_requests',
  RFQ: 'rfqs',
  Quotation: 'procurement_quotations',
  PO: 'purchase_orders',
  GR: 'procurement_receipts',
  VI: 'procurement_invoices',
  Payment: 'payments',
};

export async function buildDryRunConflictReport(
  validatedGroups: ValidatedGroup[],
  { importBatchId, skipLookup }: DryRunConflictOptions,
): Promise<DryRunConflictReport> {
  let wouldCreate = 0;
  let wouldSkip = 0;
  let wouldCollide = 0;

  for (const validated of validatedGroups) {
    if (!validated.valid) continue;
    const { group } = validated;

    // ── Case header ──
    const caseKey = computeCaseImportKey(group);
    const existingCase = await skipLookup.findExistingCase('', caseKey, importBatchId);
    if (existingCase) {
      wouldSkip++;
    } else {
      const collision = await skipLookup.findCrossBatchCollision('procurements', 'org_id', '', caseKey, importBatchId);
      if (collision) wouldCollide++;
      else wouldCreate++;
    }

    // ── Records ──
    // Mirrors the case-level check exactly: the existence probe is scoped by the case's
    // procurement_id when a case was found in THIS batch (existingCase.id); when no case
    // exists yet in this batch (new case, or the case itself is a cross-batch collision),
    // the record-level cross-batch-collision probe still runs (scope resolved server-side
    // by the live implementation, same '' placeholder pattern as the case-level org_id
    // check above) — a record can collide on its own key even before its case does.
    const validRowNumbers = new Set(validated.rows.filter((r) => r.valid).map((r) => r.rowNumber));
    for (const row of group.rows.filter((r) => validRowNumbers.has(r.rowNumber))) {
      const table = TYPE_TO_TABLE[row.type as CycleType];
      if (!table) continue;
      const recordKey = computeRecordImportKey(row);
      const existingRecord = existingCase
        ? await skipLookup.findExistingRecord(table, existingCase.id, recordKey, importBatchId)
        : null;
      if (existingRecord) {
        wouldSkip++;
      } else {
        const collision = await skipLookup.findCrossBatchCollision(
          table, 'procurement_id', existingCase?.id ?? '', recordKey, importBatchId,
        );
        if (collision) wouldCollide++;
        else wouldCreate++;
      }
    }
  }

  return { wouldCreate, wouldSkip, wouldCollide };
}
