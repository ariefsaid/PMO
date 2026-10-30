/**
 * FR-IDEM-007 — dry-run conflict report (Deliverable 2). Zero writes: reuses the SAME
 * ImportSkipLookup read-only existence-check contract commit.ts uses at commit time
 * (D-ONB-4 — one lookup implementation, two call sites, no logic duplication).
 */
import type { ImportSkipLookup } from '@/src/lib/db/procurementImportSkip';
import { computeCaseImportKey, computeRecordImportKey } from './importKey';
import { decideCase, recordDecider, TYPE_TO_TABLE } from './decisions';
import type { CycleType, ValidatedGroup } from './types';

export interface DryRunConflictReport { wouldCreate: number; wouldSkip: number; wouldCollide: number }
export interface DryRunConflictOptions { importBatchId: string; skipLookup: ImportSkipLookup }

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

    const decision = await decideCase(skipLookup, computeCaseImportKey(group), importBatchId);
    const count = (kind: 'new' | 'same' | 'other') => {
      if (kind === 'new') wouldCreate++;
      else if (kind === 'same') wouldSkip++;
      else wouldCollide++;
    };
    count(decision.kind);
    const validRowNumbers = new Set(validated.rows.filter(row => row.valid).map(row => row.rowNumber));
    const validRows = group.rows.filter(row => validRowNumbers.has(row.rowNumber));
    const decideRecord = decision.kind === 'new' ? null : recordDecider(skipLookup, decision.id, importBatchId, validRows);
    for (const row of validRows) {
      const table = TYPE_TO_TABLE[row.type as CycleType];
      if (table) count(decideRecord ? (await decideRecord(table, computeRecordImportKey(row))).kind : 'new');
    }
  }

  return { wouldCreate, wouldSkip, wouldCollide };
}
