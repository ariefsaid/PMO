/**
 * FR-IDEM-007 — dry-run conflict report (Deliverable 2). Zero writes: reuses the SAME
 * ImportSkipLookup read-only existence-check contract commit.ts uses at commit time
 * (D-ONB-4 — one lookup implementation, two call sites, no logic duplication).
 */
import type { ImportSkipLookup } from '@/src/lib/db/procurementImportSkip';
import { computeCaseImportKey, computeLegacyRecordImportKey } from './importKey';
import { caseDecider, recordDecider, TYPE_TO_TABLE, ambiguousIncomingCases, duplicateRecordRows } from './decisions';
import type { ImportDecision } from './decisions';
import { CYCLE_ORDER } from './types';
import type { CycleType, ValidatedGroup, ImportRunIdentity } from './types';
import type { RefLookup } from '@/src/lib/import/refLookup';

type InvoiceState = 'none' | 'new' | 'resolved' | 'conflict';
const isNewInvoice = (state: InvoiceState): boolean => state === 'new';

export interface DryRunConflictReport { wouldCreate: number; wouldSkip: number; wouldCollide: number; conflicts?: Array<{ caseRef: string; rowNumber?: number; type?: string; id?: string; message: string }> }
export interface DryRunConflictOptions { identity: ImportRunIdentity; skipLookup: ImportSkipLookup; vendorLookup?: RefLookup }

export async function buildDryRunConflictReport(
  validatedGroups: ValidatedGroup[],
  { identity, skipLookup, vendorLookup }: DryRunConflictOptions,
): Promise<DryRunConflictReport> {
  let wouldCreate = 0;
  let wouldSkip = 0;
  let wouldCollide = 0;
  const conflicts: NonNullable<DryRunConflictReport['conflicts']> = [];

  const importBatchId = identity.kind === 'registered' ? identity.id : '';
  const incomingConflicts = await ambiguousIncomingCases(validatedGroups.filter(item => item.valid), skipLookup);
  const decideHeader = caseDecider(skipLookup, validatedGroups.filter(item => item.valid).map(item => computeCaseImportKey(item.group)), importBatchId);
  for (const validated of validatedGroups) {
    if (!validated.valid) continue;
    if (incomingConflicts.has(validated)) { wouldCollide++; conflicts.push({ caseRef: validated.group.caseRef, message: 'Ambiguous case references require reconciliation.' }); continue; }
    const { group } = validated;
    const validNumbers = new Set(validated.rows.filter(row => row.valid).map(row => row.rowNumber));
    const duplicateRows = duplicateRecordRows(group.rows.filter(row => validNumbers.has(row.rowNumber)), vendorLookup);
    if (duplicateRows.size) { wouldCollide += duplicateRows.size; for (const row of group.rows) if (duplicateRows.has(row.rowNumber)) conflicts.push({ caseRef: group.caseRef, rowNumber: row.rowNumber, type: row.type, message: 'Duplicate source identity requires reconciliation.' }); continue; }

    const decision = await decideHeader(computeCaseImportKey(group));
    const count = (kind: 'new' | 'same' | 'other') => {
      if (kind === 'new') wouldCreate++;
      else if (kind === 'same') wouldSkip++;
      else wouldCollide++;
    };
    if (decision.kind === 'ambiguous') { wouldCollide++; for (const id of decision.ids) conflicts.push({ caseRef: group.caseRef, id, message: 'Multiple matching cases require reconciliation.' }); continue; }
    count(decision.kind);
    const validRowNumbers = new Set(validated.rows.filter(row => row.valid).map(row => row.rowNumber));
    const validRows = group.rows.filter(row => validRowNumbers.has(row.rowNumber)).sort((a, b) => CYCLE_ORDER.indexOf(a.type as CycleType) - CYCLE_ORDER.indexOf(b.type as CycleType));
    const decideRecord = decision.kind === 'new' ? null : recordDecider(skipLookup, decision.id, importBatchId, validRows, vendorLookup);
    let invoiceId: string | null = null;
    let invoiceState: InvoiceState = 'none';
    const invoices = group.rows.filter(row => row.type === 'VI');
    for (const row of validRows) {
      const table = TYPE_TO_TABLE[row.type as CycleType];
      if (!table) continue;
      if (row.type === 'Payment' && invoices.length > 0 && (invoices.length !== 1 || invoiceState === 'none' || invoiceState === 'conflict')) {
        wouldCollide++;
        conflicts.push({ caseRef: group.caseRef, rowNumber: row.rowNumber, type: row.type, message: 'The linked invoice could not be uniquely resolved.' });
        continue;
      }
      const result: Exclude<ImportDecision, { kind: 'ambiguous' }> = decideRecord
        ? await decideRecord(table, computeLegacyRecordImportKey(row), false, invoiceId, row.type === 'Payment' && isNewInvoice(invoiceState))
        : { kind: 'new' as const };
      count(result.kind);
      if (result.kind === 'other') conflicts.push({ caseRef: group.caseRef, rowNumber: row.rowNumber, type: row.type, id: result.id, message: 'Existing source requires reconciliation.' });
      if (row.type === 'VI') {
        invoiceState = result.kind === 'same' ? 'resolved' : result.kind === 'new' ? 'new' : 'conflict';
        if (result.kind === 'same') invoiceId = result.id;
      }
    }
  }

  return { wouldCreate, wouldSkip, wouldCollide, ...(conflicts.length ? { conflicts } : {}) };
}
